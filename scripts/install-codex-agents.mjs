import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function resolveCodexHome(override, environment = process.env, userHome = homedir()) {
  return path.resolve(override || environment.CODEX_HOME || path.join(userHome, ".codex"));
}

// The checked-in definitions use flat TOML string settings. Fail closed on new
// syntax instead of silently losing settings or partially rewriting instructions.
export function parseAgentDefinition(source, filename = "agent.toml") {
  const fields = new Map();
  const token = /\s*(?:#[^\n]*(?:\n|$)\s*)*([A-Za-z_][\w-]*)\s*=\s*("""(?:\\[\s\S]|[^\\])*?"""|"(?:\\[^\r\n]|[^"\\\r\n])*"|'[^'\r\n]*')[ \t]*(?:#[^\n]*)?(?:\r?\n|$)/dy;
  let offset = 0;
  while (source.slice(offset).trim()) {
    if (/^(?:\s|#[^\n]*(?:\n|$))*$/.test(source.slice(offset))) break;
    token.lastIndex = offset;
    const match = token.exec(source);
    if (!match || fields.has(match[1])) throw new Error(`Invalid or unsupported TOML in ${filename}; expected unique flat string settings.`);
    const literal = match[2];
    let value;
    if (literal.startsWith("'")) {
      value = literal.slice(1, -1);
    } else {
      const multiline = literal.startsWith('"""');
      let body = literal.slice(multiline ? 3 : 1, multiline ? -3 : -1).replace(/\r\n/g, "\n");
      if (multiline) body = body.replace(/^\n/, "").replace(/\\[ \t]*\n\s*/g, "");
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(body)) throw new Error(`Invalid control character in ${filename}.`);
      value = body.replace(/\\(u[\da-fA-F]{4}|U[\da-fA-F]{8}|[\s\S])/g, (_, escape) => {
        const simple = { b: "\b", t: "\t", n: "\n", f: "\f", r: "\r", '"': '"', "\\": "\\" };
        if (Object.hasOwn(simple, escape)) return simple[escape];
        if (/^[uU]/.test(escape) && escape.length > 1) {
          const code = Number.parseInt(escape.slice(1), 16);
          if (code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)) return String.fromCodePoint(code);
        }
        throw new Error(`Invalid TOML escape in ${filename}.`);
      });
    }
    const valueStart = match.indices[2][0];
    fields.set(match[1], { value, start: valueStart, end: valueStart + literal.length });
    offset = token.lastIndex;
  }
  for (const key of ["name", "description", "developer_instructions"]) {
    if (!fields.get(key)?.value.trim()) throw new Error(`Missing ${key} in ${filename}.`);
  }
  return fields;
}

function inspectTarget(filename, codexHome) {
  let current = filename;
  while (true) {
    let stat;
    try { stat = lstatSync(current); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if (stat) {
      if (stat.isSymbolicLink()) throw new Error(`Refusing linked installation target: ${current}`);
      if (current === filename ? !stat.isFile() : !stat.isDirectory()) throw new Error(`Unexpected installation target type: ${current}`);
    }
    if (current === codexHome) break;
    current = path.dirname(current);
  }
}

export function installCodexAgents({ codexHome = resolveCodexHome(), sourceRoot = repositoryRoot, dryRun = false } = {}) {
  codexHome = path.resolve(codexHome);
  sourceRoot = path.resolve(sourceRoot);
  if (codexHome === path.join(sourceRoot, ".codex")) throw new Error("Choose a personal Codex home, not this repository's .codex directory.");
  const dossierSource = path.join(sourceRoot, "Agents");
  const nativeSource = path.join(sourceRoot, ".codex", "agents");
  const dossierFiles = readdirSync(dossierSource).filter((name) => name.endsWith(".md")).sort();
  const nativeFiles = readdirSync(nativeSource).filter((name) => name.endsWith(".toml")).sort();
  if (!nativeFiles.length || !dossierFiles.length) throw new Error("No agent definitions or dossiers found.");
  const planned = dossierFiles.map((name) => ({ relative: path.join("Lanternwatch", "Agents", name), content: readFileSync(path.join(dossierSource, name)) }));
  const installedNames = new Set();
  for (const filename of nativeFiles) {
    const source = readFileSync(path.join(nativeSource, filename), "utf8");
    const fields = parseAgentDefinition(source, filename);
    const name = fields.get("name").value;
    if (name !== path.basename(filename, ".toml") || installedNames.has(name)) throw new Error(`Agent name must uniquely match its filename: ${filename}`);
    installedNames.add(name);
    const instructions = fields.get("developer_instructions");
    const intro = "From the repository root, read AGENTS.md, ";
    if (!instructions.value.startsWith(intro)) throw new Error(`Unrecognized workspace introduction in ${filename}; no files changed.`);
    const refs = [...instructions.value.matchAll(/\bAgents\/([\w-]+\.md)\b/g)];
    for (const required of ["capabilities.md", "preferences.md", "patron.md"]) {
      if (!refs.some((match) => match[1] === required)) throw new Error(`Missing ${required} reference in ${filename}.`);
    }
    if (!refs.some((match) => match[1].endsWith("-agent.md"))) throw new Error(`Missing role dossier in ${filename}.`);
    const rewritten = ("Read applicable AGENTS.md instructions in the current workspace when present. Read " + instructions.value.slice(intro.length))
      .replace(/\bAgents\/([\w-]+\.md)\b/g, (_, file) => {
        if (!dossierFiles.includes(file)) throw new Error(`Missing dossier ${file} referenced by ${filename}.`);
        return '`' + path.join(codexHome, "Lanternwatch", "Agents", file).replaceAll("\\", "/") + '`';
      });
    const content = source.slice(0, instructions.start) + JSON.stringify(rewritten) + source.slice(instructions.end);
    parseAgentDefinition(content, filename);
    planned.push({ relative: path.join("agents", filename), content: Buffer.from(content) });
  }
  // Read/validate the entire plan before creating directories or replacing files.
  for (const item of planned) {
    item.target = path.join(codexHome, item.relative);
    inspectTarget(item.target, codexHome);
    item.previous = existsSync(item.target) ? readFileSync(item.target) : undefined;
    item.action = item.previous?.equals(item.content) ? "unchanged" : item.previous ? "replace" : "create";
  }
  const changed = planned.filter((item) => item.action !== "unchanged");
  const replaced = planned.filter((item) => item.action === "replace");
  let backupDirectory;
  if (!dryRun && changed.length) {
    if (replaced.length) {
      const backupRoot = path.join(codexHome, "Lanternwatch", "backups");
      inspectTarget(path.join(backupRoot, "placeholder"), codexHome);
      mkdirSync(backupRoot, { recursive: true });
      backupDirectory = mkdtempSync(path.join(backupRoot, `agents-${new Date().toISOString().replaceAll(":", "-")}-`));
      for (const item of replaced) {
        const backup = path.join(backupDirectory, item.relative);
        mkdirSync(path.dirname(backup), { recursive: true });
        copyFileSync(item.target, backup);
      }
    }
    for (const item of changed) {
      mkdirSync(path.dirname(item.target), { recursive: true });
      writeFileSync(item.target, item.content);
    }
  }
  return { codexHome, dryRun, agentCount: nativeFiles.length, dossierCount: dossierFiles.length, created: planned.filter((item) => item.action === "create").length, replaced: replaced.length, unchanged: planned.length - changed.length, backupDirectory, files: planned.map(({ relative, action }) => ({ relative, action })) };
}

function main(args) {
  let override;
  let dryRun = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--dry-run") dryRun = true;
    else if (args[index] === "--codex-home" && args[index + 1] && !args[index + 1].startsWith("--")) override = args[++index];
    else if (args[index] === "--help") {
      console.log("Usage: npm run agents:install:global -- [--dry-run] [--codex-home PATH]\nDestination: --codex-home, then CODEX_HOME, then ~/.codex. No hooks or root configuration changes.");
      return;
    } else throw new Error(`Unknown or incomplete argument: ${args[index]}`);
  }
  const result = installCodexAgents({ codexHome: resolveCodexHome(override), dryRun });
  console.log(`${dryRun ? "Preview" : "Installed"}: ${result.agentCount} Codex agents and ${result.dossierCount} dossier files in ${result.codexHome}`);
  console.log(`${result.created} create, ${result.replaced} replace (backed up), ${result.unchanged} unchanged${dryRun ? "; no files written" : ""}.`);
  if (result.backupDirectory) console.log(`Backups: ${result.backupDirectory}`);
  if (dryRun) for (const file of result.files) console.log(`  ${file.action}: ${file.relative}`);
  else console.log("Start a new Codex session to discover the personal agents. Project agents with the same name take precedence.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(`Agent installation failed: ${error.message}`); process.exitCode = 1; }
}
