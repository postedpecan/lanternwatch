import { existsSync, readFileSync, writeFileSync } from "node:fs";
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

export function mergeLanternwatchHooks(configuration, hooksPath, lifecycleScript, nodeExecutable) {
  if (!configuration.hooks || typeof configuration.hooks !== "object") configuration.hooks = {};
  const trustKeys = new Set();

  for (const eventName of lanternwatchEvents) {
    const existing = Array.isArray(configuration.hooks[eventName]) ? configuration.hooks[eventName] : [];
    const timeout = eventName === "SessionEnd" ? 3 : 5;
    const replacement = {
      type: "command",
      command: `node "${lifecycleScript}"`,
      commandWindows: `"${nodeExecutable}" "${lifecycleScript}"`,
      timeout,
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

    groups.forEach((group, groupIndex) => {
      group?.hooks?.forEach((hook, hookIndex) => {
        if (isLanternwatchHandler(hook)) {
          trustKeys.add(`${hooksPath}:${eventStateName(eventName)}:${groupIndex}:${hookIndex}`);
        }
      });
    });
  }

  configuration.description = configuration.description || "Codex hooks with Lanternwatch lifecycle telemetry";
  return { configuration, trustKeys: [...trustKeys] };
}

export function mergeLanternwatchHooksFile(hooksPath, lifecycleScript, nodeExecutable) {
  let configuration = { description: "Codex hooks", hooks: {} };
  if (existsSync(hooksPath)) configuration = JSON.parse(readFileSync(hooksPath, "utf8"));
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
  if (reportFlag === "--report") process.stdout.write(`${JSON.stringify({ trustKeys: result.trustKeys })}\n`);
}
