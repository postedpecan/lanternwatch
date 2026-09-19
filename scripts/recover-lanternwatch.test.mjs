import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const directory = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.join(directory, "recover-lanternwatch.ps1");
const fixtureRoot = path.join(directory, "fixtures", "recovery");
const source = readFileSync(scriptPath, "utf8");

function makeFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "lanternwatch-recover-"));
  const codexRoot = path.join(root, "codex");
  const storageRoot = path.join(root, "storage");
  const databasePath = path.join(storageRoot, "guild.db");
  const vaultPath = path.join(root, "vault");
  const runtimeConfigPath = path.join(root, "runtime", "config.json");
  const tracePath = path.join(root, "trace.jsonl");
  mkdirSync(codexRoot, { recursive: true });
  mkdirSync(storageRoot, { recursive: true });
  mkdirSync(vaultPath, { recursive: true });
  mkdirSync(path.join(storageRoot, "logs"), { recursive: true });
  mkdirSync(path.join(storageRoot, "backups"), { recursive: true });
  writeFileSync(path.join(codexRoot, "config.toml"), 'model = "test"\nnotify = [ "unrelated.exe" ]\n', "utf8");
  writeFileSync(databasePath, "database-must-survive", "utf8");
  writeFileSync(path.join(storageRoot, "session.json"), "session-must-survive", "utf8");
  writeFileSync(path.join(storageRoot, "logs", "hook.jsonl"), "log-must-survive", "utf8");
  writeFileSync(path.join(storageRoot, "backups", "prior.txt"), "backup-must-survive", "utf8");
  writeFileSync(path.join(vaultPath, "notes.md"), "vault-must-survive", "utf8");
  return { root, codexRoot, storageRoot, databasePath, vaultPath, runtimeConfigPath, tracePath };
}

function protectedContents(fixture) {
  return [
    readFileSync(path.join(fixture.codexRoot, "config.toml"), "utf8"),
    readFileSync(fixture.databasePath, "utf8"),
    readFileSync(path.join(fixture.storageRoot, "session.json"), "utf8"),
    readFileSync(path.join(fixture.storageRoot, "logs", "hook.jsonl"), "utf8"),
    readFileSync(path.join(fixture.storageRoot, "backups", "prior.txt"), "utf8"),
    readFileSync(path.join(fixture.vaultPath, "notes.md"), "utf8"),
  ];
}

function runRecovery(fixture, extraArguments = [], extraEnvironment = {}) {
  const args = [
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath,
    "-CodexRoot", fixture.codexRoot,
    "-StorageRoot", fixture.storageRoot,
    "-DatabasePath", fixture.databasePath,
    "-VaultPath", fixture.vaultPath,
    "-RuntimeConfigPath", fixture.runtimeConfigPath,
    "-NodeExecutable", process.execPath,
    "-TestScriptRoot", fixtureRoot,
    ...extraArguments,
  ];
  return spawnSync("powershell.exe", args, {
    encoding: "utf8",
    shell: false,
    env: {
      ...process.env,
      LANTERNWATCH_RECOVERY_TRACE_PATH: fixture.tracePath,
      ...extraEnvironment,
    },
  });
}

function trace(fixture) {
  return readFileSync(fixture.tracePath, "utf8").trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
}

test("recovery script parses without executing", () => {
  const command = "$tokens = $null; $errors = $null; [System.Management.Automation.Language.Parser]::ParseFile($env:SCRIPT_TO_PARSE, [ref]$tokens, [ref]$errors) | Out-Null; if ($errors.Count) { $errors | ForEach-Object { Write-Error $_ }; exit 1 }";
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], {
    encoding: "utf8",
    shell: false,
    env: { ...process.env, SCRIPT_TO_PARSE: scriptPath },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("no flags performs a non-mutating dry-run", () => {
  const fixture = makeFixture();
  const before = protectedContents(fixture);
  const result = runRecovery(fixture);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /DRY-RUN PREFLIGHT/);
  assert.match(result.stdout, /No repair scripts ran/);
  assert.equal(existsSync(fixture.tracePath), false);
  assert.deepEqual(protectedContents(fixture), before);
});

test("restart-dashboard remains non-mutating without both real-run guards", () => {
  const fixture = makeFixture();
  const before = protectedContents(fixture);
  const result = runRecovery(fixture, ["-RestartDashboard"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Dashboard restart requested for a future real run/);
  assert.equal(existsSync(fixture.tracePath), false);
  assert.deepEqual(protectedContents(fixture), before);
});

test("real recovery requires both force and confirmation before any stage", () => {
  for (const args of [["-Force"], ["-Confirm"]]) {
    const fixture = makeFixture();
    const result = runRecovery(fixture, args);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}\n${result.stdout}`, /requires both -Force and -Confirm/);
    assert.equal(existsSync(fixture.tracePath), false);
  }
});

test("real recovery uses ordered stages, exact arguments, and one shared tuple", () => {
  const fixture = makeFixture();
  const before = protectedContents(fixture);
  const result = runRecovery(fixture, ["-Force", "-Confirm", "-RestartDashboard"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const records = trace(fixture);
  assert.deepEqual(records.map((record) => record.stage), [
    "runtime-repair", "codex-rehook", "notifier-repair", "host-restart",
  ]);
  for (const record of records) {
    assert.deepEqual(record.environment, {
      storageRoot: fixture.storageRoot,
      databasePath: fixture.databasePath,
      vaultPath: fixture.vaultPath,
      runtimeConfigPath: fixture.runtimeConfigPath,
    });
  }
  assert.equal(records[0].parameters.StorageRoot, fixture.storageRoot);
  assert.equal(records[0].parameters.DatabasePath, fixture.databasePath);
  assert.equal(records[0].parameters.VaultPath, fixture.vaultPath);
  assert.equal(records[0].parameters.RuntimeConfigPath, fixture.runtimeConfigPath);
  assert.equal(records[1].parameters.CodexRoot, fixture.codexRoot);
  assert.equal(records[2].parameters.configPath, path.join(fixture.codexRoot, "config.toml"));
  assert.equal(records[3].parameters.Force, true);
  assert.equal(records[3].parameters.Confirm, true);
  assert.equal(records[3].parameters.CodexOnly, true);
  assert.equal(records[3].parameters.RestartDashboard, true);
  assert.deepEqual(protectedContents(fixture), before);
});

test("every failed repair stage prevents host restart", () => {
  const stages = ["runtime-repair", "codex-rehook", "notifier-repair"];
  for (const stage of stages) {
    const fixture = makeFixture();
    const result = runRecovery(fixture, ["-Force", "-Confirm"], { LANTERNWATCH_RECOVERY_FAIL_STAGE: stage });
    assert.notEqual(result.status, 0, `expected ${stage} failure`);
    const observedStages = trace(fixture).map((record) => record.stage);
    assert.equal(observedStages.at(-1), stage);
    assert.equal(observedStages.includes("host-restart"), false);
    assert.doesNotMatch(`${result.stderr}\n${result.stdout}`, /\[host-restart\] Starting/);
  }
});

test("recovery has no deletion or keyboard-automation path", () => {
  assert.doesNotMatch(source, /\bRemove-Item\b|\bClear-Content\b|\bdel(?:ete)?\b|\berase\b|\brmdir\b|\brm\s+-/i);
  assert.doesNotMatch(source, /SendKeys|Windows\.Forms|keybd_event|WScript\.Shell/i);
  assert.match(source, /Configuration presence alone is not runtime proof/);
  assert.match(source, /trust and enable all five Lanternwatch handlers/);
  assert.doesNotMatch(source, /Claude/);
});
