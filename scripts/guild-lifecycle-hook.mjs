import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync, writeSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lifecycleStoragePaths } from "./guild-paths.mjs";
import { startHeartbeatScheduler } from "./guild-heartbeat.mjs";
import { reportEvent } from "./guild-report.mjs";
import { canonicalAgentId } from "./guild-roles.mjs";

const { stateDirectory, logDirectory } = lifecycleStoragePaths(
  process.env.LANTERNWATCH_STORAGE_ROOT,
  process.env.LANTERNWATCH_DB_PATH,
);
const supportedEvents = new Set(["UserPromptSubmit", "Stop", "SubagentStart", "SubagentStop", "SessionEnd"]);

// One hook script serves both hosts: their hook event names and payload shapes
// (session_id, hook_event_name, agent_id, agent_type) line up closely enough
// that only the host label and the per-turn correlation field differ.
const SOURCE = (process.argv[2] || "codex").toLowerCase() === "claude" ? "claude" : "codex";
const HOST_LABEL = SOURCE === "claude" ? "Claude Code" : "Codex";
const TURN_FIELD = SOURCE === "claude" ? "prompt_id" : "turn_id";

function safe(value, fallback = "unknown", max = 180) {
  return typeof value === "string" && value.trim() ? value.trim().replace(/[^a-zA-Z0-9._:-]/g, "-").slice(0, max) : fallback;
}
function stateFile(sessionId) { return path.join(stateDirectory, `${safe(sessionId)}.json`); }
function saveState(sessionId, state) {
  mkdirSync(stateDirectory, { recursive: true });
  const target = stateFile(sessionId);
  const temporary = `${target}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(state), "utf8");
  renameSync(temporary, target);
}
function loadState(sessionId) { try { return JSON.parse(readFileSync(stateFile(sessionId), "utf8")); } catch { return null; } }
function launchClaudeHeartbeat(sessionStateFile, runId) {
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const heartbeatScript = path.join(scriptDirectory, "guild-heartbeat.mjs");
  spawn(process.execPath, [heartbeatScript, sessionStateFile, runId], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  }).unref();
}
function appendHookLog(entry) {
  try {
    mkdirSync(logDirectory, { recursive: true });
    appendFileSync(path.join(logDirectory, "hook.jsonl"), `${JSON.stringify(entry)}\n`, "utf8");
    return true;
  } catch (error) {
    const name = safe(error?.name, "Error", 80);
    const code = safe(error?.code, "unknown", 80);
    try { writeSync(2, `Lanternwatch hook diagnostic write failed (${name}:${code}).\n`); } catch {}
    return false;
  }
}
function logFailure(stage, error, event = "invalid", currentSessionId = "session") {
  appendHookLog({
    at: new Date().toISOString(),
    source: SOURCE,
    stage,
    event: supportedEvents.has(event) ? event : "invalid",
    sessionId: safe(currentSessionId, "session"),
    name: error?.name || "Error",
    message: String(error?.message || error).slice(0, 500),
  });
}

// Codex expects Stop and SubagentStop hooks that exit successfully to emit a
// JSON object on stdout. Emit the empty, non-blocking response before doing
// telemetry work so an API timeout or SQLite fallback can never turn the hook
// into an invalid terminal response. The same response is harmless for the
// other lifecycle events and keeps the shared handler contract uniform.
try { writeSync(1, "{}\n"); } catch {}

let payload = {};
try { payload = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch (error) { logFailure("parse", error); process.exit(0); }
const eventName = payload.hook_event_name;
const sessionId = safe(payload.session_id, "session");
const turnId = safe(payload[TURN_FIELD], "turn");
const cwd = typeof payload.cwd === "string" ? payload.cwd : process.cwd();
const runId = `${SOURCE}-${sessionId}-${turnId}`;
const now = new Date().toISOString();
const base = { projectPath: cwd, projectName: path.basename(cwd), runId, source: SOURCE, quest: `${HOST_LABEL} task`, occurredAt: now };

// Codex sends the custom agent's selected type. Preserve it as the lifecycle
// identity instead of collapsing user-owned agents into LanternWatch roles.
const agentType = (eventName === "SubagentStart" || eventName === "SubagentStop")
  ? canonicalAgentId(payload.agent_type) || safe(payload.agent_type, "unclassified-agent")
  : null;

const receipt = {
  at: now,
  source: SOURCE,
  stage: "received",
  event: supportedEvents.has(eventName) ? eventName : "invalid",
  sessionId,
  turnId,
};
if (agentType) {
  receipt.agentInstanceId = safe(payload.agent_id, "agent");
  receipt.agent = agentType;
}
appendHookLog(receipt);

let heartbeatOwnsLifecycle = false;
try {
  if (eventName === "UserPromptSubmit") {
    saveState(sessionId, { runId, cwd, turnId, source: SOURCE, open: true });
    await reportEvent({ ...base, eventId: `hook-start-${sessionId}-${turnId}`, agent: "program-manager", status: "working", message: `${HOST_LABEL} accepted the task and began working.` });
    if (process.env.LANTERNWATCH_DISABLE_HEARTBEAT !== "1") {
      if (SOURCE === "codex") {
        // Codex installs UserPromptSubmit as an asynchronous hook. Keep its
        // runner as the heartbeat worker instead of spawning a descendant
        // that inherits the Windows Job Object and prevents wait_with_output
        // from completing after the nominal hook process exits.
        startHeartbeatScheduler(stateFile(sessionId), runId);
        heartbeatOwnsLifecycle = true;
      } else {
        // Claude Code does not use Codex's async hook contract or Job Object.
        launchClaudeHeartbeat(stateFile(sessionId), runId);
      }
    }
  } else if (eventName === "Stop") {
    await reportEvent({ ...base, eventId: `hook-stop-${sessionId}-${turnId}`, agent: "program-manager", status: "complete", message: `${HOST_LABEL} completed the turn and returned to idle.`, runComplete: true });
    saveState(sessionId, { runId, cwd, turnId, source: SOURCE, open: false });
  } else if (eventName === "SubagentStart" || eventName === "SubagentStop") {
    const agentId = safe(payload.agent_id, "agent");
    const status = eventName === "SubagentStart" ? "working" : "complete";
    await reportEvent({ ...base, eventId: `hook-${eventName.toLowerCase()}-${sessionId}-${turnId}-${agentId}`, agent: agentType, agentInstanceId: agentId, status, message: status === "working" ? "A Codex agent began assigned work." : "A Codex agent finished assigned work." });
  } else if (eventName === "SessionEnd") {
    const state = loadState(sessionId);
    if (state?.open) await reportEvent({ projectPath: state.cwd, projectName: path.basename(state.cwd), runId: state.runId, eventId: `hook-sessionend-${sessionId}`, source: SOURCE, agent: "program-manager", status: "interrupted", message: `The ${HOST_LABEL} session ended before the turn reported completion.`, quest: `${HOST_LABEL} task`, occurredAt: now, runComplete: true });
  }
} catch (error) { logFailure("handle", error, eventName, sessionId); }

// Every hook except Codex's explicitly asynchronous UserPromptSubmit ends
// after its awaited persistence attempt. That async hook intentionally stays
// alive as the heartbeat worker and exits when Stop closes its state.
if (!heartbeatOwnsLifecycle) process.exit(0);
