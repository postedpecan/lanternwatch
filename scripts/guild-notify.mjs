import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const reportScript = path.join(path.dirname(fileURLToPath(import.meta.url)), "guild-report.mjs");

function text(value, max) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
}

export function safeNotifyPayload(rawPayload) {
  let input = {};
  try {
    const payload = JSON.parse(rawPayload);
    if (payload && typeof payload === "object" && !Array.isArray(payload)) input = payload;
  } catch {}
  const safe = {};
  const cwd = text(input.cwd ?? input["project-path"], 1000);
  const threadId = text(input["thread-id"] ?? input.thread_id, 180);
  const turnId = text(input["turn-id"] ?? input.turn_id, 180);
  if (cwd) safe.cwd = cwd;
  if (threadId) safe["thread-id"] = threadId;
  if (turnId) safe["turn-id"] = turnId;
  return safe;
}

export function reporterFallbackCommand(rawPayload, nodeExecutable = process.execPath, script = reportScript) {
  return {
    command: nodeExecutable,
    args: [script, "--notify", JSON.stringify(safeNotifyPayload(rawPayload)), "--quiet"],
    options: { detached: true, stdio: "ignore", windowsHide: true, shell: false },
  };
}

export function notifierConfigPath(environment = process.env) {
  const home = environment.USERPROFILE || environment.HOME || os.homedir();
  const codexRoot = environment.CODEX_HOME || path.join(home, ".codex");
  return path.resolve(environment.LANTERNWATCH_NOTIFIER_CONFIG || path.join(codexRoot, "lanternwatch-notifier.json"));
}

export function existingNotifierCommand(rawPayload, environment = process.env) {
  try {
    const configuration = JSON.parse(readFileSync(notifierConfigPath(environment), "utf8"));
    if (!configuration || typeof configuration.command !== "string" || !configuration.command.trim()) return undefined;
    const args = Array.isArray(configuration.args)
      ? configuration.args.filter((argument) => typeof argument === "string")
      : [];
    if (args.some((argument) => argument.includes("guild-notify.mjs"))) return undefined;
    return {
      command: configuration.command,
      args: [...args, rawPayload],
      options: { detached: true, stdio: "ignore", windowsHide: true, shell: false },
    };
  } catch {
    return undefined;
  }
}

export function runNotifier(rawPayload) {
  const fallback = reporterFallbackCommand(rawPayload);
  const existing = existingNotifierCommand(rawPayload);
  for (const childProcess of [existing, fallback].filter(Boolean)) {
    try {
      const child = spawn(childProcess.command, childProcess.args, childProcess.options);
      child.on("error", () => {});
      child.unref();
    } catch {}
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let payloadIndex = 2;
  if (process.argv[2] === "--notifier-config" && process.argv[3]) {
    process.env.LANTERNWATCH_NOTIFIER_CONFIG = process.argv[3];
    payloadIndex = 4;
  }
  runNotifier(process.argv[payloadIndex] || "{}");
}
