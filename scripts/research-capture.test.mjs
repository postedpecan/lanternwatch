import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
  captureResearch,
  normalizeResearchRecord,
  researchCapturePaths,
  retryResearchExports,
} from "./research-capture.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const captureScript = path.join(projectRoot, "scripts", "research-capture.mjs");
const fixtureRoot = mkdtempSync(path.join(tmpdir(), "lanternwatch-research-"));
after(() => rmSync(fixtureRoot, { recursive: true, force: true }));

function fixture(name) {
  return path.join(fixtureRoot, name);
}

function payload(overrides = {}) {
  return {
    taskId: "pathfinder-docs-001",
    role: "technical-researcher",
    topic: "Node SQLite documentation",
    question: "What transaction support is documented?",
    status: "complete",
    summary: "The official documentation describes synchronous transactions.",
    findings: [{
      claim: "DatabaseSync executes SQLite statements synchronously.",
      citations: ["https://nodejs.org/api/sqlite.html"],
    }],
    caveats: ["Behavior is version-specific."],
    sources: [{
      url: "https://nodejs.org/api/sqlite.html#class-databasesync",
      title: "SQLite",
      publisher: "Node.js",
      publishedAt: "2026-01-01T00:00:00.000Z",
      accessedAt: "2026-08-11T00:00:00.000Z",
      excerpt: "DatabaseSync represents a single synchronous connection.",
    }],
    startedAt: "2026-08-11T01:00:00.000Z",
    completedAt: "2026-08-11T01:05:00.000Z",
    ...overrides,
  };
}

function paths(name) {
  const root = fixture(name);
  return {
    root,
    databasePath: path.join(root, "store", "research.db"),
    vaultPath: path.join(root, "vault"),
  };
}

function rows(databasePath, sql) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return database.prepare(sql).all();
  } finally {
    database.close();
  }
}

function runCaptureProcess(inputPath, databasePath, vaultPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [captureScript, "capture", "--file", inputPath], {
      cwd: projectRoot,
      env: {
        ...process.env,
        LANTERNWATCH_RESEARCH_DB_PATH: databasePath,
        LANTERNWATCH_RESEARCH_VAULT_PATH: vaultPath,
      },
      shell: false,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function runRetryProcess(databasePath, vaultPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      captureScript,
      "retry",
      "--database",
      databasePath,
      "--vault",
      vaultPath,
    ], {
      cwd: projectRoot,
      env: process.env,
      shell: false,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("research paths use the project-local database and honor both environment overrides", () => {
  const defaults = researchCapturePaths({});
  assert.equal(defaults.databasePath, path.join(projectRoot, ".lanternwatch", "research.db"));
  assert.equal(defaults.vaultPath, String.raw`D:\VibeCoding\Vibe Coding\Wiki\Lanternwatch`);
  const overridden = researchCapturePaths({
    LANTERNWATCH_RESEARCH_DB_PATH: fixture(path.join("override", "research.db")),
    LANTERNWATCH_RESEARCH_VAULT_PATH: fixture(path.join("override", "vault")),
  });
  assert.equal(overridden.databasePath, fixture(path.join("override", "research.db")));
  assert.equal(overridden.vaultPath, fixture(path.join("override", "vault")));
});

test("clean database capture persists once and exports the complete Markdown contract", () => {
  const location = paths("clean");
  const result = captureResearch(payload(), location);
  assert.equal(result.created, true);
  assert.equal(result.exportStatus, "exported");

  const records = rows(location.databasePath, "SELECT * FROM research_records");
  assert.equal(records.length, 1);
  assert.equal(records[0].role, "technical-researcher");
  assert.equal(records[0].export_status, "exported");
  assert.equal(rows(location.databasePath, "SELECT * FROM research_sources").length, 1);
  assert.equal(rows(location.databasePath, "SELECT * FROM research_schema_migrations").length, 1);

  const note = readFileSync(path.join(location.vaultPath, records[0].note_filename), "utf8");
  assert.match(note, /^---\nlanternwatch: research/mu);
  assert.match(note, /status: "complete"/u);
  assert.match(note, /role: "technical-researcher"/u);
  assert.match(note, /## Research question/u);
  assert.match(note, /## Executive summary/u);
  assert.match(note, /## Verified findings/u);
  assert.match(note, /## Caveats and unresolved questions/u);
  assert.match(note, /## Sources/u);
  assert.match(note, /https:\/\/nodejs\.org\/api\/sqlite\.html/u);
  assert.match(note, /Supporting|DatabaseSync represents/u);
});

test("migration is additive and repeatable for an existing unrelated database", () => {
  const location = paths("existing");
  mkdirSync(path.dirname(location.databasePath), { recursive: true });
  const existing = new DatabaseSync(location.databasePath);
  existing.exec("CREATE TABLE existing_history (id INTEGER PRIMARY KEY, value TEXT NOT NULL); INSERT INTO existing_history (value) VALUES ('preserved');");
  existing.close();

  captureResearch(payload({ taskId: "existing-db-task" }), location);
  captureResearch(payload({ taskId: "second-migration-pass" }), location);
  assert.equal(rows(location.databasePath, "SELECT value FROM existing_history")[0].value, "preserved");
  assert.equal(rows(location.databasePath, "SELECT * FROM research_schema_migrations").length, 1);
  assert.equal(rows(location.databasePath, "SELECT * FROM research_records").length, 2);
});

test("legacy CHECK-constrained research rows migrate repeatably without losing records, sources, or export metadata", () => {
  const location = paths("legacy-role-migration");
  mkdirSync(path.dirname(location.databasePath), { recursive: true });
  const database = new DatabaseSync(location.databasePath);
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE research_schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    INSERT INTO research_schema_migrations VALUES (1, '2026-08-01T00:00:00.000Z');
    CREATE TABLE research_records (
      id INTEGER PRIMARY KEY,
      task_id TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL CHECK (role IN ('pathfinder', 'courier')),
      topic TEXT NOT NULL,
      question TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('complete', 'incomplete')),
      summary TEXT NOT NULL,
      findings_json TEXT NOT NULL,
      caveats_json TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      note_filename TEXT NOT NULL UNIQUE,
      export_status TEXT NOT NULL DEFAULT 'pending' CHECK (export_status IN ('pending', 'exported', 'failed')),
      export_error TEXT,
      exported_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE research_sources (
      id INTEGER PRIMARY KEY,
      research_id INTEGER NOT NULL REFERENCES research_records(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      publisher TEXT NOT NULL DEFAULT '',
      published_at TEXT,
      accessed_at TEXT,
      excerpt TEXT NOT NULL DEFAULT '',
      UNIQUE (research_id, url)
    );
    INSERT INTO research_records VALUES
      (41, 'legacy-pathfinder', 'pathfinder', 'Legacy technical', 'Question A', 'complete', 'Summary A', '[]', '[]', NULL, '2026-08-01T01:00:00.000Z', '2026-08-01T01:01:00.000Z', 'legacy-technical.md', 'pending', NULL, NULL, '2026-08-01T01:01:00.000Z', '2026-08-01T01:01:00.000Z'),
      (42, 'legacy-courier', 'courier', 'Legacy market', 'Question B', 'incomplete', 'Summary B', '[]', '["Awaiting confirmation"]', NULL, '2026-08-01T02:00:00.000Z', '2026-08-01T02:01:00.000Z', 'legacy-market.md', 'failed', 'Error:EACCES: Obsidian note export failed', NULL, '2026-08-01T02:01:00.000Z', '2026-08-01T02:01:00.000Z');
    INSERT INTO research_sources VALUES
      (71, 41, 'https://nodejs.org/api/sqlite.html', 'SQLite', 'Node.js', NULL, NULL, 'Technical source'),
      (72, 42, 'https://example.com/market', 'Market', 'Example', NULL, NULL, 'Market source');
  `);
  database.close();

  const first = retryResearchExports(location);
  const second = retryResearchExports(location);
  assert.deepEqual(first.map((result) => result.status), ["exported", "exported"]);
  assert.deepEqual(second, []);
  const records = rows(location.databasePath, "SELECT id, task_id, role, note_filename, export_status FROM research_records ORDER BY id");
  assert.deepEqual(records.map((record) => ({ ...record })), [
    { id: 41, task_id: "legacy-pathfinder", role: "technical-researcher", note_filename: "legacy-technical.md", export_status: "exported" },
    { id: 42, task_id: "legacy-courier", role: "market-intelligence-analyst", note_filename: "legacy-market.md", export_status: "exported" },
  ]);
  assert.deepEqual(rows(location.databasePath, "SELECT id, research_id FROM research_sources ORDER BY id").map((row) => ({ ...row })), [
    { id: 71, research_id: 41 },
    { id: 72, research_id: 42 },
  ]);
  assert.deepEqual(rows(location.databasePath, "SELECT version FROM research_schema_migrations ORDER BY version").map((row) => row.version), [1, 2]);
  assert.match(readFileSync(path.join(location.vaultPath, "legacy-technical.md"), "utf8"), /role: "technical-researcher"/u);
  assert.match(readFileSync(path.join(location.vaultPath, "legacy-market.md"), "utf8"), /role: "market-intelligence-analyst"/u);
});

test("duplicate task IDs are harmless and never overwrite the first authoritative record", () => {
  const location = paths("duplicate");
  const first = captureResearch(payload({ taskId: "same-task" }), location);
  const second = captureResearch(payload({
    taskId: "same-task",
    topic: "Changed duplicate",
    summary: "This duplicate must not replace the first record.",
  }), location);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.noteFilename, first.noteFilename);
  assert.equal(second.exportStatus, "exported");
  const records = rows(location.databasePath, "SELECT * FROM research_records");
  assert.equal(records.length, 1);
  assert.equal(records[0].topic, "Node SQLite documentation");
  assert.equal(rows(location.databasePath, "SELECT * FROM research_sources").length, 1);
});

test("incomplete research is persisted and exported with a visible warning", () => {
  const location = paths("incomplete");
  captureResearch(payload({
    taskId: "courier-partial",
    role: "courier",
    topic: "Developing report",
    status: "incomplete",
    findings: [],
    sources: [],
    caveats: ["No independent confirmation was available."],
  }), location);
  const record = rows(location.databasePath, "SELECT * FROM research_records")[0];
  const note = readFileSync(path.join(location.vaultPath, record.note_filename), "utf8");
  assert.equal(record.role, "market-intelligence-analyst", "legacy courier input is canonicalized before persistence");
  assert.equal(record.status, "incomplete");
  assert.match(note, /\[!warning\] Incomplete research/u);
  assert.match(note, /No public sources were available/u);
});

test("an unavailable vault leaves a failed retryable row, and the manual CLI retry later exports it", async () => {
  const location = paths("retry");
  const obstruction = path.join(location.root, "occupied");
  mkdirSync(location.root, { recursive: true });
  writeFileSync(obstruction, "not a directory");
  const blockedVault = path.join(obstruction, "Lanternwatch");
  const result = captureResearch(payload({ taskId: "retry-task" }), {
    databasePath: location.databasePath,
    vaultPath: blockedVault,
  });
  assert.equal(result.exportStatus, "failed");
  let record = rows(location.databasePath, "SELECT * FROM research_records")[0];
  assert.equal(record.export_status, "failed");
  assert.match(record.export_error, /^Error:ENOTDIR: Obsidian note export failed$/u);
  assert.doesNotMatch(record.export_error, /occupied|Lanternwatch/u);

  unlinkSync(obstruction);
  const retry = await runRetryProcess(location.databasePath, blockedVault);
  assert.equal(retry.code, 0, retry.stderr);
  assert.equal(retry.stderr, "");
  assert.deepEqual(JSON.parse(retry.stdout), { retried: 1, exported: 1, failed: 0 });
  record = rows(location.databasePath, "SELECT * FROM research_records")[0];
  assert.equal(record.export_status, "exported");
  assert.equal(record.export_error, null);
  assert.ok(readFileSync(path.join(blockedVault, record.note_filename), "utf8"));
});

test("the next capture retries a prior failed export without blocking the new record", () => {
  const location = paths("next-capture-retry");
  const obstruction = path.join(location.root, "occupied");
  mkdirSync(location.root, { recursive: true });
  writeFileSync(obstruction, "not a directory");
  const blockedVault = path.join(obstruction, "Lanternwatch");

  const first = captureResearch(payload({ taskId: "retry-on-next-first" }), {
    databasePath: location.databasePath,
    vaultPath: blockedVault,
  });
  assert.equal(first.exportStatus, "failed");

  unlinkSync(obstruction);
  const second = captureResearch(payload({ taskId: "retry-on-next-second" }), {
    databasePath: location.databasePath,
    vaultPath: blockedVault,
  });
  assert.equal(second.created, true);
  assert.equal(second.exportStatus, "exported");
  assert.equal(second.retried, 2);

  const records = rows(location.databasePath, "SELECT * FROM research_records ORDER BY task_id");
  assert.equal(records.length, 2);
  assert.deepEqual(records.map((record) => record.export_status), ["exported", "exported"]);
  for (const record of records) {
    assert.ok(readFileSync(path.join(blockedVault, record.note_filename), "utf8"));
  }
});

test("CLI capture treats vault failure as a sanitized non-blocking warning", async () => {
  const location = paths("cli-warning");
  const obstruction = path.join(location.root, "private-vault-parent");
  mkdirSync(location.root, { recursive: true });
  writeFileSync(obstruction, "not a directory");
  const blockedVault = path.join(obstruction, "Lanternwatch");
  const inputPath = path.join(location.root, "input.json");
  writeFileSync(inputPath, JSON.stringify(payload({ taskId: "cli-warning-task" })));

  const result = await runCaptureProcess(inputPath, location.databasePath, blockedVault);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    taskId: "cli-warning-task",
    created: true,
    exportStatus: "failed",
    noteFilename: "2026-08-11-node-sqlite-documentation-cli-warning-task-98eaa16f0b.md",
    retried: 1,
  });
  assert.match(result.stderr, /^Lanternwatch research export warning \(Error:ENOTDIR: Obsidian note export failed\)\.\n$/u);
  assert.doesNotMatch(result.stderr, /private-vault-parent|Lanternwatch\\|lanternwatch-research-/u);
  assert.equal(rows(location.databasePath, "SELECT export_status FROM research_records")[0].export_status, "failed");
});

test("public-source validation rejects local, private, authenticated, and non-web URLs before DB creation", () => {
  const rejected = [
    "http://localhost/private",
    "http://127.0.0.1/private",
    "http://192.168.1.2/private",
    "http://service.internal/private",
    "http://intranet/private",
    "file:///C:/private.txt",
    "https://user:password@example.com/private",
  ];
  for (const [index, url] of rejected.entries()) {
    const location = paths(`private-${index}`);
    assert.throws(() => captureResearch(payload({
      taskId: `private-${index}`,
      sources: [{ url, title: "Private" }],
    }), location), /public|private|unauthenticated/u);
    assert.equal(rowsIfPresent(location.databasePath), 0);
  }
});

function rowsIfPresent(databasePath) {
  try {
    return rows(databasePath, "SELECT * FROM research_records").length;
  } catch {
    return 0;
  }
}

test("normalization keeps only the public research contract and caps supporting excerpts", () => {
  const normalized = normalizeResearchRecord(payload({
    rawPrompt: "must never be stored",
    credentials: "must never be stored",
    reasoning: "must never be stored",
  }), new Date("2026-08-11T02:00:00.000Z"));
  assert.equal("rawPrompt" in normalized, false);
  assert.equal("credentials" in normalized, false);
  assert.equal("reasoning" in normalized, false);
  assert.throws(() => normalizeResearchRecord(payload({
    sources: [{ url: "https://example.com", excerpt: "x".repeat(1_001) }],
  })), /exceeds 1000/u);
});

test("concurrent distinct CLI captures produce distinct records and deterministic notes", async () => {
  const location = paths("concurrent");
  mkdirSync(location.root, { recursive: true });
  const captures = Array.from({ length: 6 }, (_, index) => {
    const inputPath = path.join(location.root, `input-${index}.json`);
    writeFileSync(inputPath, JSON.stringify(payload({
      taskId: `parallel-task-${index}`,
      topic: "Same slug topic",
    })));
    return runCaptureProcess(inputPath, location.databasePath, location.vaultPath);
  });
  const results = await Promise.all(captures);
  for (const result of results) {
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stderr, "");
  }
  const records = rows(location.databasePath, "SELECT * FROM research_records ORDER BY task_id");
  assert.equal(records.length, 6);
  assert.equal(new Set(records.map((record) => record.note_filename)).size, 6);
  for (const record of records) {
    assert.equal(record.export_status, "exported");
    assert.ok(readFileSync(path.join(location.vaultPath, record.note_filename), "utf8"));
  }
});
