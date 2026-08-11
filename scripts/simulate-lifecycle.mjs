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
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
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

const before = await readHealth(apiUrl);
const serverRoot = path.resolve(String(before.payload.storageRootPath || ""));
if (serverRoot.toLocaleLowerCase() !== storageRoot.toLocaleLowerCase()) {
  throw new Error(`Refusing lifecycle simulation: the server health root does not match the fixture root (${serverRoot}).`);
}

await runHook(hookScript, { ...basePayload, hook_event_name: "UserPromptSubmit" }, environment);
await runHook(hookScript, { ...basePayload, hook_event_name: "Stop" }, environment);

const receiptPath = path.join(storageRoot, "logs", "hook.jsonl");
const receipts = readFileSync(receiptPath, "utf8")
  .trim()
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line))
  .filter((receipt) => receipt.sessionId === sessionId && receipt.turnId === turnId);
const after = await readHealth(apiUrl);
if (after.payload.hookLogStatus !== "ok" || after.payload.lastHookEvent !== "Stop") {
  throw new Error(`Lifecycle health did not clear after simulation (status ${after.payload.hookLogStatus || "unknown"}).`);
}
process.stdout.write(`${JSON.stringify({
  storageRoot,
  databasePath: environment.LANTERNWATCH_DB_PATH,
  receiptPath,
  receiptCount: receipts.length,
  sessionId,
  turnId,
  apiUrl,
  healthUrl: after.url,
  hookLogStatus: after.payload.hookLogStatus,
  lastHookEvent: after.payload.lastHookEvent,
})}\n`);
