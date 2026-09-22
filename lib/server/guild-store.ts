import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { LEGACY_AGENT_IDS, canonicalAgentId, type RoomStatus } from "@/lib/guild-data";
import { ageSeconds, parseLatestHookLog, type HookLogStatus, type HookSource } from "@/lib/guild-health";
import { ensureCatalogSchema, getCatalog } from "@/lib/server/agent-catalog";
import type {
  AgentMetric,
  AgentPresentation,
  CatalogAgent,
  DashboardPayload,
  GuildAgentActivity,
  HistoryPayload,
  HistoryQuery,
  HistoryRunSummary,
  GuildStorageHealth,
  GuildStatistics,
  GuildProject,
  GuildRun,
  IncomingGuildEvent,
  StoredGuildEvent,
  TokenUsageReceipt,
  TokenUsageSummary,
} from "@/lib/guild-contract";

const DEFAULT_STORAGE_ROOT = path.join(homedir(), ".lanternwatch");
const roomStatuses = new Set<RoomStatus>(["waiting", "queued", "working", "complete", "interrupted", "stalled"]);
const STALE_AFTER_SECONDS = Number(process.env.LANTERNWATCH_STALE_AFTER_SECONDS || 600);
const SCHEMA_VERSION = 6;

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
  const environmentDatabasePath = configuredPath(process.env.LANTERNWATCH_DB_PATH);
  const configuredDatabasePath = configuredPath(configuration.databasePath);
  const storageRoot = environmentStorageRoot
    || (environmentDatabasePath ? path.dirname(environmentDatabasePath) : undefined)
    || configuredPath(configuration.storageRoot)
    || (configuredDatabasePath ? path.dirname(configuredDatabasePath) : DEFAULT_STORAGE_ROOT);
  return {
    databasePath: environmentDatabasePath
      || (environmentStorageRoot ? path.join(environmentStorageRoot, "guild.db") : undefined)
      || configuredDatabasePath
      || path.join(storageRoot, "guild.db"),
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

function logStoreFailure(stage: string, error: unknown, eventId: string, runId: string) {
  try {
    const directory = path.join(storageRootPath(), "logs");
    mkdirSync(directory, { recursive: true });
    const candidate = error && typeof error === "object" ? error as { name?: unknown; code?: unknown } : {};
    const safe = (value: unknown, fallback: string) => typeof value === "string" && value.trim()
      ? value.trim().replace(/[^a-zA-Z0-9._:-]/g, "-").slice(0, 80)
      : fallback;
    writeFileSync(path.join(directory, "server.jsonl"), `${JSON.stringify({
      at: new Date().toISOString(),
      stage,
      name: safe(candidate.name, "Error"),
      code: safe(candidate.code, "unknown"),
      eventId: safe(eventId, "event"),
      runId: safe(runId, "run"),
    })}\n`, { encoding: "utf8", flag: "a" });
  } catch {}
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
    CREATE TABLE IF NOT EXISTS agent_usage (
      project_id TEXT NOT NULL REFERENCES projects(id),
      run_id TEXT NOT NULL REFERENCES runs(id),
      agent_instance_id TEXT NOT NULL,
      agent TEXT NOT NULL,
      source TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT '',
      usage_mode TEXT NOT NULL CHECK(usage_mode IN ('cumulative', 'delta')),
      input_tokens INTEGER CHECK(input_tokens IS NULL OR input_tokens >= 0),
      cached_input_tokens INTEGER CHECK(cached_input_tokens IS NULL OR cached_input_tokens >= 0),
      output_tokens INTEGER CHECK(output_tokens IS NULL OR output_tokens >= 0),
      reasoning_tokens INTEGER CHECK(reasoning_tokens IS NULL OR reasoning_tokens >= 0),
      total_tokens INTEGER CHECK(total_tokens IS NULL OR total_tokens >= 0),
      updated_at TEXT NOT NULL,
      PRIMARY KEY (project_id, run_id, agent_instance_id, source, model)
    );
    CREATE INDEX IF NOT EXISTS runs_updated_id ON runs(updated_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS events_agent_run ON events(agent, run_id);
    CREATE INDEX IF NOT EXISTS events_run_occurred ON events(run_id, occurred_at);
    CREATE INDEX IF NOT EXISTS agent_usage_run_agent ON agent_usage(project_id, run_id, agent);
  `);
  const runColumns = database.prepare("PRAGMA table_info(runs)").all() as Array<{ name: string }>;
  if (!runColumns.some((column) => column.name === "outcome")) database.exec("ALTER TABLE runs ADD COLUMN outcome TEXT");
  if (!runColumns.some((column) => column.name === "source_run_id")) database.exec("ALTER TABLE runs ADD COLUMN source_run_id TEXT");
  const eventColumns = database.prepare("PRAGMA table_info(events)").all() as Array<{ name: string }>;
  if (!eventColumns.some((column) => column.name === "agent_instance_id")) database.exec("ALTER TABLE events ADD COLUMN agent_instance_id TEXT");
  if (!eventColumns.some((column) => column.name === "source_event_id")) database.exec("ALTER TABLE events ADD COLUMN source_event_id TEXT");
  if (!eventColumns.some((column) => column.name === "agent_type")) database.exec("ALTER TABLE events ADD COLUMN agent_type TEXT");
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
  database.exec("BEGIN IMMEDIATE");
  try {
    const migrateAgent = database.prepare("UPDATE events SET agent = ? WHERE agent = ?");
    const migrateFromAgent = database.prepare("UPDATE events SET from_agent = ? WHERE from_agent = ?");
    for (const [legacyId, canonicalId] of Object.entries(LEGACY_AGENT_IDS)) {
      migrateAgent.run(canonicalId, legacyId);
      migrateFromAgent.run(canonicalId, legacyId);
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  ensureCatalogSchema(database);
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

function safeAgent(value: unknown): string {
  const canonical = canonicalAgentId(value);
  if (canonical) return canonical;
  return cleanText(value, "unknown-agent", 96).replace(/[^a-zA-Z0-9._:-]/g, "-");
}

function safeAgentType(value: unknown, fallback: string): string {
  return cleanText(value, fallback, 96).replace(/[^a-zA-Z0-9._:-]/g, "-");
}

function safeStatus(value: unknown): RoomStatus {
  return typeof value === "string" && roomStatuses.has(value as RoomStatus)
    ? (value as RoomStatus)
    : "working";
}

type NormalizedUsage = {
  source: string;
  model: string;
  mode: "cumulative" | "delta";
  reportedAt: string;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  totalTokens: number | null;
};

function tokenCount(value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer.`);
  return value;
}

function normalizeUsage(value: TokenUsageReceipt | undefined, occurredAt: string): NormalizedUsage | null {
  if (!value) return null;
  const source = cleanText(value.source, "", 96).replace(/[^a-zA-Z0-9._:-]/g, "-");
  if (!source) throw new Error("Token usage source is required.");
  const usage: NormalizedUsage = {
    source,
    model: cleanText(value.model, "", 160),
    mode: value.mode === "delta" ? "delta" : "cumulative",
    reportedAt: value.reportedAt ? normalizeDate(value.reportedAt) : occurredAt,
    inputTokens: tokenCount(value.inputTokens, "inputTokens"),
    cachedInputTokens: tokenCount(value.cachedInputTokens, "cachedInputTokens"),
    outputTokens: tokenCount(value.outputTokens, "outputTokens"),
    reasoningTokens: tokenCount(value.reasoningTokens, "reasoningTokens"),
    totalTokens: tokenCount(value.totalTokens, "totalTokens"),
  };
  if ([usage.inputTokens, usage.cachedInputTokens, usage.outputTokens, usage.reasoningTokens, usage.totalTokens].every((count) => count === null)) {
    throw new Error("Token usage must include at least one counter.");
  }
  return usage;
}

function usageInstanceId(value: unknown, runId: string, agent: string) {
  return cleanText(value, `legacy:${runId}:${agent}`, 180) || `legacy:${runId}:${agent}`;
}

function storeUsage(database: DatabaseSync, projectId: string, runId: string, agent: string, agentInstanceId: string, usage: NormalizedUsage) {
  const existing = database.prepare(`
    SELECT input_tokens, cached_input_tokens, output_tokens, reasoning_tokens, total_tokens, updated_at
    FROM agent_usage
    WHERE project_id = ? AND run_id = ? AND agent_instance_id = ? AND source = ? AND model = ?
  `).get(projectId, runId, agentInstanceId, usage.source, usage.model) as Record<string, unknown> | undefined;
  const previous = (field: string) => existing?.[field] === null || existing?.[field] === undefined ? null : Number(existing[field]);
  const merge = (field: string, value: number | null) => {
    if (usage.mode === "delta") return value === null ? previous(field) : (previous(field) ?? 0) + value;
    if (existing && Date.parse(usage.reportedAt) < Date.parse(String(existing.updated_at))) return previous(field);
    return value ?? previous(field);
  };
  const updatedAt = existing && Date.parse(usage.reportedAt) < Date.parse(String(existing.updated_at))
    ? String(existing.updated_at)
    : usage.reportedAt;
  database.prepare(`
    INSERT INTO agent_usage (
      project_id, run_id, agent_instance_id, agent, source, model, usage_mode,
      input_tokens, cached_input_tokens, output_tokens, reasoning_tokens, total_tokens, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id, run_id, agent_instance_id, source, model) DO UPDATE SET
      agent = excluded.agent, usage_mode = excluded.usage_mode,
      input_tokens = excluded.input_tokens, cached_input_tokens = excluded.cached_input_tokens,
      output_tokens = excluded.output_tokens, reasoning_tokens = excluded.reasoning_tokens,
      total_tokens = excluded.total_tokens, updated_at = excluded.updated_at
  `).run(
    projectId, runId, agentInstanceId, agent, usage.source, usage.model, usage.mode,
    merge("input_tokens", usage.inputTokens), merge("cached_input_tokens", usage.cachedInputTokens),
    merge("output_tokens", usage.outputTokens), merge("reasoning_tokens", usage.reasoningTokens),
    // Totals are stored only when the receipt explicitly guarantees one. They are never derived from components.
    merge("total_tokens", usage.totalTokens), updatedAt,
  );
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
    agentType: safeAgentType(row.agent_type, safeAgent(row.agent)),
    status: safeStatus(row.status),
    message: String(row.message),
    quest: row.quest ? String(row.quest) : null,
    from: row.from_agent ? safeAgent(row.from_agent) : null,
    occurredAt,
    elapsedSeconds: Math.max(0, Math.floor((Date.parse(occurredAt) - Date.parse(startedAt)) / 1000)),
    agentInstanceId: row.agent_instance_id ? String(row.agent_instance_id) : null,
  };
}

function tokenUsageSummary(database: DatabaseSync, filters: { projectId?: string; runId?: string; agent?: string }): TokenUsageSummary {
  const clauses: string[] = [];
  const params: string[] = [];
  const eventClauses: string[] = [];
  const eventParams: string[] = [];
  const add = (column: string, value: string | undefined) => {
    if (!value) return;
    clauses.push(`${column} = ?`);
    params.push(value);
    eventClauses.push(`${column.replace("agent_usage", "events")} = ?`);
    eventParams.push(value);
  };
  add("agent_usage.project_id", filters.projectId);
  add("agent_usage.run_id", filters.runId);
  add("agent_usage.agent", filters.agent);
  const usageWhere = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const eventWhere = eventClauses.length ? `WHERE ${eventClauses.join(" AND ")}` : "";
  const usageRows = database.prepare(`
    SELECT agent, run_id, project_id, agent_instance_id, input_tokens, cached_input_tokens, output_tokens, reasoning_tokens, total_tokens
    FROM agent_usage ${usageWhere}
  `).all(...params) as Record<string, unknown>[];
  const instances = database.prepare(`
    SELECT agent, run_id, project_id, agent_instance_id FROM events ${eventWhere}
  `).all(...eventParams) as Record<string, unknown>[];
  const totals = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0, totalTokens: 0 };
  const present = { inputTokens: false, cachedInputTokens: false, outputTokens: false, reasoningTokens: false, totalTokens: false };
  const reported = new Set<string>();
  for (const row of usageRows) {
    const key = `${row.project_id}:${row.run_id}:${row.agent}:${row.agent_instance_id}`;
    const values: Array<[keyof typeof totals, string]> = [
      ["inputTokens", "input_tokens"], ["cachedInputTokens", "cached_input_tokens"], ["outputTokens", "output_tokens"], ["reasoningTokens", "reasoning_tokens"], ["totalTokens", "total_tokens"],
    ];
    let hasUsage = false;
    for (const [name, column] of values) {
      if (row[column] === null || row[column] === undefined) continue;
      totals[name] += Number(row[column]);
      present[name] = true;
      hasUsage = true;
    }
    if (hasUsage) reported.add(key);
  }
  const knownInstances = new Set(instances.map((row) => `${row.project_id}:${row.run_id}:${row.agent}:${usageInstanceId(row.agent_instance_id, String(row.run_id), String(row.agent))}`));
  return {
    inputTokens: present.inputTokens ? totals.inputTokens : null,
    cachedInputTokens: present.cachedInputTokens ? totals.cachedInputTokens : null,
    outputTokens: present.outputTokens ? totals.outputTokens : null,
    reasoningTokens: present.reasoningTokens ? totals.reasoningTokens : null,
    totalTokens: present.totalTokens ? totals.totalTokens : null,
    reportedAgentInstances: reported.size,
    unreportedAgentInstances: Math.max(0, knownInstances.size - reported.size),
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
  const agentType = safeAgentType(input.agentType, agent);
  const status = safeStatus(input.status);
  const message = cleanText(input.message, `${agent} changed state to ${status}.`, 1000);
  const quest = cleanText(input.quest, "", 1000);
  const from = input.from ? safeAgent(input.from) : null;
  const sourceRunId = cleanText(input.runId, `${projectId}-${occurredAt.slice(0, 19)}`, 180);
  const runId = resolveRunStorageId(database, projectId, sourceRunId);
  const usage = normalizeUsage(input.usage, occurredAt);
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
        (event_id, source_event_id, project_id, run_id, agent, agent_type, status, message, quest, from_agent, occurred_at, received_at, agent_instance_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(storedEventId, eventId, projectId, runId, agent, agentType, status, message, quest || null, from, occurredAt, receivedAt, cleanText(input.agentInstanceId, "", 180) || null);
    if (Number(result.changes) > 0 && usage) {
      storeUsage(database, projectId, runId, agent, usageInstanceId(input.agentInstanceId, runId, agent), usage);
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }

  const inserted = Number(result.changes) > 0;
  if (runComplete && inserted) {
    try {
      exportRun(database, runId);
    } catch (exportError) {
      // The SQLite transaction is authoritative. Optional Markdown export is
      // best-effort and must never make the ingestion API return a false 400
      // after the lifecycle event has already committed.
      logStoreFailure("export-failed", exportError, eventId, sourceRunId);
    }
  }
  return { eventId, projectId, runId, inserted };
}

export function getDashboard(projectId?: string | null, requestedRunId?: string | null): DashboardPayload {
  const database = getDatabase();
  const agentRunCounts: Record<string, number> = {};
  const agentMetrics: Record<string, AgentMetric> = {};
  const projectRows = database.prepare("SELECT * FROM projects ORDER BY last_seen_at DESC").all() as Record<string, unknown>[];
  const projects = projectRows.map(rowToProject);
  // Missing, empty, and unknown project IDs deliberately mean the global scope.
  // This keeps stale bookmarks non-breaking while making project selection optional.
  const selectedProjectId = projectId && projects.some((project) => project.id === projectId) ? projectId : null;
  const catalogResult = getCatalog({
    database,
    storageRoot: storageRootPath(),
    allowedWorkspacePaths: [...projects.map((project) => project.path), process.cwd()],
  });
  const presentationFor = (agent: string, agentType = agent): AgentPresentation => {
    const byIdentity = (identity: string) => catalogResult.agents.filter((candidate) => candidate.codexReady && candidate.name.toLowerCase() === identity.toLowerCase());
    const exactCandidates = byIdentity(agentType);
    const candidates = exactCandidates.length > 0 ? exactCandidates : byIdentity(agent);
    const enabled = candidates.filter((candidate) => candidate.enabled);
    if (enabled.length === 1) {
      const candidate = enabled[0];
      return { scope: candidate.scope, sourcePath: candidate.sourcePath, tags: candidate.tags, unresolved: false };
    }
    if (enabled.length > 1) return { tags: [], unresolved: true, candidates: enabled.map(({ scope, sourcePath, tags }) => ({ scope, sourcePath, tags })) };
    return { tags: [], unresolved: false };
  };
  const serverTime = new Date().toISOString();
  const staleCutoff = new Date(Date.now() - STALE_AFTER_SECONDS * 1000).toISOString();
  const countRows = (selectedProjectId ? database.prepare(`
    SELECT DISTINCT agent, run_id
    FROM events
    WHERE project_id = ?
  `).all(selectedProjectId) : database.prepare(`
    SELECT DISTINCT agent, run_id
    FROM events
  `).all()) as Array<{ agent: string; run_id: string }>;
  const countedRuns = new Map<string, Set<string>>();
  for (const row of countRows) {
    const agent = safeAgent(row.agent);
    const runs = countedRuns.get(agent) ?? new Set<string>();
    runs.add(row.run_id);
    countedRuns.set(agent, runs);
  }
  for (const [agent, runIds] of countedRuns) {
    agentRunCounts[agent] = runIds.size;
  }

  const metricRows = (selectedProjectId ? database.prepare(`
    SELECT events.agent, events.run_id, events.project_id, events.agent_instance_id, events.status, events.message, events.occurred_at,
      runs.status AS run_status, runs.completed_at, runs.updated_at AS run_updated_at
    FROM events JOIN runs ON runs.id = events.run_id
    WHERE events.project_id = ?
    ORDER BY events.project_id, events.run_id, events.agent, COALESCE(events.agent_instance_id, ''), events.occurred_at, events.id
  `).all(selectedProjectId) : database.prepare(`
    SELECT events.agent, events.run_id, events.project_id, events.agent_instance_id, events.status, events.message, events.occurred_at,
      runs.status AS run_status, runs.completed_at, runs.updated_at AS run_updated_at
    FROM events JOIN runs ON runs.id = events.run_id
    ORDER BY events.project_id, events.run_id, events.agent, COALESCE(events.agent_instance_id, ''), events.occurred_at, events.id
  `).all()) as Record<string, unknown>[];
  type InstanceWindow = { agent: string; startedAt: string | null; lastAt: string; runStatus: string; completedAt: string | null; updatedAt: string };
  const instanceWindows = new Map<string, InstanceWindow>();
  const metricFor = (agent: string) => {
    const key = agent.toLowerCase();
    return agentMetrics[key] ??= { agent, runCount: agentRunCounts[agent] ?? 0, trackedActiveSeconds: 0, activeInstances: 0, lastActivityAt: null, lastActivityMessage: null };
  };
  for (const row of metricRows) {
    const agent = safeAgent(String(row.agent));
    const metric = metricFor(agent);
    const occurredAt = String(row.occurred_at);
    if (!metric.lastActivityAt || Date.parse(occurredAt) >= Date.parse(metric.lastActivityAt)) {
      metric.lastActivityAt = occurredAt;
      metric.lastActivityMessage = String(row.message);
    }
    const instance = row.agent_instance_id ? String(row.agent_instance_id) : `legacy:${String(row.run_id)}:${agent}`;
    const key = `${String(row.project_id)}:${String(row.run_id)}:${instance}`;
    const window = instanceWindows.get(key) ?? { agent, startedAt: null, lastAt: occurredAt, runStatus: String(row.run_status), completedAt: row.completed_at ? String(row.completed_at) : null, updatedAt: String(row.run_updated_at) };
    const status = safeStatus(row.status);
    if ((status === "queued" || status === "working") && !window.startedAt) window.startedAt = occurredAt;
    if (window.startedAt && status !== "queued" && status !== "working") {
      metric.trackedActiveSeconds += Math.max(0, Math.floor((Date.parse(occurredAt) - Date.parse(window.startedAt)) / 1000));
      window.startedAt = null;
    }
    window.lastAt = occurredAt;
    window.runStatus = String(row.run_status);
    window.completedAt = row.completed_at ? String(row.completed_at) : null;
    window.updatedAt = String(row.run_updated_at);
    instanceWindows.set(key, window);
  }
  for (const window of instanceWindows.values()) {
    if (!window.startedAt) continue;
    const freshWorkingRun = window.runStatus === "working" && Date.parse(window.updatedAt) >= Date.parse(staleCutoff);
    const endedAt = freshWorkingRun ? serverTime : window.completedAt || window.updatedAt || window.lastAt;
    metricFor(window.agent).trackedActiveSeconds += Math.max(0, Math.floor((Date.parse(endedAt) - Date.parse(window.startedAt)) / 1000));
  }

  const recentRows = (selectedProjectId
    ? database.prepare("SELECT * FROM runs WHERE project_id = ? ORDER BY CASE WHEN status = 'working' AND updated_at >= ? THEN 0 ELSE 1 END, updated_at DESC LIMIT 24").all(selectedProjectId, staleCutoff)
    : database.prepare("SELECT * FROM runs ORDER BY CASE WHEN status = 'working' AND updated_at >= ? THEN 0 ELSE 1 END, updated_at DESC LIMIT 24").all(staleCutoff)) as Record<string, unknown>[];
  const runs = recentRows.map((row) => {
    const run = rowToRun(row);
    return { ...run, tokenUsage: tokenUsageSummary(database, { projectId: run.projectId, runId: run.id }) };
  });
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
  const run = requestedRow
    ? (() => {
      const selected = rowToRun(requestedRow);
      return { ...selected, tokenUsage: tokenUsageSummary(database, { projectId: selected.projectId, runId: selected.id }) };
    })()
    : runs[0] ?? null;
  const eventRows = run
    ? database.prepare("SELECT * FROM events WHERE run_id = ? AND project_id = ? ORDER BY occurred_at, id").all(run.id, run.projectId) as Record<string, unknown>[]
    : [];
  const events = run ? eventRows.map((row) => ({ ...rowToEvent(row, run.startedAt), presentation: presentationFor(safeAgent(row.agent), safeAgentType(row.agent_type, safeAgent(row.agent))) })) : [];
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
  const recentEvents = recentEventRows.map((row) => ({ ...rowToEvent(row, String(row.run_started_at)), presentation: presentationFor(safeAgent(row.agent), safeAgentType(row.agent_type, safeAgent(row.agent))) }));

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
    const agentType = safeAgentType(row.agent_type, agent);
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
      agentType,
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
  const agentActivities = [...activityById.values()]
    .filter((activity) => activity.active)
    .map(({ active: _active, ...activity }): GuildAgentActivity => ({
      ...activity,
      durationSeconds: Math.max(0, Math.floor((Date.parse(serverTime) - Date.parse(activity.startedAt)) / 1000)),
      presentation: presentationFor(activity.agent, activity.agentType),
    }))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  for (const activity of agentActivities) metricFor(activity.agent).activeInstances += 1;
  for (const metric of Object.values(agentMetrics)) {
    metric.tokenUsage = tokenUsageSummary(database, { projectId: selectedProjectId ?? undefined, agent: metric.agent });
  }

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
  const [mostUsedAgent, mostUsedAgentRuns] = Object.entries(agentRunCounts).sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
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
    tokenUsage: tokenUsageSummary(database, { projectId: selectedProjectId ?? undefined }),
  };
  const agentWorkspacePaths = [...new Set([...projects.map((project) => project.path), process.cwd()])];
  return { projects, selectedProjectId, run, runs, events, recentEvents, agentActivities, agentRunCounts, agentMetrics, agentCatalog: catalogResult.agents, agentCatalogSettings: catalogResult.settings, agentWorkspacePaths, statistics, serverTime };
}

export class HistoryQueryError extends Error {
  readonly code: "invalid-project";

  constructor(code: "invalid-project") {
    super(code);
    this.code = code;
  }
}

export function getHistory(query: HistoryQuery): HistoryPayload {
  const database = getDatabase();
  if (query.projectId) {
    const project = database.prepare("SELECT 1 FROM projects WHERE id = ?").get(query.projectId);
    if (!project) throw new HistoryQueryError("invalid-project");
  }
  const staleCutoff = new Date(Date.now() - STALE_AFTER_SECONDS * 1000).toISOString();
  const clauses: string[] = [];
  const params: string[] = [];
  if (query.projectId) { clauses.push("runs.project_id = ?"); params.push(query.projectId); }
  if (query.status === "active") { clauses.push("runs.status = 'working' AND runs.updated_at >= ?"); params.push(staleCutoff); }
  if (query.status === "stalled") { clauses.push("runs.status = 'working' AND runs.updated_at < ?"); params.push(staleCutoff); }
  if (query.status === "completed") clauses.push("runs.status = 'complete' AND COALESCE(runs.outcome, 'complete') = 'complete'");
  if (query.status === "interrupted") clauses.push("runs.outcome = 'interrupted'");
  if (query.agent) {
    clauses.push("EXISTS (SELECT 1 FROM events agent_events WHERE agent_events.project_id = runs.project_id AND agent_events.run_id = runs.id AND agent_events.agent = ?)");
    params.push(query.agent);
  }
  if (query.q) {
    const pattern = `%${query.q}%`;
    clauses.push(`(
      runs.quest LIKE ? OR runs.source_run_id LIKE ? OR projects.name LIKE ? OR
      EXISTS (SELECT 1 FROM events search_events WHERE search_events.project_id = runs.project_id AND search_events.run_id = runs.id AND (search_events.message LIKE ? OR search_events.quest LIKE ?))
    )`);
    params.push(pattern, pattern, pattern, pattern, pattern);
  }
  if (query.from) { clauses.push("runs.updated_at >= ?"); params.push(query.from); }
  if (query.to) { clauses.push("runs.updated_at <= ?"); params.push(query.to); }
  const baseWhere = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const count = database.prepare(`SELECT COUNT(*) AS count FROM runs JOIN projects ON projects.id = runs.project_id ${baseWhere}`).get(...params) as { count: number };
  const pageClauses = [...clauses];
  const pageParams = [...params];
  if (query.cursor) {
    pageClauses.push("(runs.updated_at < ? OR (runs.updated_at = ? AND runs.id < ?))");
    pageParams.push(query.cursor.updatedAt, query.cursor.updatedAt, query.cursor.id);
  }
  const pageWhere = pageClauses.length ? `WHERE ${pageClauses.join(" AND ")}` : "";
  const rows = database.prepare(`
    SELECT runs.*, projects.name AS project_name
    FROM runs JOIN projects ON projects.id = runs.project_id
    ${pageWhere}
    ORDER BY runs.updated_at DESC, runs.id DESC
    LIMIT ?
  `).all(...pageParams, query.limit + 1) as Record<string, unknown>[];
  const hasMore = rows.length > query.limit;
  const page = rows.slice(0, query.limit);
  const items: HistoryRunSummary[] = page.map((row) => {
    const run = rowToRun(row);
    const facts = database.prepare(`
      SELECT COUNT(*) AS event_count FROM events WHERE project_id = ? AND run_id = ?
    `).get(run.projectId, run.id) as { event_count: number };
    const participants = (database.prepare(`
      SELECT DISTINCT agent FROM events WHERE project_id = ? AND run_id = ? ORDER BY agent
    `).all(run.projectId, run.id) as Array<{ agent: string }>).map((participant) => safeAgent(participant.agent));
    return {
      ...run,
      projectName: String(row.project_name),
      eventCount: Number(facts.event_count),
      participants,
      tokenUsage: tokenUsageSummary(database, { projectId: run.projectId, runId: run.id }),
    };
  });
  const last = items.at(-1);
  return {
    items,
    totalMatches: Number(count.count),
    nextCursor: hasMore && last ? { updatedAt: last.updatedAt, id: last.id } : null,
  };
}

export function getCatalogDependencies() {
  const database = getDatabase();
  const projectRows = database.prepare("SELECT path FROM projects").all() as Array<{ path: string }>;
  return { database, storageRoot: storageRootPath(), allowedWorkspacePaths: [...projectRows.map((project) => project.path), process.cwd()] };
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
