import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { installCodexAgents, parseAgentDefinition, resolveCodexHome } from "./install-codex-agents.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function fixture(t) {
  const temp = mkdtempSync(path.join(tmpdir(), "lanternwatch-agents-"));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  return temp;
}

test("fresh install copies all roles and portable dossiers, preserves settings and full instructions", (t) => {
  const codexHome = path.join(fixture(t), "Codex home with spaces");
  const result = installCodexAgents({ codexHome });
  const nativeFiles = readdirSync(path.join(root, ".codex", "agents"));
  assert.equal(result.agentCount, 14);
  assert.equal(result.created, result.agentCount + result.dossierCount);
  for (const filename of nativeFiles) {
    const original = parseAgentDefinition(readFileSync(path.join(root, ".codex", "agents", filename), "utf8"));
    const installed = parseAgentDefinition(readFileSync(path.join(codexHome, "agents", filename), "utf8"));
    for (const [key, field] of original) if (key !== "developer_instructions") assert.equal(installed.get(key).value, field.value);
    const instructions = installed.get("developer_instructions").value;
    assert.match(instructions, /^Read applicable AGENTS\.md instructions in the current workspace when present\./);
    assert.ok(instructions.endsWith(original.get("developer_instructions").value.split("\n").slice(1).join("\n")));
    const refs = [...instructions.matchAll(/`([^`]+\/Lanternwatch\/Agents\/[^`]+\.md)`/g)];
    assert.ok(refs.length >= 4);
    for (const [, file] of refs) assert.ok(existsSync(file), file);
  }
  for (const file of readdirSync(path.join(root, "Agents")).filter((file) => file.endsWith(".md"))) {
    assert.deepEqual(readFileSync(path.join(codexHome, "Lanternwatch", "Agents", file)), readFileSync(path.join(root, "Agents", file)));
  }
  assert.equal(existsSync(path.join(codexHome, "AGENTS.md")), false);
  assert.equal(existsSync(path.join(codexHome, "config.toml")), false);
  assert.equal(existsSync(path.join(codexHome, "hooks.json")), false);
});

test("repeat is unchanged; replacements back up both native definitions and dossiers and preserve unrelated files", (t) => {
  const codexHome = fixture(t);
  installCodexAgents({ codexHome });
  const repeat = installCodexAgents({ codexHome });
  assert.equal(repeat.created + repeat.replaced, 0);
  assert.equal(repeat.unchanged, repeat.agentCount + repeat.dossierCount);
  assert.equal(existsSync(path.join(codexHome, "Lanternwatch", "backups")), false);
  const preserved = ["AGENTS.md", "config.toml", "hooks.json", "agents/custom.toml", "Lanternwatch/Agents/custom.md"];
  for (const file of preserved) writeFileSync(path.join(codexHome, file), `existing ${file}`);
  const replaced = ["agents/platform-engineer.toml", "Lanternwatch/Agents/preferences.md"];
  for (const file of replaced) writeFileSync(path.join(codexHome, file), `old ${file}`);
  const updated = installCodexAgents({ codexHome });
  assert.equal(updated.replaced, 2);
  for (const file of replaced) assert.equal(readFileSync(path.join(updated.backupDirectory, file), "utf8"), `old ${file}`);
  for (const file of preserved) assert.equal(readFileSync(path.join(codexHome, file), "utf8"), `existing ${file}`);
});

test("CLI dry run does not create its destination or replace existing files", (t) => {
  const codexHome = path.join(fixture(t), "preview");
  const run = spawnSync(process.execPath, [path.join(root, "scripts", "install-codex-agents.mjs"), "--dry-run", "--codex-home", codexHome], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /14 Codex agents/);
  assert.equal(existsSync(codexHome), false);
  installCodexAgents({ codexHome });
  const file = path.join(codexHome, "agents", "platform-engineer.toml");
  writeFileSync(file, "keep me");
  const preview = installCodexAgents({ codexHome, dryRun: true });
  assert.equal(preview.replaced, 1);
  assert.equal(readFileSync(file, "utf8"), "keep me");
  assert.equal(existsSync(path.join(codexHome, "Lanternwatch", "backups")), false);
});

test("home precedence supports explicit, environment, and user-home fallback", () => {
  assert.equal(resolveCodexHome("explicit", { CODEX_HOME: "environment" }, "fallback"), path.resolve("explicit"));
  assert.equal(resolveCodexHome(undefined, { CODEX_HOME: "environment" }, "fallback"), path.resolve("environment"));
  assert.equal(resolveCodexHome(undefined, {}, "fallback"), path.resolve("fallback", ".codex"));
});

test("source validation rejects malformed TOML or missing references before writing anything", (t) => {
  const temp = fixture(t);
  const sourceRoot = path.join(temp, "source");
  cpSync(path.join(root, "Agents"), path.join(sourceRoot, "Agents"), { recursive: true });
  cpSync(path.join(root, ".codex", "agents"), path.join(sourceRoot, ".codex", "agents"), { recursive: true });
  const file = path.join(sourceRoot, ".codex", "agents", "technical-writer.toml");
  const original = readFileSync(file, "utf8");
  const codexHome = path.join(temp, "destination");
  for (const bad of [original + '\nname = "duplicate"\n', original.replace('developer_instructions = """', 'developer_instructions = ""'), original.replace("Agents/chronicle-writer-agent.md", "Agents/missing-agent.md"), original.replace("From the repository root", "Unexpected introduction")]) {
    writeFileSync(file, bad);
    assert.throws(() => installCodexAgents({ sourceRoot, codexHome }));
    assert.equal(existsSync(codexHome), false);
  }
});

test("TOML escapes round-trip without truncating multiline instructions", () => {
  const source = 'name = "test"\ndescription = "Escaped \\"quote\\" and \\u0e44"\ndeveloper_instructions = """\nFirst \\"quote\\" and \\\\path\nSecond line\n"""\n';
  const parsed = parseAgentDefinition(source);
  assert.equal(parsed.get("description").value, 'Escaped "quote" and ไ');
  assert.equal(parsed.get("developer_instructions").value, 'First "quote" and \\path\nSecond line\n');
  assert.throws(() => parseAgentDefinition(source.replace("\\u0e44", "\\q")), /escape/);
});

test("unexpected target types and repository-local destination fail before installing", (t) => {
  const codexHome = fixture(t);
  mkdirSync(path.join(codexHome, "agents", "technical-writer.toml"), { recursive: true });
  assert.throws(() => installCodexAgents({ codexHome }), /target type/);
  assert.equal(existsSync(path.join(codexHome, "Lanternwatch")), false);
  assert.throws(() => installCodexAgents({ codexHome: path.join(root, ".codex") }), /personal Codex home/);
});
