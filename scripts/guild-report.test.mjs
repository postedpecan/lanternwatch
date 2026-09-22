import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { writeDirect } from "./guild-report.mjs";

function withFixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "lanternwatch-reporter-"));
  const previousDatabase = process.env.LANTERNWATCH_DB_PATH;
  const previousStorage = process.env.LANTERNWATCH_STORAGE_ROOT;
  process.env.LANTERNWATCH_DB_PATH = path.join(root, "guild.db");
  delete process.env.LANTERNWATCH_STORAGE_ROOT;
  t.after(() => {
    if (previousDatabase === undefined) delete process.env.LANTERNWATCH_DB_PATH;
    else process.env.LANTERNWATCH_DB_PATH = previousDatabase;
    if (previousStorage === undefined) delete process.env.LANTERNWATCH_STORAGE_ROOT;
    else process.env.LANTERNWATCH_STORAGE_ROOT = previousStorage;
    rmSync(root, { recursive: true, force: true });
  });
  return process.env.LANTERNWATCH_DB_PATH;
}

function event(overrides = {}) {
  return {
    eventId: "fallback-usage-event",
    projectPath: "C:\\fixture\\project",
    projectName: "project",
    runId: "fallback-usage-run",
    source: "claude",
    agent: "frontend-engineer",
    agentType: "frontend-engineer",
    agentInstanceId: "frontend-1",
    status: "complete",
    message: "Recorded through direct fallback.",
    quest: "Fallback usage fixture",
    occurredAt: "2026-09-22T00:00:00.000Z",
    runComplete: true,
    ...overrides,
  };
}

test("direct SQLite fallback persists a valid usage receipt once", (t) => {
  const databasePath = withFixture(t);
  const receipt = { source: "claude-otel", model: "claude-test", mode: "cumulative", inputTokens: 12, outputTokens: 8, totalTokens: 20 };
  writeDirect(event({ usage: receipt }));
  writeDirect(event({ usage: { ...receipt, inputTokens: 999, totalTokens: 999 } }));

  const database = new DatabaseSync(databasePath);
  const rows = database.prepare("SELECT input_tokens, output_tokens, total_tokens FROM agent_usage").all();
  const events = database.prepare("SELECT COUNT(*) AS count FROM events").get();
  database.close();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].input_tokens, 12);
  assert.equal(rows[0].output_tokens, 8);
  assert.equal(rows[0].total_tokens, 20);
  assert.equal(events.count, 1, "duplicate lifecycle events must not mutate usage");
});

test("direct SQLite fallback rejects malformed usage and leaves legacy no-usage events unreported", (t) => {
  const databasePath = withFixture(t);
  assert.throws(() => writeDirect(event({ eventId: "bad-usage", usage: { source: "claude-otel", inputTokens: -1 } })), /inputTokens must be a non-negative integer/);
  writeDirect(event({ eventId: "legacy-usage", usage: undefined }));

  const database = new DatabaseSync(databasePath);
  const usage = database.prepare("SELECT COUNT(*) AS count FROM agent_usage").get();
  const events = database.prepare("SELECT source_event_id FROM events").all();
  database.close();
  assert.equal(usage.count, 0);
  assert.equal(events.length, 1);
  assert.equal(events[0].source_event_id, "legacy-usage");
});
