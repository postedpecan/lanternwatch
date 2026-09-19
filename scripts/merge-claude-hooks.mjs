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
  const args = Array.isArray(hook?.args) ? hook.args : [];
  return args.some((argument) => String(argument).includes("guild-lifecycle-hook.mjs"));
}

export function removeLanternwatchClaudeHooks(configuration) {
  if (!configuration?.hooks || typeof configuration.hooks !== "object") {
    return { configuration, removed: 0, events: [] };
  }

  let removed = 0;
  const events = [];
  for (const eventName of lanternwatchEvents) {
    const existing = configuration.hooks[eventName];
    if (!Array.isArray(existing)) continue;
    let removedFromEvent = 0;

    const groups = existing.flatMap((group) => {
      if (!Array.isArray(group?.hooks)) return [group];
      const handlers = group.hooks.filter((hook) => {
        if (!isLanternwatchHandler(hook)) return true;
        removed += 1;
        removedFromEvent += 1;
        return false;
      });
      return handlers.length > 0 ? [{ ...group, hooks: handlers }] : [];
    });

    if (groups.length > 0) configuration.hooks[eventName] = groups;
    else delete configuration.hooks[eventName];
    if (removedFromEvent > 0) events.push(eventName);
  }

  return { configuration, removed, events };
}

// Claude Code's global settings.json hooks run without a separate trust step
// (unlike Codex's hooks.json), so there is no trust-key bookkeeping to return.
export function mergeLanternwatchClaudeHooks(configuration, lifecycleScript, nodeExecutable) {
  if (!configuration.hooks || typeof configuration.hooks !== "object") configuration.hooks = {};

  for (const eventName of lanternwatchEvents) {
    const existing = Array.isArray(configuration.hooks[eventName]) ? configuration.hooks[eventName] : [];
    const timeout = eventName === "SessionEnd" ? 3 : 5;
    const replacement = {
      type: "command",
      command: nodeExecutable,
      args: [lifecycleScript, "claude"],
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
  }

  return configuration;
}

export function mergeLanternwatchClaudeHooksFile(settingsPath, lifecycleScript, nodeExecutable) {
  let configuration = {};
  if (existsSync(settingsPath)) configuration = JSON.parse(readFileSync(settingsPath, "utf8"));
  const result = mergeLanternwatchClaudeHooks(configuration, lifecycleScript, nodeExecutable);
  writeFileSync(settingsPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return result;
}

export function removeLanternwatchClaudeHooksFile(settingsPath) {
  if (!existsSync(settingsPath)) return { configuration: {}, removed: 0, events: [] };
  const configuration = JSON.parse(readFileSync(settingsPath, "utf8"));
  const result = removeLanternwatchClaudeHooks(configuration);
  writeFileSync(settingsPath, `${JSON.stringify(result.configuration, null, 2)}\n`, "utf8");
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv[2] === "--remove") {
    const settingsPath = process.argv[3];
    if (!settingsPath || process.argv.length !== 4) {
      throw new Error("Usage: node merge-claude-hooks.mjs --remove <settingsPath>");
    }
    process.stdout.write(`${JSON.stringify(removeLanternwatchClaudeHooksFile(settingsPath))}\n`);
    process.exit(0);
  }
  const [settingsPath, lifecycleScript, nodeExecutable] = process.argv.slice(2);
  if (!settingsPath || !lifecycleScript || !nodeExecutable) {
    throw new Error("Usage: node merge-claude-hooks.mjs <settingsPath> <lifecycleScript> <nodeExecutable>");
  }
  mergeLanternwatchClaudeHooksFile(settingsPath, lifecycleScript, nodeExecutable);
}
