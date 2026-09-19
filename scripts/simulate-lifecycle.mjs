import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_STORAGE_ROOT } from "./guild-paths.mjs";

function option(args, name) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function safe(value, fallback) {
  return typeof value === "string" && value.trim()
    ? value.trim().replace(/[^a-zA-Z0-9._:-]/g, "-").slice(0, 180)
    : fallback;
}

function runHook(script, payload, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      env: environment,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`Lifecycle hook exited ${code}: ${stderr.trim().slice(0, 300)}`));
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

async function readHealth(apiUrl) {
  const healthUrl = new URL(apiUrl);
  healthUrl.pathname = healthUrl.pathname.replace(/\/events\/?$/, "/health");
  const response = await fetch(healthUrl, { signal: AbortSignal.timeout(2000) });
  if (!response.ok) throw new Error(`Lanternwatch health check returned ${response.status}.`);
  return { url: healthUrl.href, payload: await response.json() };
}

const args = process.argv.slice(2);
const storageRootOption = option(args, "storage-root");
if (!storageRootOption) {
  throw new Error("Usage: node scripts/simulate-lifecycle.mjs --storage-root <fixture-root> [--api-url <events-url>]");
}

const storageRoot = path.resolve(storageRootOption);
if (storageRoot.toLocaleLowerCase() === path.resolve(DEFAULT_STORAGE_ROOT).toLocaleLowerCase()) {
  throw new Error("Refusing to simulate lifecycle events against the production storage root.");
}

const apiUrl = option(args, "api-url") || "http://127.0.0.1:3117/api/guild/events";
const projectPath = path.resolve(option(args, "project") || process.cwd());
const sessionId = safe(option(args, "session-id"), `fixture-${process.pid}-${Date.now()}`);
const turnId = safe(option(args, "turn-id"), "live-test");
const hookScript = path.join(path.dirname(fileURLToPath(import.meta.url)), "guild-lifecycle-hook.mjs");
const environment = {
  ...process.env,
  LANTERNWATCH_API_URL: apiUrl,
  LANTERNWATCH_DB_PATH: path.join(storageRoot, "guild.db"),
  LANTERNWATCH_STORAGE_ROOT: storageRoot,
  LANTERNWATCH_VAULT_PATH: path.join(storageRoot, "vault"),
  LANTERNWATCH_DISABLE_HEARTBEAT: "1",
};
const basePayload = { session_id: sessionId, turn_id: turnId, cwd: projectPath };
const agentId = `${sessionId}-platform-engineer`;

const before = await readHealth(apiUrl);
const serverRoot = path.resolve(String(before.payload.storageRootPath || ""));
if (serverRoot.toLocaleLowerCase() !== storageRoot.toLocaleLowerCase()) {
  throw new Error(`Refusing lifecycle simulation: the server health root does not match the fixture root (${serverRoot}).`);
}

const startResult = await runHook(hookScript, { ...basePayload, hook_event_name: "UserPromptSubmit" }, environment);
const subagentStartResult = await runHook(hookScript, {
  ...basePayload,
  hook_event_name: "SubagentStart",
  agent_id: agentId,
  agent_type: "platform-engineer",
  permission_mode: "default",
}, environment);
const dashboardUrl = new URL(apiUrl);
dashboardUrl.pathname = dashboardUrl.pathname.replace(/\/events\/?$/, "/dashboard");
const activeResponse = await fetch(dashboardUrl, { signal: AbortSignal.timeout(2000) });
if (!activeResponse.ok) throw new Error(`Lanternwatch dashboard check returned ${activeResponse.status}.`);
const activeDashboard = await activeResponse.json();
const activeAgent = Array.isArray(activeDashboard.agentActivities)
  ? activeDashboard.agentActivities.find((activity) => activity.agentInstanceId === agentId)
  : undefined;
if (!activeAgent || activeAgent.agent !== "platform-engineer" || activeAgent.status !== "working") {
  throw new Error("SubagentStart did not appear as an active Platform Engineer instance.");
}
const subagentStopResult = await runHook(hookScript, {
  ...basePayload,
  hook_event_name: "SubagentStop",
  agent_id: agentId,
  agent_type: "platform-engineer",
  agent_transcript_path: "fixture-transcript.jsonl",
  stop_hook_active: false,
  last_assistant_message: "fixture complete",
}, environment);
const stopResult = await runHook(hookScript, {
  ...basePayload,
  hook_event_name: "Stop",
  stop_hook_active: false,
  last_assistant_message: "fixture complete",
}, environment);
for (const result of [startResult, subagentStartResult, subagentStopResult, stopResult]) {
  const response = JSON.parse(result.stdout);
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    throw new Error("Lifecycle hook did not emit a valid JSON object on stdout.");
  }
}

const receiptPath = path.join(storageRoot, "logs", "hook.jsonl");
const receipts = readFileSync(receiptPath, "utf8")
  .trim()
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line))
  .filter((receipt) => receipt.sessionId === sessionId && receipt.turnId === turnId);
const after = await readHealth(apiUrl);
if (after.payload.hookLogStatus !== "ok" || after.payload.lastHookEvent !== "Stop" || after.payload.lastHookSource !== "codex") {
  throw new Error(`Lifecycle health did not clear after simulation (status ${after.payload.hookLogStatus || "unknown"}).`);
}
const completedResponse = await fetch(dashboardUrl, { signal: AbortSignal.timeout(2000) });
if (!completedResponse.ok) throw new Error(`Lanternwatch completion check returned ${completedResponse.status}.`);
const completedDashboard = await completedResponse.json();
if (Array.isArray(completedDashboard.agentActivities)
    && completedDashboard.agentActivities.some((activity) => activity.agentInstanceId === agentId)) {
  throw new Error("SubagentStop did not remove the completed Platform Engineer instance from live activity.");
}
process.stdout.write(`${JSON.stringify({
  storageRoot,
  databasePath: environment.LANTERNWATCH_DB_PATH,
  receiptPath,
  receiptCount: receipts.length,
  activeAgentVerified: true,
  stoppedAgentVerified: true,
  agentId,
  sessionId,
  turnId,
  apiUrl,
  healthUrl: after.url,
  hookLogStatus: after.payload.hookLogStatus,
  lastHookEvent: after.payload.lastHookEvent,
  lastHookSource: after.payload.lastHookSource,
})}\n`);
