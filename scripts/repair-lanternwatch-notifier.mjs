import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function isLanternwatchToken(value) {
  return typeof value === "string" && value.includes("guild-notify.mjs");
}

function parseTomlStringArray(body) {
  const matches = [...body.matchAll(/"(?:\\.|[^"\\])*"/g)];
  const remainder = matches.reduceRight(
    (text, match) => `${text.slice(0, match.index)}${text.slice(match.index + match[0].length)}`,
    body,
  );
  if (remainder.replace(/[\s,]/g, "") !== "") return null;
  try { return matches.map((match) => JSON.parse(match[0])); } catch { return null; }
}

function previousNotifyIsLanternwatch(value) {
  try {
    const command = JSON.parse(value);
    return Array.isArray(command) && command.some(isLanternwatchToken);
  } catch { return false; }
}

export function removeLanternwatchNotifier(configText, savedNotifier) {
  const linePattern = /^([ \t]*)notify[ \t]*=[ \t]*\[(.*?)\][ \t]*$/m;
  const match = configText.match(linePattern);
  if (!match) return { configText, changed: false, action: "notify-missing" };
  const tokens = parseTomlStringArray(match[2]);
  if (!tokens) return { configText, changed: false, action: "notify-unparsed" };

  let replacementTokens = tokens;
  let action = "not-lanternwatch";
  const previousIndex = tokens.findIndex((token, index) => token === "--previous-notify"
    && index + 1 < tokens.length && previousNotifyIsLanternwatch(tokens[index + 1]));
  if (previousIndex >= 0) {
    replacementTokens = [...tokens.slice(0, previousIndex), ...tokens.slice(previousIndex + 2)];
    action = "removed-nested-lanternwatch";
  } else if (tokens.some(isLanternwatchToken)) {
    const savedTokens = savedNotifier && typeof savedNotifier.command === "string"
      ? [savedNotifier.command, ...(Array.isArray(savedNotifier.args) ? savedNotifier.args.filter((item) => typeof item === "string") : [])]
      : [];
    replacementTokens = savedTokens.some(isLanternwatchToken) ? [] : savedTokens;
    action = replacementTokens.length ? "restored-previous-notifier" : "removed-direct-lanternwatch";
  } else {
    return { configText, changed: false, action };
  }

  const line = replacementTokens.length
    ? `${match[1]}notify = [ ${replacementTokens.map((token) => JSON.stringify(token)).join(", ")} ]`
    : "";
  const updated = configText.replace(linePattern, line).replace(/^\s*\r?\n/, "");
  return { configText: updated, changed: updated !== configText, action };
}

export function repairLanternwatchNotifier(configPath, notifierConfigPath) {
  const original = readFileSync(configPath, "utf8");
  let savedNotifier;
  try { savedNotifier = JSON.parse(readFileSync(notifierConfigPath, "utf8")); } catch {}
  const result = removeLanternwatchNotifier(original, savedNotifier);
  if (!result.changed) return { changed: false, action: result.action, backupPath: null };

  const backupDirectory = path.join(path.dirname(configPath), ".lanternwatch-backups", `notifier-repair-${Date.now()}`);
  mkdirSync(backupDirectory, { recursive: true });
  const backupPath = path.join(backupDirectory, "config.toml");
  copyFileSync(configPath, backupPath);
  writeFileSync(configPath, result.configText, "utf8");
  return { changed: true, action: result.action, backupPath };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const userHome = process.env.USERPROFILE || process.env.HOME;
  if (!userHome) throw new Error("Unable to resolve the current user profile directory.");
  const codexRoot = process.env.CODEX_HOME || path.join(userHome, ".codex");
  const configPath = process.argv[2] || path.join(codexRoot, "config.toml");
  const notifierConfigPath = process.argv[3] || path.join(codexRoot, "lanternwatch-notifier.json");
  if (!existsSync(configPath)) throw new Error(`Codex configuration not found: ${configPath}`);
  process.stdout.write(`${JSON.stringify(repairLanternwatchNotifier(configPath, notifierConfigPath))}\n`);
}
