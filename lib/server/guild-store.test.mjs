import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const workspace = path.resolve(import.meta.dirname, "../..");
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { url: "data:text/javascript,export%20{}", shortCircuit: true };
    }
    if (specifier.startsWith("@/")) {
      const target = path.join(workspace, specifier.slice(2));
      const resolved = existsSync(target) ? target : `${target}.ts`;
      return { url: pathToFileURL(resolved).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

process.env.LANTERNWATCH_STALE_AFTER_SECONDS = "60";
const { getCatalogDependencies, getDashboard, recordGuildEvent } = await import("./guild-store.ts");
const { applyCatalogAction } = await import("./agent-catalog.ts");
const { writeDirect } = await import("../../scripts/guild-report.mjs");

function closeStore() {
  if (globalThis.lanternwatchDatabase) {
    globalThis.lanternwatchDatabase.database.close();
    delete globalThis.lanternwatchDatabase;
  }
}

function event(overrides) {
  return {
    eventId: crypto.randomUUID(),
    projectPath: "C:/fixtures/alpha",
    projectName: "Alpha",
    runId: "run",
    agent: "archivist",
    status: "working",
    message: "Working",
    quest: "Fixture quest",
    occurredAt: new Date().toISOString(),
    ...overrides,
  };
}

test("dashboard distinguishes an empty scope from completed runs without observed active windows", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "lanternwatch-dashboard-zero-"));
  const previousDatabase = process.env.LANTERNWATCH_DB_PATH;
  process.env.LANTERNWATCH_DB_PATH = path.join(directory, "dashboard.db");
  closeStore();
  t.after(async () => {
    closeStore();
    if (previousDatabase === undefined) delete process.env.LANTERNWATCH_DB_PATH;
    else process.env.LANTERNWATCH_DB_PATH = previousDatabase;
    await rm(directory, { recursive: true, force: true });
  });

  const empty = getDashboard();
  assert.deepEqual(
    { total: empty.statistics.totalRuns, completed: empty.statistics.completedRuns, active: empty.statistics.activeRuns, stalled: empty.statistics.stalledRuns },
    { total: 0, completed: 0, active: 0, stalled: 0 },
  );
  assert.deepEqual(empty.agentActivities, []);
  assert.deepEqual(empty.agentMetrics, {});

  const completed = recordGuildEvent(event({
    eventId: "no-observed-window",
    runId: "no-observed-window-run",
    status: "complete",
    runComplete: true,
    agentInstanceId: "terminal-only-instance",
  }));
  const scoped = getDashboard(completed.projectId);
  const metric = scoped.agentMetrics["systems-analyst"];
  assert.equal(scoped.statistics.totalRuns, 1);
  assert.equal(scoped.statistics.completedRuns, 1);
  assert.equal(scoped.agentActivities.length, 0, "a terminal-only report must not appear in the live occupancy snapshot");
  assert.deepEqual(
    { runCount: metric?.runCount, trackedActiveSeconds: metric?.trackedActiveSeconds, activeInstances: metric?.activeInstances },
    { runCount: 1, trackedActiveSeconds: 0, activeInstances: 0 },
  );
});

test("workspace agent types keep canonical metrics while matching their exact catalog definition", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "lanternwatch-workspace-agent-type-"));
  const previousDatabase = process.env.LANTERNWATCH_DB_PATH;
  process.env.LANTERNWATCH_DB_PATH = path.join(directory, "dashboard.db");
  closeStore();
  t.after(async () => {
    closeStore();
    if (previousDatabase === undefined) delete process.env.LANTERNWATCH_DB_PATH;
    else process.env.LANTERNWATCH_DB_PATH = previousDatabase;
    await rm(directory, { recursive: true, force: true });
  });

  applyCatalogAction(getCatalogDependencies(), { action: "scan" });

  const recorded = recordGuildEvent(event({
    eventId: "workspace-agent-type",
    projectPath: workspace,
    projectName: "LanternWatch",
    runId: "workspace-agent-type-run",
    agent: "frontend-engineer",
    agentType: "frontend-engineer-lanternwatch",
    agentInstanceId: "workspace-agent-instance",
  }));
  const dashboard = getDashboard(recorded.projectId, recorded.runId);
  const expectedSourcePath = path.join(workspace, ".codex", "agents", "frontend-engineer-lanternwatch.toml");

  assert.equal(dashboard.events[0]?.agent, "frontend-engineer");
  assert.equal(dashboard.events[0]?.agentType, "frontend-engineer-lanternwatch");
  assert.equal(dashboard.events[0]?.presentation?.sourcePath, expectedSourcePath);
  assert.equal(dashboard.agentActivities[0]?.agent, "frontend-engineer");
  assert.equal(dashboard.agentActivities[0]?.agentType, "frontend-engineer-lanternwatch");
  assert.equal(dashboard.agentActivities[0]?.presentation?.sourcePath, expectedSourcePath);
  assert.equal(dashboard.agentMetrics["frontend-engineer"]?.runCount, 1);
});

test("terminal ingestion remains successful when optional Markdown export is unavailable", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "lanternwatch-export-failure-"));
  const blockedVault = path.join(directory, "occupied-vault");
  await writeFile(blockedVault, "occupied");
  const previous = {
    database: process.env.LANTERNWATCH_DB_PATH,
    storage: process.env.LANTERNWATCH_STORAGE_ROOT,
    vault: process.env.LANTERNWATCH_VAULT_PATH,
  };
  process.env.LANTERNWATCH_DB_PATH = path.join(directory, "events.db");
  delete process.env.LANTERNWATCH_STORAGE_ROOT;
  process.env.LANTERNWATCH_VAULT_PATH = blockedVault;
  t.after(async () => {
    closeStore();
    if (previous.database === undefined) delete process.env.LANTERNWATCH_DB_PATH; else process.env.LANTERNWATCH_DB_PATH = previous.database;
    if (previous.storage === undefined) delete process.env.LANTERNWATCH_STORAGE_ROOT; else process.env.LANTERNWATCH_STORAGE_ROOT = previous.storage;
    if (previous.vault === undefined) delete process.env.LANTERNWATCH_VAULT_PATH; else process.env.LANTERNWATCH_VAULT_PATH = previous.vault;
    await rm(directory, { recursive: true, force: true });
  });

  const result = recordGuildEvent(event({
    eventId: "server-export-failure",
    runId: "server-export-failure-run",
    status: "complete",
    runComplete: true,
  }));
  assert.equal(result.inserted, true);
  const database = new DatabaseSync(process.env.LANTERNWATCH_DB_PATH, { readOnly: true });
  const stored = database.prepare("SELECT source_event_id, agent FROM events WHERE source_event_id = ?").get("server-export-failure");
  database.close();
  assert.equal(stored.source_event_id, "server-export-failure");
  assert.equal(stored.agent, "systems-analyst", "legacy API input is persisted under the canonical role ID");
  assert.equal(existsSync(path.join(directory, "logs", "server.jsonl")), true);
});

test("global and filtered dashboards keep project/run/instance identities isolated", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "lanternwatch-store-"));
  process.env.LANTERNWATCH_DB_PATH = path.join(directory, "clean.db");
  const fixtureNow = Date.now();
  const alphaStartedAt = new Date(fixtureNow - 90_000).toISOString();
  const alphaUpdatedAt = new Date(fixtureNow - 30_000).toISOString();
  t.after(async () => {
    closeStore();
    await rm(directory, { recursive: true, force: true });
  });

  const alphaOne = recordGuildEvent(event({
    eventId: "alpha-one",
    runId: "shared-run",
    agentInstanceId: "instance-one",
    message: "Alpha first instance",
    occurredAt: alphaStartedAt,
  }));
  const duplicate = recordGuildEvent(event({
    eventId: "alpha-one",
    runId: "shared-run",
    agentInstanceId: "instance-one",
    message: "Duplicate must not overwrite",
  }));
  assert.equal(duplicate.inserted, false);

  recordGuildEvent(event({
    eventId: "alpha-one-update",
    runId: "shared-run",
    agentInstanceId: "instance-one",
    message: "Alpha first updated",
    occurredAt: alphaUpdatedAt,
  }));

  recordGuildEvent(event({
    eventId: "alpha-two",
    runId: "shared-run",
    agentInstanceId: "instance-two",
    message: "Alpha second instance",
    occurredAt: new Date(fixtureNow - 45_000).toISOString(),
  }));
  recordGuildEvent(event({
    eventId: "alpha-legacy",
    runId: "shared-run",
    agent: "ledgerkeeper",
    agentInstanceId: undefined,
    message: "Legacy instance",
    occurredAt: new Date(fixtureNow - 25_000).toISOString(),
  }));
  const betaOne = recordGuildEvent(event({
    eventId: "beta-one",
    projectPath: "C:/fixtures/beta",
    projectName: "Beta",
    runId: "shared-run",
    agentInstanceId: "instance-one",
    message: "Beta concurrent instance",
    occurredAt: new Date(fixtureNow - 20_000).toISOString(),
  }));
  assert.notEqual(alphaOne.runId, betaOne.runId, "the same source run ID must be scoped by project");

  recordGuildEvent(event({
    eventId: "alpha-finished-start",
    runId: "shared-run",
    agentInstanceId: "finished-instance",
    message: "Temporary active instance",
    occurredAt: new Date(fixtureNow - 15_000).toISOString(),
  }));
  recordGuildEvent(event({
    eventId: "alpha-finished-stop",
    runId: "shared-run",
    agentInstanceId: "finished-instance",
    status: "complete",
    message: "Temporary instance completed",
    occurredAt: new Date(fixtureNow - 10_000).toISOString(),
  }));

  recordGuildEvent(event({
    eventId: "alpha-complete",
    runId: "terminal-run",
    status: "complete",
    runComplete: true,
    agentInstanceId: "finished-agent",
  }));
  recordGuildEvent(event({
    eventId: "beta-interrupted",
    projectPath: "C:/fixtures/beta",
    projectName: "Beta",
    runId: "interrupted-run",
    status: "interrupted",
    agentInstanceId: "stopped-agent",
  }));
  const stale = recordGuildEvent(event({
    eventId: "alpha-stale",
    runId: "stale-run",
    agentInstanceId: "stale-agent",
  }));
  const database = new DatabaseSync(process.env.LANTERNWATCH_DB_PATH);
  database.prepare("UPDATE runs SET updated_at = ? WHERE id = ?").run(new Date(Date.now() - 120_000).toISOString(), stale.runId);
  database.close();

  const global = getDashboard();
  assert.equal(global.selectedProjectId, null);
  assert.deepEqual(
    { total: global.statistics.totalRuns, completed: global.statistics.completedRuns, interrupted: global.statistics.interruptedRuns, active: global.statistics.activeRuns, stalled: global.statistics.stalledRuns },
    { total: 5, completed: 1, interrupted: 1, active: 2, stalled: 1 },
  );
  assert.equal(global.recentEvents.length, 10, "duplicates must remain harmless");
  assert.equal(global.agentActivities.length, 4, "terminal and stale runs must not appear as active");
  assert.equal(global.agentActivities.filter((activity) => activity.agent === "systems-analyst").length, 3);
  assert.equal(global.agentActivities.filter((activity) => activity.projectName === "Alpha").length, 3);
  assert.equal(new Set(global.agentActivities.map((activity) => activity.id)).size, 4, "every activity has a unique project/run/instance identity");
  const alphaFirstActivity = global.agentActivities.find((activity) => activity.projectName === "Alpha" && activity.agentInstanceId === "instance-one");
  const alphaSecondActivity = global.agentActivities.find((activity) => activity.projectName === "Alpha" && activity.agentInstanceId === "instance-two");
  const betaActivity = global.agentActivities.find((activity) => activity.projectName === "Beta" && activity.agentInstanceId === "instance-one");
  const legacyActivity = global.agentActivities.find((activity) => activity.agent === "data-engineer");
  assert.deepEqual(
    {
      projectId: alphaFirstActivity?.projectId,
      projectName: alphaFirstActivity?.projectName,
      runId: alphaFirstActivity?.runId,
      status: alphaFirstActivity?.status,
      message: alphaFirstActivity?.message,
      startedAt: alphaFirstActivity?.startedAt,
      updatedAt: alphaFirstActivity?.updatedAt,
    },
    {
      projectId: global.projects.find((project) => project.name === "Alpha")?.id,
      projectName: "Alpha",
      runId: alphaOne.runId,
      status: "working",
      message: "Alpha first updated",
      startedAt: alphaStartedAt,
      updatedAt: alphaUpdatedAt,
    },
  );
  assert.ok(alphaFirstActivity && alphaFirstActivity.durationSeconds >= 89 && alphaFirstActivity.durationSeconds <= 120);
  assert.equal(alphaSecondActivity?.runId, alphaOne.runId, "two same-role instances remain separate inside one run");
  assert.equal(betaActivity?.runId, betaOne.runId, "the same raw instance ID remains scoped to its project and run");
  assert.equal(legacyActivity?.agentInstanceId, `legacy:${alphaOne.runId}:data-engineer`, "legacy events fall back to run plus canonical agent");
  assert.ok(!global.agentActivities.some((activity) => activity.agentInstanceId === "finished-instance"), "terminal instances leave the active list");
  assert.ok(!global.agentActivities.some((activity) => activity.agentInstanceId === "stale-agent"), "stalled runs leave the active list");
  assert.ok(global.runs.some((run) => run.status === "stalled"));
  assert.equal(global.agentRunCounts["systems-analyst"], 5);
  assert.equal(global.agentRunCounts["data-engineer"], 1);
  assert.equal(global.agentMetrics["systems-analyst"]?.runCount, 5);
  assert.equal(global.agentMetrics["systems-analyst"]?.activeInstances, 3);
  assert.ok((global.agentMetrics["systems-analyst"]?.trackedActiveSeconds ?? 0) >= 150, "agent time is derived from reported lifecycle windows");
  assert.equal(global.agentMetrics["data-engineer"]?.runCount, 1);
  assert.ok(global.agentWorkspacePaths.includes(process.cwd()), "the current workspace is always an available creation destination");

  const alphaProject = global.projects.find((project) => project.name === "Alpha");
  const betaProject = global.projects.find((project) => project.name === "Beta");
  assert.ok(alphaProject && betaProject);
  const alpha = getDashboard(alphaProject.id);
  assert.equal(alpha.selectedProjectId, alphaProject.id);
  assert.deepEqual(
    { total: alpha.statistics.totalRuns, completed: alpha.statistics.completedRuns, active: alpha.statistics.activeRuns, stalled: alpha.statistics.stalledRuns },
    { total: 3, completed: 1, active: 1, stalled: 1 },
  );
  assert.ok(alpha.runs.every((run) => run.projectId === alphaProject.id));
  assert.ok(alpha.recentEvents.every((storedEvent) => storedEvent.projectId === alphaProject.id));
  assert.ok(alpha.agentActivities.every((activity) => activity.projectId === alphaProject.id));
  assert.equal(alpha.recentEvents.length, 8);
  assert.equal(alpha.agentRunCounts["systems-analyst"], 3);
  assert.equal(alpha.agentRunCounts["data-engineer"], 1);
  assert.equal(alpha.agentMetrics["systems-analyst"]?.runCount, 3);
  assert.equal(alpha.agentMetrics["systems-analyst"]?.activeInstances, 2);

  const invalid = getDashboard("not-a-project");
  assert.equal(invalid.selectedProjectId, null);
  assert.equal(invalid.statistics.totalRuns, global.statistics.totalRuns);

  const selectedGlobal = getDashboard(null, alphaOne.runId);
  assert.equal(selectedGlobal.run?.projectId, alphaProject.id, "unfiltered run lookup accepts the scoped dashboard ID");
  const membershipEnforced = getDashboard(betaProject.id, alphaOne.runId);
  assert.equal(membershipEnforced.run?.projectId, betaProject.id, "a filtered lookup cannot escape its project");
  assert.notEqual(membershipEnforced.run?.id, alphaOne.runId);
});

test("an existing database migrates additively and accepts colliding source IDs", async (t) => {
  closeStore();
  const directory = await mkdtemp(path.join(tmpdir(), "lanternwatch-upgrade-"));
  const target = path.join(directory, "existing.db");
  process.env.LANTERNWATCH_DB_PATH = target;
  t.after(async () => {
    closeStore();
    await rm(directory, { recursive: true, force: true });
  });

  const database = new DatabaseSync(target);
  const legacyPath = path.resolve("C:/fixtures/legacy");
  const legacyProjectId = createHash("sha256").update(legacyPath.toLocaleLowerCase()).digest("hex").slice(0, 20);
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE, last_seen_at TEXT NOT NULL);
    CREATE TABLE runs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), quest TEXT NOT NULL DEFAULT '', status TEXT NOT NULL CHECK(status IN ('working', 'complete')), started_at TEXT NOT NULL, completed_at TEXT, updated_at TEXT NOT NULL);
    CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE, project_id TEXT NOT NULL REFERENCES projects(id), run_id TEXT NOT NULL REFERENCES runs(id), agent TEXT NOT NULL, status TEXT NOT NULL, message TEXT NOT NULL, quest TEXT, from_agent TEXT, occurred_at TEXT NOT NULL, received_at TEXT NOT NULL);
  `);
  database.prepare("INSERT INTO projects VALUES (?, 'Legacy', ?, '2026-01-01T00:00:00.000Z')").run(legacyProjectId, legacyPath);
  database.prepare("INSERT INTO runs VALUES ('legacy-run', ?, 'Old quest', 'working', '2026-01-01T00:00:00.000Z', NULL, '2026-01-01T00:00:00.000Z')").run(legacyProjectId);
  database.prepare("INSERT INTO events (event_id, project_id, run_id, agent, status, message, occurred_at, received_at) VALUES ('legacy-event', ?, 'legacy-run', 'archivist', 'working', 'Old event', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')").run(legacyProjectId);
  database.close();

  const migrated = getDashboard();
  const legacyRun = migrated.runs.find((run) => run.id === "legacy-run");
  assert.equal(legacyRun?.sourceRunId, "legacy-run");
  assert.equal(migrated.recentEvents[0]?.eventId, "legacy-event");
  assert.equal(migrated.recentEvents[0]?.agentType, "systems-analyst", "legacy rows without a raw agent type fall back to their canonical agent");

  const sameProject = recordGuildEvent(event({
    eventId: "legacy-followup",
    projectPath: "C:/fixtures/legacy",
    projectName: "Legacy",
    runId: "legacy-run",
    message: "Continue old run",
  }));
  assert.equal(sameProject.runId, "legacy-run", "existing storage IDs remain stable");
  const otherProject = recordGuildEvent(event({
    eventId: "legacy-event",
    projectPath: "C:/fixtures/new-project",
    projectName: "New project",
    runId: "legacy-run",
    message: "Same source IDs, different project",
  }));
  assert.notEqual(otherProject.runId, "legacy-run");
  const combined = getDashboard();
  assert.equal(combined.statistics.totalRuns, 2);
  assert.equal(combined.recentEvents.length, 3, "event deduplication is scoped to its project after migration");
});

test("a version 4 database canonicalizes legacy role rows without changing correlation IDs or double-counting mixed aliases", async (t) => {
  closeStore();
  const directory = await mkdtemp(path.join(tmpdir(), "lanternwatch-role-upgrade-"));
  const target = path.join(directory, "version-4.db");
  process.env.LANTERNWATCH_DB_PATH = target;
  t.after(async () => {
    closeStore();
    await rm(directory, { recursive: true, force: true });
  });

  const database = new DatabaseSync(target);
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE, last_seen_at TEXT NOT NULL);
    CREATE TABLE runs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), quest TEXT NOT NULL DEFAULT '', status TEXT NOT NULL CHECK(status IN ('working', 'complete')), started_at TEXT NOT NULL, completed_at TEXT, updated_at TEXT NOT NULL, outcome TEXT, source_run_id TEXT);
    CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE, project_id TEXT NOT NULL REFERENCES projects(id), run_id TEXT NOT NULL REFERENCES runs(id), agent TEXT NOT NULL, status TEXT NOT NULL, message TEXT NOT NULL, quest TEXT, from_agent TEXT, occurred_at TEXT NOT NULL, received_at TEXT NOT NULL, agent_instance_id TEXT, source_event_id TEXT);
    INSERT INTO projects VALUES ('project-v4', 'Version 4', 'C:/fixtures/version-4', '2026-08-01T00:00:00.000Z');
    INSERT INTO runs VALUES ('stored-run-v4', 'project-v4', 'Legacy mixed run', 'working', '2026-08-01T00:00:00.000Z', NULL, '2026-08-01T00:02:00.000Z', NULL, 'source-run-v4');
    INSERT INTO events (event_id, source_event_id, project_id, run_id, agent, status, message, from_agent, occurred_at, received_at, agent_instance_id) VALUES
      ('stored-event-v4-a', 'source-event-v4-a', 'project-v4', 'stored-run-v4', 'archivist', 'working', 'Legacy alias', 'guildmaster', '2026-08-01T00:01:00.000Z', '2026-08-01T00:01:00.000Z', 'instance-v4'),
      ('stored-event-v4-b', 'source-event-v4-b', 'project-v4', 'stored-run-v4', 'systems-analyst', 'working', 'Canonical role', 'program-manager', '2026-08-01T00:02:00.000Z', '2026-08-01T00:02:00.000Z', 'instance-v4');
  `);
  database.close();

  const dashboard = getDashboard();
  assert.equal(dashboard.agentRunCounts["systems-analyst"], 1, "legacy and canonical rows in one run count once");
  assert.equal(dashboard.events.length, 2);
  assert.ok(dashboard.events.every((storedEvent) => storedEvent.agent === "systems-analyst"));
  assert.ok(dashboard.events.every((storedEvent) => storedEvent.from === "program-manager"));
  assert.deepEqual(dashboard.events.map((storedEvent) => storedEvent.eventId), ["source-event-v4-a", "source-event-v4-b"]);
  assert.ok(dashboard.events.every((storedEvent) => storedEvent.runId === "stored-run-v4"));
  assert.ok(dashboard.events.every((storedEvent) => storedEvent.agentInstanceId === "instance-v4"));
  assert.equal(dashboard.run?.sourceRunId, "source-run-v4");

  const migrated = new DatabaseSync(target, { readOnly: true });
  const storedRows = migrated.prepare("SELECT event_id, source_event_id, run_id, agent, from_agent, agent_instance_id FROM events ORDER BY id").all();
  migrated.close();
  assert.deepEqual(storedRows.map((row) => ({ ...row })), [
    { event_id: "stored-event-v4-a", source_event_id: "source-event-v4-a", run_id: "stored-run-v4", agent: "systems-analyst", from_agent: "program-manager", agent_instance_id: "instance-v4" },
    { event_id: "stored-event-v4-b", source_event_id: "source-event-v4-b", run_id: "stored-run-v4", agent: "systems-analyst", from_agent: "program-manager", agent_instance_id: "instance-v4" },
  ]);

  closeStore();
  const reopened = getDashboard();
  assert.equal(reopened.agentRunCounts["systems-analyst"], 1, "reopening the upgraded database keeps mixed aliases deduplicated");
  assert.deepEqual(reopened.events.map((storedEvent) => ({
    eventId: storedEvent.eventId,
    runId: storedEvent.runId,
    agent: storedEvent.agent,
    from: storedEvent.from,
    agentInstanceId: storedEvent.agentInstanceId,
  })), [
    { eventId: "source-event-v4-a", runId: "stored-run-v4", agent: "systems-analyst", from: "program-manager", agentInstanceId: "instance-v4" },
    { eventId: "source-event-v4-b", runId: "stored-run-v4", agent: "systems-analyst", from: "program-manager", agentInstanceId: "instance-v4" },
  ]);
});

test("the direct SQLite fallback scopes reused run and event IDs by project", async (t) => {
  closeStore();
  const directory = await mkdtemp(path.join(tmpdir(), "lanternwatch-direct-"));
  const target = path.join(directory, "direct.db");
  process.env.LANTERNWATCH_DB_PATH = target;
  t.after(async () => {
    closeStore();
    await rm(directory, { recursive: true, force: true });
  });
  const base = {
    eventId: "same-event",
    runId: "same-run",
    agent: "archivist",
    agentType: "frontend-engineer-lanternwatch",
    status: "working",
    message: "Direct fallback",
    quest: "Direct fixture",
    occurredAt: new Date().toISOString(),
    runComplete: false,
  };
  writeDirect({ ...base, projectPath: path.resolve("C:/fixtures/direct-a"), projectName: "Direct A", agentInstanceId: "agent-a" });
  writeDirect({ ...base, projectPath: path.resolve("C:/fixtures/direct-b"), projectName: "Direct B", agentInstanceId: "agent-b" });

  const database = new DatabaseSync(target);
  const rows = database.prepare("SELECT id, project_id, source_run_id FROM runs ORDER BY project_id").all();
  const events = database.prepare("SELECT source_event_id, agent, agent_type, agent_instance_id FROM events ORDER BY project_id").all();
  database.close();
  assert.equal(rows.length, 2);
  assert.equal(new Set(rows.map((row) => row.id)).size, 2);
  assert.ok(rows.every((row) => row.source_run_id === "same-run"));
  assert.deepEqual(events.map((row) => row.source_event_id), ["same-event", "same-event"]);
  assert.ok(events.every((row) => row.agent === "systems-analyst"));
  assert.ok(events.every((row) => row.agent_type === "frontend-engineer-lanternwatch"));
  assert.deepEqual(new Set(events.map((row) => row.agent_instance_id)), new Set(["agent-a", "agent-b"]));
});
