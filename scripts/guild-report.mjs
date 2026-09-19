import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { lanternwatchRuntimePaths } from "./guild-paths.mjs";
import { canonicalAgentId, companyTitleForAgent } from "./guild-roles.mjs";

const DEFAULT_API = "http://127.0.0.1:3000/api/guild/events";
const STATUSES = new Set(["waiting", "queued", "working", "complete", "interrupted", "stalled"]);
const SOURCES = new Set(["codex", "claude"]);

function option(args, name) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function clean(value, fallback, max = 1000) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : fallback;
}

export function parseNotifyPayload(raw) {
  try {
    const payload = JSON.parse(raw);
    return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  } catch { return {}; }
}

function identifier(value, fallback) {
  const cleaned = clean(value, fallback, 180);
  return cleaned.replace(/[^a-zA-Z0-9._:-]/g, "-");
}

function eventAgent(value, fallback = "program-manager") {
  const candidate = identifier(value, fallback);
  return canonicalAgentId(candidate) || candidate;
}

export function notifyEvent(payload) {
  const projectPath = clean(payload.cwd ?? payload["project-path"], process.cwd());
  const threadId = identifier(payload["thread-id"] ?? payload.thread_id, "thread");
  const turnId = identifier(payload["turn-id"] ?? payload.turn_id, "turn");
  return {
    eventId: `hook-stop-${threadId}-${turnId}`,
    projectPath,
    projectName: path.basename(projectPath),
    runId: `codex-${threadId}-${turnId}`,
    source: "codex",
    agent: "program-manager",
    status: "complete",
    message: "Codex turn completed and returned to idle.",
    quest: "Codex workspace activity",
    occurredAt: new Date().toISOString(),
    runComplete: true,
  };
}

export function cliEvent(args) {
  const projectPath = path.resolve(clean(option(args, "project"), process.cwd()));
  const agentCandidate = clean(option(args, "agent"), "program-manager");
  const agent = eventAgent(agentCandidate);
  const fromValue = option(args, "from");
  const from = fromValue === undefined ? undefined : eventAgent(fromValue, "unknown-agent");
  const statusCandidate = clean(option(args, "status"), "working").toLowerCase();
  const runId = clean(option(args, "run-id"), `manual-${createHash("sha1").update(projectPath).digest("hex").slice(0, 10)}`);
  return {
    eventId: clean(option(args, "event-id"), randomUUID()),
    projectPath,
    projectName: clean(option(args, "project-name"), path.basename(projectPath), 120),
    runId,
    source: SOURCES.has(String(option(args, "source") || "").toLowerCase())
      ? String(option(args, "source")).toLowerCase()
      : undefined,
    agent,
    status: STATUSES.has(statusCandidate) ? statusCandidate : "working",
    message: clean(option(args, "message"), `${companyTitleForAgent(agent) || agent} changed state to ${statusCandidate}.`),
    quest: clean(option(args, "quest"), "Codex workspace activity"),
    from,
    agentInstanceId: option(args, "agent-instance-id"),
    occurredAt: new Date().toISOString(),
    runComplete: args.includes("--run-complete"),
  };
}

export function normalizeEventAgentIds(event) {
  return {
    ...event,
    agent: eventAgent(event?.agent),
    from: event?.from === undefined || event?.from === null ? undefined : eventAgent(event.from, "unknown-agent"),
  };
}

function databasePath() { return lanternwatchRuntimePaths().databasePath; }
function vaultPath() { return lanternwatchRuntimePaths().vaultPath; }

function ensureSchema(database) {
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 3000;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE, last_seen_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), quest TEXT NOT NULL DEFAULT '', status TEXT NOT NULL CHECK(status IN ('working', 'complete')), started_at TEXT NOT NULL, completed_at TEXT, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE, project_id TEXT NOT NULL REFERENCES projects(id), run_id TEXT NOT NULL REFERENCES runs(id), agent TEXT NOT NULL, status TEXT NOT NULL, message TEXT NOT NULL, quest TEXT, from_agent TEXT, occurred_at TEXT NOT NULL, received_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS events_run_id ON events(run_id, id);
    CREATE INDEX IF NOT EXISTS events_project_agent_run ON events(project_id, agent, run_id);
    CREATE INDEX IF NOT EXISTS runs_project_updated ON runs(project_id, updated_at DESC);
  `);
  const columns = database.prepare("PRAGMA table_info(runs)").all();
  if (!columns.some((column) => column.name === "outcome")) {
    database.exec("ALTER TABLE runs ADD COLUMN outcome TEXT");
  }
  if (!columns.some((column) => column.name === "source_run_id")) {
    database.exec("ALTER TABLE runs ADD COLUMN source_run_id TEXT");
  }
  const eventColumns = database.prepare("PRAGMA table_info(events)").all();
  if (!eventColumns.some((column) => column.name === "agent_instance_id")) {
    database.exec("ALTER TABLE events ADD COLUMN agent_instance_id TEXT");
  }
  if (!eventColumns.some((column) => column.name === "source_event_id")) {
    database.exec("ALTER TABLE events ADD COLUMN source_event_id TEXT");
  }
  database.exec(`
    UPDATE runs SET source_run_id = id WHERE source_run_id IS NULL OR source_run_id = '';
    UPDATE events SET source_event_id = event_id WHERE source_event_id IS NULL OR source_event_id = '';
    CREATE UNIQUE INDEX IF NOT EXISTS runs_project_source_id ON runs(project_id, source_run_id);
    CREATE UNIQUE INDEX IF NOT EXISTS events_project_source_id ON events(project_id, source_event_id);
    UPDATE runs SET completed_at = (SELECT MIN(occurred_at) FROM events WHERE events.run_id = runs.id AND events.status IN ('complete', 'interrupted')) WHERE status = 'complete' AND EXISTS (SELECT 1 FROM events WHERE events.run_id = runs.id AND events.status IN ('complete', 'interrupted'));
  `);
}

function scopedStorageId(kind, projectId, sourceId) {
  const digest = createHash("sha256").update(`${projectId}\0${sourceId}`).digest("hex").slice(0, 32);
  return `${kind}:${projectId}:${digest}`;
}

function resolveRunStorageId(database, projectId, sourceRunId) {
  return database.prepare("SELECT id FROM runs WHERE project_id = ? AND source_run_id = ?").get(projectId, sourceRunId)?.id
    || scopedStorageId("run", projectId, sourceRunId);
}

function logReporter(stage, error, event) {
  try {
    const directory = path.join(path.dirname(databasePath()), "logs");
    mkdirSync(directory, { recursive: true });
    appendFileSync(path.join(directory, "reporter.jsonl"), `${JSON.stringify({
      at: new Date().toISOString(), stage, name: error?.name || "Error",
      message: String(error?.message || error).slice(0, 500),
      eventId: event?.eventId, runId: event?.runId,
      source: SOURCES.has(event?.source) ? event.source : undefined,
    })}\n`, "utf8");
  } catch {}
}

function exportMarkdown(database, event, projectId, runId) {
  const targetVault = vaultPath();
  if (!targetVault) return;
  const directory = path.join(targetVault, "Guild Activity");
  mkdirSync(directory, { recursive: true });
  const rows = database.prepare("SELECT agent, status, message, occurred_at FROM events WHERE run_id = ? AND project_id = ? ORDER BY occurred_at, id").all(runId, projectId);
  const fileName = `${event.occurredAt.slice(0, 10)}-${`${projectId}-${event.runId}`.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 64)}.md`;
  const lines = [
    "---",
    `project: ${JSON.stringify(event.projectName)}`,
    `project_path: ${JSON.stringify(event.projectPath)}`,
    `run_id: ${JSON.stringify(event.runId)}`,
    `status: ${event.status === "interrupted" ? "interrupted" : "complete"}`,
    `completed: ${event.occurredAt}`,
    "tags:",
    "  - lanternwatch",
    "  - agent-run",
    "---",
    "",
    `# ${event.quest}`,
    "",
    "## Activity",
    "",
    ...rows.map((row) => `- ${row.occurred_at} — **${companyTitleForAgent(row.agent) || row.agent}** · ${row.status}: ${row.message}`),
    "",
  ];
  writeFileSync(path.join(directory, fileName), lines.join("\n"), "utf8");
}

export function writeDirect(event) {
  event = normalizeEventAgentIds(event);
  const target = databasePath();
  mkdirSync(path.dirname(target), { recursive: true });
  const database = new DatabaseSync(target);
  ensureSchema(database);
  const receivedAt = new Date().toISOString();
  const projectId = createHash("sha256").update(event.projectPath.toLocaleLowerCase()).digest("hex").slice(0, 20);
  const runId = resolveRunStorageId(database, projectId, event.runId);
  if (event.heartbeat === true) {
    database.prepare("UPDATE runs SET updated_at = ? WHERE id = ? AND project_id = ? AND status = 'working'").run(new Date().toISOString(), runId, projectId);
    database.close();
    return;
  }
  const duplicate = database.prepare("SELECT 1 FROM events WHERE project_id = ? AND source_event_id = ?").get(projectId, event.eventId);
  if (duplicate) { database.close(); return; }
  const terminal = event.runComplete || event.status === "interrupted";
  const outcome = event.status === "interrupted" ? "interrupted" : terminal ? "complete" : null;
  database.exec("BEGIN IMMEDIATE");
  try {
    database.prepare("INSERT INTO projects (id, name, path, last_seen_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, path = excluded.path, last_seen_at = excluded.last_seen_at").run(projectId, event.projectName, event.projectPath, receivedAt);
    database.prepare("INSERT INTO runs (id, project_id, source_run_id, quest, status, started_at, completed_at, updated_at, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET quest = CASE WHEN excluded.quest <> '' THEN excluded.quest ELSE runs.quest END, status = CASE WHEN excluded.status = 'complete' THEN 'complete' ELSE runs.status END, completed_at = COALESCE(runs.completed_at, excluded.completed_at), updated_at = excluded.updated_at, outcome = COALESCE(excluded.outcome, runs.outcome)").run(runId, projectId, event.runId, event.quest, terminal ? "complete" : "working", event.occurredAt, terminal ? event.occurredAt : null, receivedAt, outcome);
    database.prepare("INSERT OR IGNORE INTO events (event_id, source_event_id, project_id, run_id, agent, status, message, quest, from_agent, occurred_at, received_at, agent_instance_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(scopedStorageId("event", projectId, event.eventId), event.eventId, projectId, runId, event.agent, event.status, event.message, event.quest, event.from || null, event.occurredAt, receivedAt, event.agentInstanceId || null);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    database.close();
    throw error;
  }
  if (terminal) {
    try {
      exportMarkdown(database, event, projectId, runId);
    } catch (exportError) {
      // Markdown export is optional. The lifecycle event is already committed,
      // so an unavailable vault must not make the reporter claim persistence
      // failed or trigger a duplicate fallback write.
      logReporter("export-failed", exportError, event);
    }
  }
  database.close();
}

export async function reportEvent(event) {
  event = normalizeEventAgentIds(event);
  let apiError;
  for (const delay of [0, 120, 300]) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      const response = await fetch(process.env.LANTERNWATCH_API_URL || DEFAULT_API, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(1200),
      });
      if (!response.ok) throw new Error(`API returned ${response.status}`);
      return "api";
    } catch (error) { apiError = error; }
  }
  try {
    logReporter("api-fallback", apiError, event);
    writeDirect(event);
    return "sqlite";
  } catch (sqliteError) {
    logReporter("sqlite-failed", sqliteError, event);
    throw sqliteError;
  }
}

export async function reportNotify(rawPayload) {
  return reportEvent(notifyEvent(parseNotifyPayload(rawPayload)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const event = args[0] === "--notify" ? notifyEvent(parseNotifyPayload(args[1])) : cliEvent(args);
  const destination = await reportEvent(event);
  if (!args.includes("--quiet")) console.log(`Lanternwatch event recorded via ${destination}.`);
}
