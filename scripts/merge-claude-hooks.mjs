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

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [settingsPath, lifecycleScript, nodeExecutable] = process.argv.slice(2);
  if (!settingsPath || !lifecycleScript || !nodeExecutable) {
    throw new Error("Usage: node merge-claude-hooks.mjs <settingsPath> <lifecycleScript> <nodeExecutable>");
  }
  mergeLanternwatchClaudeHooksFile(settingsPath, lifecycleScript, nodeExecutable);
}
