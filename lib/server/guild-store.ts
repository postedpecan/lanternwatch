import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { AGENT_IDS, type AgentId, type RoomStatus } from "@/lib/guild-data";
import { ageSeconds, parseLatestHookLog, type HookLogStatus, type HookSource } from "@/lib/guild-health";
import type {
  DashboardPayload,
  GuildAgentActivity,
  GuildStorageHealth,
  GuildStatistics,
  GuildProject,
  GuildRun,
  IncomingGuildEvent,
  StoredGuildEvent,
} from "@/lib/guild-contract";

const DEFAULT_STORAGE_ROOT = path.join(homedir(), ".lanternwatch");
const roomStatuses = new Set<RoomStatus>(["waiting", "queued", "working", "complete", "interrupted", "stalled"]);
const STALE_AFTER_SECONDS = Number(process.env.LANTERNWATCH_STALE_AFTER_SECONDS || 600);
const SCHEMA_VERSION = 4;

type DatabaseState = {
  database: DatabaseSync;
  path: string;
  schemaVersion?: number;
};

const globalStore = globalThis as typeof globalThis & {
  lanternwatchDatabase?: DatabaseState;
};

type RuntimeConfiguration = {
  storageRoot?: unknown;
  databasePath?: unknown;
  vaultPath?: unknown;
};

function configuredPath(value: unknown) {
  return typeof value === "string" && value.trim() ? path.resolve(value.trim()) : undefined;
}

function runtimeConfiguration(): RuntimeConfiguration {
  const configPath = configuredPath(process.env.LANTERNWATCH_CONFIG_PATH)
    || path.join(DEFAULT_STORAGE_ROOT, "config.json");
  try {
    const value = JSON.parse(readFileSync(configPath, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as RuntimeConfiguration
      : {};
  } catch {
    return {};
  }
}

function runtimePaths() {
  const configuration = runtimeConfiguration();
  const environmentStorageRoot = configuredPath(process.env.LANTERNWATCH_STORAGE_ROOT);
  const explicitDatabasePath = configuredPath(process.env.LANTERNWATCH_DB_PATH)
    || (environmentStorageRoot ? undefined : configuredPath(configuration.databasePath));
  const storageRoot = environmentStorageRoot
    || configuredPath(configuration.storageRoot)
    || (explicitDatabasePath ? path.dirname(explicitDatabasePath) : DEFAULT_STORAGE_ROOT);
  return {
    databasePath: explicitDatabasePath || path.join(storageRoot, "guild.db"),
    storageRoot,
    vaultPath: configuredPath(process.env.LANTERNWATCH_VAULT_PATH)
      || configuredPath(configuration.vaultPath)
      || "",
  };
}

function databasePath() {
  return runtimePaths().databasePath;
}

function vaultPath() {
  return runtimePaths().vaultPath;
}

function storageRootPath() {
  return runtimePaths().storageRoot;
}

function readHookDiagnostics(target: string): {
  status: HookLogStatus;
  receiptAt: string | null;
  event: string | null;
  stage: string | null;
  source: HookSource | null;
} {
  try {
    return parseLatestHookLog(readFileSync(target, "utf8"));
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : null;
    return {
      status: code === "ENOENT" ? "missing" : "unreadable",
      receiptAt: null,
      event: null,
      stage: null,
      source: null,
    };
  }
}

function ensureSchema(database: DatabaseSync) {
  database.exec(`
    PRAGMA busy_timeout = 3000;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      last_seen_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      quest TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK(status IN ('working', 'complete')),
      started_at TEXT NOT NULL,
      completed_at TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      project_id TEXT NOT NULL REFERENCES projects(id),
      run_id TEXT NOT NULL REFERENCES runs(id),
      agent TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT NOT NULL,
      quest TEXT,
      from_agent TEXT,
      occurred_at TEXT NOT NULL,
      received_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS events_run_id ON events(run_id, id);
    CREATE INDEX IF NOT EXISTS events_project_agent_run ON events(project_id, agent, run_id);
    CREATE INDEX IF NOT EXISTS runs_project_updated ON runs(project_id, updated_at DESC);
  `);
  const runColumns = database.prepare("PRAGMA table_info(runs)").all() as Array<{ name: string }>;
  if (!runColumns.some((column) => column.name === "outcome")) database.exec("ALTER TABLE runs ADD COLUMN outcome TEXT");
  if (!runColumns.some((column) => column.name === "source_run_id")) database.exec("ALTER TABLE runs ADD COLUMN source_run_id TEXT");
  const eventColumns = database.prepare("PRAGMA table_info(events)").all() as Array<{ name: string }>;
  if (!eventColumns.some((column) => column.name === "agent_instance_id")) database.exec("ALTER TABLE events ADD COLUMN agent_instance_id TEXT");
  if (!eventColumns.some((column) => column.name === "source_event_id")) database.exec("ALTER TABLE events ADD COLUMN source_event_id TEXT");
  database.exec(`
    UPDATE runs SET source_run_id = id WHERE source_run_id IS NULL OR source_run_id = '';
    UPDATE events SET source_event_id = event_id WHERE source_event_id IS NULL OR source_event_id = '';
    CREATE UNIQUE INDEX IF NOT EXISTS runs_project_source_id ON runs(project_id, source_run_id);
    CREATE UNIQUE INDEX IF NOT EXISTS events_project_source_id ON events(project_id, source_event_id);
    UPDATE runs
      SET completed_at = (
        SELECT MIN(occurred_at) FROM events
        WHERE events.run_id = runs.id AND events.status IN ('complete', 'interrupted')
      )
      WHERE status = 'complete'
        AND EXISTS (
          SELECT 1 FROM events
          WHERE events.run_id = runs.id AND events.status IN ('complete', 'interrupted')
        );
  `);
}

function getDatabase() {
  const target = databasePath();
  if (globalStore.lanternwatchDatabase?.path === target) {
    const current = globalStore.lanternwatchDatabase;
    if (current.schemaVersion !== SCHEMA_VERSION) {
      ensureSchema(current.database);
      current.schemaVersion = SCHEMA_VERSION;
    }
    return current.database;
  }

  mkdirSync(path.dirname(target), { recursive: true });
  const database = new DatabaseSync(target);
  database.exec("PRAGMA journal_mode = WAL");
  ensureSchema(database);
  globalStore.lanternwatchDatabase = { database, path: target, schemaVersion: SCHEMA_VERSION };
  return database;
}

function cleanText(value: unknown, fallback: string, maxLength = 500) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maxLength)
    : fallback;
}

function normalizeDate(value: unknown) {
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

function projectIdFor(projectPath: string) {
  return createHash("sha256").update(projectPath.toLocaleLowerCase()).digest("hex").slice(0, 20);
}

function scopedStorageId(kind: "run" | "event", projectId: string, sourceId: string) {
  const digest = createHash("sha256").update(`${projectId}\0${sourceId}`).digest("hex").slice(0, 32);
  return `${kind}:${projectId}:${digest}`;
}

function resolveRunStorageId(database: DatabaseSync, projectId: string, sourceRunId: string) {
  const row = database.prepare("SELECT id FROM runs WHERE project_id = ? AND source_run_id = ?")
    .get(projectId, sourceRunId) as { id: string } | undefined;
  return row?.id ?? scopedStorageId("run", projectId, sourceRunId);
}

function safeAgent(value: unknown): AgentId {
  return typeof value === "string" && AGENT_IDS.includes(value as AgentId)
    ? (value as AgentId)
    : "guildmaster";
}

function safeStatus(value: unknown): RoomStatus {
  return typeof value === "string" && roomStatuses.has(value as RoomStatus)
    ? (value as RoomStatus)
    : "working";
}

function rowToProject(row: Record<string, unknown>): GuildProject {
  return {
    id: String(row.id),
    name: String(row.name),
    path: String(row.path),
    lastSeenAt: String(row.last_seen_at),
  };
}

function rowToRun(row: Record<string, unknown>): GuildRun {
  const startedAt = String(row.started_at);
  const stale = row.status === "working" && Date.now() - Date.parse(String(row.updated_at)) > STALE_AFTER_SECONDS * 1000;
  const status = row.outcome === "interrupted" ? "interrupted" : stale ? "stalled" : row.status === "complete" ? "complete" : "working";
  const end = row.completed_at ? String(row.completed_at) : stale ? String(row.updated_at) : new Date().toISOString();
  return {
    id: String(row.id),
    sourceRunId: String(row.source_run_id || row.id),
    projectId: String(row.project_id),
    quest: String(row.quest || ""),
    status,
    startedAt,
    completedAt: row.completed_at ? String(row.completed_at) : null,
    updatedAt: String(row.updated_at),
    durationSeconds: Math.max(0, Math.floor((Date.parse(end) - Date.parse(startedAt)) / 1000)),
  };
}

function rowToEvent(row: Record<string, unknown>, startedAt: string): StoredGuildEvent {
  const occurredAt = String(row.occurred_at);
  return {
    id: Number(row.id),
    eventId: String(row.source_event_id || row.event_id),
    projectId: String(row.project_id),
    runId: String(row.run_id),
    agent: safeAgent(row.agent),
    status: safeStatus(row.status),
    message: String(row.message),
    quest: row.quest ? String(row.quest) : null,
    from: row.from_agent ? safeAgent(row.from_agent) : null,
    occurredAt,
    elapsedSeconds: Math.max(0, Math.floor((Date.parse(occurredAt) - Date.parse(startedAt)) / 1000)),
    agentInstanceId: row.agent_instance_id ? String(row.agent_instance_id) : null,
  };
}

function noteFileName(run: GuildRun) {
  const scopedName = `${run.projectId}-${run.sourceRunId}`;
  return `${run.startedAt.slice(0, 10)}-${scopedName.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 64)}.md`;
}

function exportRun(database: DatabaseSync, runId: string) {
  const targetVault = vaultPath();
  if (!targetVault) return;

  const runRow = database.prepare("SELECT * FROM runs WHERE id = ?").get(runId) as Record<string, unknown> | undefined;
  if (!runRow) return;
  const run = rowToRun(runRow);
  const projectRow = database.prepare("SELECT * FROM projects WHERE id = ?").get(run.projectId) as Record<string, unknown>;
  const project = rowToProject(projectRow);
  const eventRows = database.prepare("SELECT * FROM events WHERE run_id = ? ORDER BY occurred_at, id").all(runId) as Record<string, unknown>[];
  const events = eventRows.map((row) => rowToEvent(row, run.startedAt));
  const directory = path.join(targetVault, "Guild Activity");
  mkdirSync(directory, { recursive: true });
  const yamlText = (value: string) => JSON.stringify(value);
  const lines = [
    "---",
    `project: ${yamlText(project.name)}`,
    `project_path: ${yamlText(project.path)}`,
    `run_id: ${yamlText(run.sourceRunId)}`,
    `status: ${run.status}`,
    `started: ${run.startedAt}`,
    `completed: ${run.completedAt || ""}`,
    `duration_seconds: ${run.durationSeconds}`,
    "tags:",
    "  - lanternwatch",
    "  - agent-run",
    "---",
    "",
    `# ${run.quest || "Codex agent run"}`,
    "",
    `**Project:** ${project.name}`,
    "",
    "## Activity",
    "",
    ...events.map((event) => `- ${event.occurredAt} — **${event.agent}** · ${event.status}: ${event.message}`),
    "",
  ];
  writeFileSync(path.join(directory, noteFileName(run)), lines.join("\n"), "utf8");
}

export function recordGuildEvent(input: IncomingGuildEvent) {
  const database = getDatabase();
  const occurredAt = normalizeDate(input.occurredAt);
  const projectPath = path.resolve(cleanText(input.projectPath, process.cwd(), 1000));
  const projectName = cleanText(input.projectName, path.basename(projectPath), 120);
  const projectId = projectIdFor(projectPath);
  const eventId = cleanText(input.eventId, randomUUID(), 160);
  const agent = safeAgent(input.agent);
  const status = safeStatus(input.status);
  const message = cleanText(input.message, `${agent} changed state to ${status}.`, 1000);
  const quest = cleanText(input.quest, "", 1000);
  const from = input.from ? safeAgent(input.from) : null;
  const sourceRunId = cleanText(input.runId, `${projectId}-${occurredAt.slice(0, 19)}`, 180);
  const runId = resolveRunStorageId(database, projectId, sourceRunId);
  const storedEventId = scopedStorageId("event", projectId, eventId);
  const receivedAt = new Date().toISOString();
  const runComplete = input.runComplete === true || status === "interrupted";
  const outcome = status === "interrupted" ? "interrupted" : runComplete ? "complete" : null;

  if (input.heartbeat === true) {
    database.prepare("UPDATE runs SET updated_at = ? WHERE id = ? AND project_id = ? AND status = 'working'").run(receivedAt, runId, projectId);
    return { eventId, projectId, runId, inserted: false };
  }

  const duplicate = database.prepare("SELECT project_id, run_id FROM events WHERE project_id = ? AND source_event_id = ?")
    .get(projectId, eventId) as { project_id: string; run_id: string } | undefined;
  if (duplicate) return { eventId, projectId: duplicate.project_id, runId: duplicate.run_id, inserted: false };

  database.exec("BEGIN IMMEDIATE");
  let result;
  try {
    database.prepare(`
      INSERT INTO projects (id, name, path, last_seen_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, path = excluded.path, last_seen_at = excluded.last_seen_at
    `).run(projectId, projectName, projectPath, receivedAt);
    database.prepare(`
      INSERT INTO runs (id, project_id, source_run_id, quest, status, started_at, completed_at, updated_at, outcome)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        quest = CASE WHEN excluded.quest <> '' THEN excluded.quest ELSE runs.quest END,
        status = CASE WHEN excluded.status = 'complete' THEN 'complete' ELSE runs.status END,
        completed_at = COALESCE(runs.completed_at, excluded.completed_at),
        updated_at = excluded.updated_at,
        outcome = COALESCE(excluded.outcome, runs.outcome)
    `).run(runId, projectId, sourceRunId, quest, runComplete ? "complete" : "working", occurredAt, runComplete ? occurredAt : null, receivedAt, outcome);
    result = database.prepare(`
      INSERT OR IGNORE INTO events
        (event_id, source_event_id, project_id, run_id, agent, status, message, quest, from_agent, occurred_at, received_at, agent_instance_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(storedEventId, eventId, projectId, runId, agent, status, message, quest || null, from, occurredAt, receivedAt, cleanText(input.agentInstanceId, "", 180) || null);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }

  const inserted = Number(result.changes) > 0;
  if (runComplete && inserted) exportRun(database, runId);
  return { eventId, projectId, runId, inserted };
}

export function getDashboard(projectId?: string | null, requestedRunId?: string | null): DashboardPayload {
  const database = getDatabase();
  const agentRunCounts = Object.fromEntries(AGENT_IDS.map((agent) => [agent, 0])) as Record<AgentId, number>;
  const projectRows = database.prepare("SELECT * FROM projects ORDER BY last_seen_at DESC").all() as Record<string, unknown>[];
  const projects = projectRows.map(rowToProject);
  // Missing, empty, and unknown project IDs deliberately mean the global scope.
  // This keeps stale bookmarks non-breaking while making project selection optional.
  const selectedProjectId = projectId && projects.some((project) => project.id === projectId) ? projectId : null;
  const countRows = selectedProjectId ? database.prepare(`
    SELECT agent, COUNT(DISTINCT run_id) AS count
    FROM events
    WHERE project_id = ?
    GROUP BY agent
  `).all(selectedProjectId) : database.prepare(`
    SELECT agent, COUNT(DISTINCT run_id) AS count
    FROM events
    GROUP BY agent
  `).all() as Array<{ agent: string; count: number }>;
  for (const row of countRows) {
    if (AGENT_IDS.includes(row.agent as AgentId)) {
      agentRunCounts[row.agent as AgentId] = Number(row.count);
    }
  }

  const staleCutoff = new Date(Date.now() - STALE_AFTER_SECONDS * 1000).toISOString();
  const recentRows = (selectedProjectId
    ? database.prepare("SELECT * FROM runs WHERE project_id = ? ORDER BY CASE WHEN status = 'working' AND updated_at >= ? THEN 0 ELSE 1 END, updated_at DESC LIMIT 24").all(selectedProjectId, staleCutoff)
    : database.prepare("SELECT * FROM runs ORDER BY CASE WHEN status = 'working' AND updated_at >= ? THEN 0 ELSE 1 END, updated_at DESC LIMIT 24").all(staleCutoff)) as Record<string, unknown>[];
  const runs = recentRows.map(rowToRun);
  const requestedRow = requestedRunId ? (selectedProjectId
    ? database.prepare(`
        SELECT * FROM runs
        WHERE project_id = ? AND (id = ? OR source_run_id = ?)
        ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, updated_at DESC LIMIT 1
      `).get(selectedProjectId, requestedRunId, requestedRunId, requestedRunId)
    : database.prepare(`
        SELECT * FROM runs
        WHERE id = ? OR source_run_id = ?
        ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, updated_at DESC LIMIT 1
      `).get(requestedRunId, requestedRunId, requestedRunId)) as Record<string, unknown> | undefined : undefined;
  const run = requestedRow ? rowToRun(requestedRow) : runs[0] ?? null;
  const eventRows = run
    ? database.prepare("SELECT * FROM events WHERE run_id = ? AND project_id = ? ORDER BY occurred_at, id").all(run.id, run.projectId) as Record<string, unknown>[]
    : [];
  const events = run ? eventRows.map((row) => rowToEvent(row, run.startedAt)) : [];
  const recentEventRows = (selectedProjectId ? database.prepare(`
    SELECT events.*, runs.started_at AS run_started_at
    FROM events JOIN runs ON runs.id = events.run_id
    WHERE events.project_id = ?
    ORDER BY events.occurred_at DESC, events.id DESC LIMIT 100
  `).all(selectedProjectId) : database.prepare(`
    SELECT events.*, runs.started_at AS run_started_at
    FROM events JOIN runs ON runs.id = events.run_id
    ORDER BY events.occurred_at DESC, events.id DESC LIMIT 100
  `).all()) as Record<string, unknown>[];
  const recentEvents = recentEventRows.map((row) => rowToEvent(row, String(row.run_started_at)));

  const activityRows = (selectedProjectId ? database.prepare(`
    SELECT events.*, projects.name AS project_name
    FROM events
    JOIN runs ON runs.id = events.run_id
    JOIN projects ON projects.id = events.project_id
    WHERE runs.project_id = ? AND runs.status = 'working' AND runs.updated_at >= ?
    ORDER BY events.occurred_at, events.id
  `).all(selectedProjectId, staleCutoff) : database.prepare(`
    SELECT events.*, projects.name AS project_name
    FROM events
    JOIN runs ON runs.id = events.run_id
    JOIN projects ON projects.id = events.project_id
    WHERE runs.status = 'working' AND runs.updated_at >= ?
    ORDER BY events.occurred_at, events.id
  `).all(staleCutoff)) as Record<string, unknown>[];
  type ActivityState = Omit<GuildAgentActivity, "durationSeconds"> & { active: boolean };
  const activityById = new Map<string, ActivityState>();
  for (const row of activityRows) {
    const agent = safeAgent(row.agent);
    const runId = String(row.run_id);
    const project = String(row.project_id);
    const instance = row.agent_instance_id ? String(row.agent_instance_id) : `legacy:${runId}:${agent}`;
    const id = `${project}:${runId}:${instance}`;
    const status = safeStatus(row.status);
    const active = status === "working" || status === "queued";
    const previous = activityById.get(id);
    activityById.set(id, {
      id,
      agentInstanceId: instance,
      agent,
      projectId: project,
      projectName: String(row.project_name),
      runId,
      status: active ? status : previous?.status ?? "working",
      message: String(row.message),
      startedAt: active && previous?.active ? previous.startedAt : String(row.occurred_at),
      updatedAt: String(row.occurred_at),
      active,
    });
  }
  const serverTime = new Date().toISOString();
  const agentActivities = [...activityById.values()]
    .filter((activity) => activity.active)
    .map(({ active: _active, ...activity }): GuildAgentActivity => ({
      ...activity,
      durationSeconds: Math.max(0, Math.floor((Date.parse(serverTime) - Date.parse(activity.startedAt)) / 1000)),
    }))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

  const aggregate = (selectedProjectId ? database.prepare(`
    SELECT COUNT(*) AS total_runs,
      SUM(CASE WHEN status = 'complete' AND COALESCE(outcome, 'complete') = 'complete' THEN 1 ELSE 0 END) AS completed_runs,
      SUM(CASE WHEN outcome = 'interrupted' THEN 1 ELSE 0 END) AS interrupted_runs,
      SUM(CASE WHEN status = 'working' AND updated_at >= ? THEN 1 ELSE 0 END) AS active_runs,
      SUM(CASE WHEN status = 'working' AND updated_at < ? THEN 1 ELSE 0 END) AS stalled_runs,
      CAST(COALESCE(SUM(CASE WHEN status = 'complete' THEN (julianday(COALESCE(completed_at, updated_at)) - julianday(started_at)) * 86400 ELSE 0 END), 0) AS INTEGER) AS total_runtime_seconds
    FROM runs WHERE project_id = ?
  `).get(staleCutoff, staleCutoff, selectedProjectId) : database.prepare(`
    SELECT COUNT(*) AS total_runs,
      SUM(CASE WHEN status = 'complete' AND COALESCE(outcome, 'complete') = 'complete' THEN 1 ELSE 0 END) AS completed_runs,
      SUM(CASE WHEN outcome = 'interrupted' THEN 1 ELSE 0 END) AS interrupted_runs,
      SUM(CASE WHEN status = 'working' AND updated_at >= ? THEN 1 ELSE 0 END) AS active_runs,
      SUM(CASE WHEN status = 'working' AND updated_at < ? THEN 1 ELSE 0 END) AS stalled_runs,
      CAST(COALESCE(SUM(CASE WHEN status = 'complete' THEN (julianday(COALESCE(completed_at, updated_at)) - julianday(started_at)) * 86400 ELSE 0 END), 0) AS INTEGER) AS total_runtime_seconds
    FROM runs
  `).get(staleCutoff, staleCutoff)) as Record<string, number>;
  const completedRuns = Number(aggregate.completed_runs || 0);
  const interruptedRuns = Number(aggregate.interrupted_runs || 0);
  const activeRuns = Number(aggregate.active_runs || 0);
  const stalledRuns = Number(aggregate.stalled_runs || 0);
  const totalRuns = Number(aggregate.total_runs || 0);
  const totalRuntimeSeconds = Number(aggregate.total_runtime_seconds || 0);
  const terminalRunCount = completedRuns + interruptedRuns;
  const [mostUsedAgent, mostUsedAgentRuns] = (Object.entries(agentRunCounts) as Array<[AgentId, number]>).sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  const statistics: GuildStatistics = {
    totalRuns,
    completedRuns,
    interruptedRuns,
    activeRuns,
    stalledRuns,
    completionRate: completedRuns + interruptedRuns ? Math.round((completedRuns / (completedRuns + interruptedRuns)) * 100) : 0,
    averageDurationSeconds: terminalRunCount ? Math.round(totalRuntimeSeconds / terminalRunCount) : 0,
    totalRuntimeSeconds,
    mostUsedAgent: mostUsedAgentRuns > 0 ? mostUsedAgent : null,
    mostUsedAgentRuns,
  };
  return { projects, selectedProjectId, run, runs, events, recentEvents, agentActivities, agentRunCounts, statistics, serverTime };
}

export function getStorageHealth(): GuildStorageHealth {
  const database = getDatabase();
  const eventRow = database.prepare("SELECT COUNT(*) AS count, MAX(received_at) AS latest_at FROM events").get() as { count: number; latest_at: string | null };
  const runRow = database.prepare("SELECT COUNT(*) AS count, SUM(CASE WHEN status = 'working' THEN 1 ELSE 0 END) AS working_count, MAX(updated_at) AS latest_at FROM runs").get() as { count: number; working_count: number | null; latest_at: string | null };
  const projectRow = database.prepare("SELECT COUNT(*) AS count FROM projects").get() as { count: number };
  const root = storageRootPath();
  const logPath = path.join(root, "logs", "hook.jsonl");
  const hook = readHookDiagnostics(logPath);
  const latestEventAt = eventRow.latest_at ? String(eventRow.latest_at) : null;
  const latestRunAt = runRow.latest_at ? String(runRow.latest_at) : null;
  return {
    ok: true,
    databasePath: databasePath(),
    vaultPath: vaultPath(),
    storageRootPath: root,
    hookLogPath: logPath,
    hookLogStatus: hook.status,
    projectCount: Number(projectRow.count),
    runCount: Number(runRow.count),
    workingRunCount: Number(runRow.working_count || 0),
    eventCount: Number(eventRow.count),
    latestRunAt,
    latestRunAgeSeconds: ageSeconds(latestRunAt),
    latestEventAt,
    latestEventAgeSeconds: ageSeconds(latestEventAt),
    lastHookReceiptAt: hook.receiptAt,
    lastHookReceiptAgeSeconds: ageSeconds(hook.receiptAt),
    lastHookEvent: hook.event,
    lastHookStage: hook.stage,
    lastHookSource: hook.source,
  };
}
