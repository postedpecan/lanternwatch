import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync, writeSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lifecycleStoragePaths } from "./guild-paths.mjs";
import { reportEvent } from "./guild-report.mjs";
import { resolveAgentRole } from "./guild-roles.mjs";

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

let payload = {};
try { payload = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch (error) { logFailure("parse", error); process.exit(0); }
const eventName = payload.hook_event_name;
const sessionId = safe(payload.session_id, "session");
const turnId = safe(payload[TURN_FIELD], "turn");
const cwd = typeof payload.cwd === "string" ? payload.cwd : process.cwd();
const runId = `${SOURCE}-${sessionId}-${turnId}`;
const now = new Date().toISOString();
const base = { projectPath: cwd, projectName: path.basename(cwd), runId, source: SOURCE, quest: `${HOST_LABEL} task`, occurredAt: now };

// Resolved once so the diagnostic receipt and the report/skip decision below
// agree on the same role and the same matched/ambiguous verdict.
const agentResolution = (eventName === "SubagentStart" || eventName === "SubagentStop")
  ? resolveAgentRole(payload.agent_type)
  : null;

const receipt = {
  at: now,
  source: SOURCE,
  stage: "received",
  event: supportedEvents.has(eventName) ? eventName : "invalid",
  sessionId,
  turnId,
};
if (agentResolution) {
  receipt.agentInstanceId = safe(payload.agent_id, "agent");
  receipt.agent = agentResolution.role;
  if (!agentResolution.matched) {
    // Ambiguous agent_type (e.g. the "claude" catch-all): roleForAgentType
    // had to fall through to its unconditional archivist default rather than
    // confidently identifying a role. Note it here so the log still shows
    // what happened, even though the automatic dashboard report is skipped
    // below in favor of a manual guild-report.mjs call for the real role.
    receipt.note = "ambiguous-agent-type-report-skipped";
  }
}
appendHookLog(receipt);

try {
  if (eventName === "UserPromptSubmit") {
    saveState(sessionId, { runId, cwd, turnId, source: SOURCE, open: true });
    await reportEvent({ ...base, eventId: `hook-start-${sessionId}-${turnId}`, agent: "guildmaster", status: "working", message: `${HOST_LABEL} accepted the task and began working.` });
    if (process.env.LANTERNWATCH_DISABLE_HEARTBEAT !== "1") {
      spawn(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), "guild-heartbeat.mjs"), stateFile(sessionId), runId], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    }
  } else if (eventName === "Stop") {
    await reportEvent({ ...base, eventId: `hook-stop-${sessionId}-${turnId}`, agent: "guildmaster", status: "complete", message: `${HOST_LABEL} completed the turn and returned to idle.`, runComplete: true });
    saveState(sessionId, { runId, cwd, turnId, source: SOURCE, open: false });
  } else if (eventName === "SubagentStart" || eventName === "SubagentStop") {
    if (agentResolution.matched) {
      const agentId = safe(payload.agent_id, "agent");
      const status = eventName === "SubagentStart" ? "working" : "complete";
      await reportEvent({ ...base, eventId: `hook-${eventName.toLowerCase()}-${sessionId}-${turnId}-${agentId}`, agent: agentResolution.role, agentInstanceId: agentId, status, message: status === "working" ? "A team member began assigned work." : "A team member finished assigned work." });
    }
    // else: ambiguous agent_type (e.g. the "claude" catch-all) — the
    // diagnostic receipt above already recorded it with a note; skip the
    // dashboard/DB report here so it doesn't show a low-confidence
    // "archivist" guess. A manual guild-report.mjs call from the dispatching
    // agent (which knows the real role) is expected to be the sole source of
    // truth for this subagent's dashboard entry.
  } else if (eventName === "SessionEnd") {
    const state = loadState(sessionId);
    if (state?.open) await reportEvent({ projectPath: state.cwd, projectName: path.basename(state.cwd), runId: state.runId, eventId: `hook-sessionend-${sessionId}`, source: SOURCE, agent: "guildmaster", status: "interrupted", message: `The ${HOST_LABEL} session ended before the turn reported completion.`, quest: `${HOST_LABEL} task`, occurredAt: now, runComplete: true });
  }
} catch (error) { logFailure("handle", error, eventName, sessionId); }
