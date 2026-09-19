import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const lanternwatchEvents = [
  "UserPromptSubmit",
  "Stop",
  "SubagentStart",
  "SubagentStop",
  "SessionEnd",
];

function isLanternwatchHandler(hook) {
  return String(hook?.command || "").includes("guild-lifecycle-hook.mjs")
    || String(hook?.commandWindows || "").includes("guild-lifecycle-hook.mjs");
}

function eventStateName(eventName) {
  return eventName.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

export function windowsHookLauncherPath(hooksPath) {
  return path.win32.join(path.win32.dirname(hooksPath), "LanternWatch", "guild-lifecycle-hook.cmd");
}

function batchQuotedPath(value, label) {
  if (typeof value !== "string" || !value.trim() || /[\r\n"]/.test(value)) {
    throw new Error(`${label} is not a safe Windows path.`);
  }
  return `"${value.replaceAll("%", "%%")}"`;
}

export function writeWindowsHookLauncher(launcherPath, lifecycleScript, nodeExecutable) {
  mkdirSync(path.dirname(launcherPath), { recursive: true });
  const contents = [
    "@echo off",
    `${batchQuotedPath(nodeExecutable, "Node executable")} ${batchQuotedPath(lifecycleScript, "Lifecycle script")}`,
    "exit /b %errorlevel%",
    "",
  ].join("\r\n");
  if (!existsSync(launcherPath) || readFileSync(launcherPath, "utf8") !== contents) {
    writeFileSync(launcherPath, contents, "utf8");
  }
}

function isQuoteFreeWindowsPath(value) {
  return typeof value === "string" && value.length > 0 && !/[\s"&|<>^()%!]/.test(value);
}

export function windowsHookCommand(hooksPath, lifecycleScript, nodeExecutable) {
  if (isQuoteFreeWindowsPath(nodeExecutable) && isQuoteFreeWindowsPath(lifecycleScript)) {
    return `${nodeExecutable} ${lifecycleScript}`;
  }
  return `"${windowsHookLauncherPath(hooksPath)}"`;
}

export function mergeLanternwatchHooks(configuration, hooksPath, lifecycleScript, nodeExecutable) {
  if (!configuration.hooks || typeof configuration.hooks !== "object") configuration.hooks = {};
  const trustKeys = new Set();
  const trustKeysToReset = new Set();

  for (const eventName of lanternwatchEvents) {
    const existing = Array.isArray(configuration.hooks[eventName]) ? configuration.hooks[eventName] : [];
    const existingSnapshot = JSON.stringify(existing);
    const asynchronousHeartbeat = eventName === "UserPromptSubmit";
    const timeout = asynchronousHeartbeat ? 43_260 : eventName === "SessionEnd" ? 3 : 5;
    const replacement = {
      type: "command",
      command: `node "${lifecycleScript}"`,
      // Codex 0.154.0 wraps commandWindows in another quoted `cmd.exe /C`
      // argument. Avoid embedded quotes when both paths permit it. For paths
      // that require quoting, use one leading quoted launcher path and put the
      // real quoted paths inside that batch file instead.
      commandWindows: windowsHookCommand(hooksPath, lifecycleScript, nodeExecutable),
      timeout,
      ...(asynchronousHeartbeat ? { async: true } : {}),
    };
    let installed = false;

    const groups = existing.flatMap((group) => {
      if (!Array.isArray(group?.hooks)) return [group];
      const handlers = group.hooks.flatMap((hook) => {
        if (!isLanternwatchHandler(hook)) return [hook];
        if (installed) return [];
        installed = true;
        return [replacement];
      });
      return handlers.length > 0 ? [{ ...group, hooks: handlers }] : [];
    });

    if (!installed) groups.push({ hooks: [replacement] });
    configuration.hooks[eventName] = groups;
    const eventChanged = JSON.stringify(groups) !== existingSnapshot;

    groups.forEach((group, groupIndex) => {
      group?.hooks?.forEach((hook, hookIndex) => {
        if (isLanternwatchHandler(hook)) {
          const trustKey = `${hooksPath}:${eventStateName(eventName)}:${groupIndex}:${hookIndex}`;
          trustKeys.add(trustKey);
          if (eventChanged) trustKeysToReset.add(trustKey);
        }
      });
    });
  }

  configuration.description = configuration.description || "Codex hooks with Lanternwatch lifecycle telemetry";
  return {
    configuration,
    trustKeys: [...trustKeys],
    trustKeysToReset: [...trustKeysToReset],
  };
}

export function mergeLanternwatchHooksFile(hooksPath, lifecycleScript, nodeExecutable) {
  let configuration = { description: "Codex hooks", hooks: {} };
  if (existsSync(hooksPath)) configuration = JSON.parse(readFileSync(hooksPath, "utf8"));
  writeWindowsHookLauncher(windowsHookLauncherPath(hooksPath), lifecycleScript, nodeExecutable);
  const result = mergeLanternwatchHooks(configuration, hooksPath, lifecycleScript, nodeExecutable);
  writeFileSync(hooksPath, `${JSON.stringify(result.configuration, null, 2)}\n`, "utf8");
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [hooksPath, lifecycleScript, nodeExecutable, reportFlag] = process.argv.slice(2);
  if (!hooksPath || !lifecycleScript || !nodeExecutable) {
    throw new Error("Usage: node merge-hooks.mjs <hooksPath> <lifecycleScript> <nodeExecutable> [--report]");
  }
  const result = mergeLanternwatchHooksFile(hooksPath, lifecycleScript, nodeExecutable);
  if (reportFlag === "--report") {
    process.stdout.write(`${JSON.stringify({
      trustKeys: result.trustKeys,
      trustKeysToReset: result.trustKeysToReset,
    })}\n`);
  }
}
