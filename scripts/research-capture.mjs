import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_RESEARCH_DATABASE = path.join(projectRoot, ".lanternwatch", "research.db");
const DEFAULT_RESEARCH_VAULT = String.raw`D:\VibeCoding\Vibe Coding\Wiki\Lanternwatch`;
const RESEARCH_ROLE_ALIASES = new Map([
  ["pathfinder", "technical-researcher"],
  ["technical-researcher", "technical-researcher"],
  ["courier", "market-intelligence-analyst"],
  ["market-intelligence-analyst", "market-intelligence-analyst"],
]);
const RESEARCH_SCHEMA_VERSION = 2;
const STATUSES = new Set(["complete", "incomplete"]);

export function researchCapturePaths(environment = process.env) {
  return {
    databasePath: path.resolve(
      environment.LANTERNWATCH_RESEARCH_DB_PATH?.trim() || DEFAULT_RESEARCH_DATABASE,
    ),
    vaultPath: path.resolve(
      environment.LANTERNWATCH_RESEARCH_VAULT_PATH?.trim() || DEFAULT_RESEARCH_VAULT,
    ),
  };
}

function requiredText(value, field, maximum = 8_000) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  const result = value.trim();
  if (result.length > maximum) throw new RangeError(`${field} exceeds ${maximum} characters`);
  if (/\0|[\u0001-\u0008\u000B\u000C\u000E-\u001F]/u.test(result)) {
    throw new TypeError(`${field} contains control characters`);
  }
  return result;
}

function optionalText(value, field, maximum = 8_000) {
  if (value === undefined || value === null || value === "") return "";
  return requiredText(value, field, maximum);
}

function isoTimestamp(value, field, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.valueOf())) throw new TypeError(`${field} must be a valid timestamp`);
  return timestamp.toISOString();
}

function isPrivateIpv4(hostname) {
  const octets = hostname.split(".").map(Number);
  const [a, b] = octets;
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || a >= 224;
}

function isPrivateIpv6(hostname) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return host === "::"
    || host === "::1"
    || host.startsWith("fc")
    || host.startsWith("fd")
    || /^fe[89ab]/u.test(host)
    || host.startsWith("ff")
    || host.startsWith("2001:db8:")
    || host.startsWith("::ffff:");
}

export function publicSourceUrl(value) {
  const raw = requiredText(value, "source.url", 2_048);
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new TypeError("source.url must be an absolute public HTTP(S) URL");
  }
  if (!new Set(["http:", "https:"]).has(url.protocol) || url.username || url.password) {
    throw new TypeError("source.url must be an unauthenticated public HTTP(S) URL");
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/u, "");
  if (!hostname
    || hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname.endsWith(".local")
    || hostname.endsWith(".internal")
    || hostname.endsWith(".lan")
    || (!hostname.includes(".") && net.isIP(hostname) === 0)) {
    throw new TypeError("source.url must not reference a local or private host");
  }
  const family = net.isIP(hostname.replace(/^\[|\]$/g, ""));
  if ((family === 4 && isPrivateIpv4(hostname)) || (family === 6 && isPrivateIpv6(hostname))) {
    throw new TypeError("source.url must not reference a local or private address");
  }
  url.hash = "";
  return url.toString();
}

function normalizeStringList(value, field, maximum = 4_000) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new TypeError(`${field} must be an array`);
  return value.map((entry, index) => requiredText(entry, `${field}[${index}]`, maximum));
}

function normalizeFindings(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new TypeError("findings must be an array");
  return value.map((finding, index) => {
    if (typeof finding === "string") {
      return { claim: requiredText(finding, `findings[${index}]`, 4_000), citations: [] };
    }
    if (!finding || typeof finding !== "object" || Array.isArray(finding)) {
      throw new TypeError(`findings[${index}] must be a string or object`);
    }
    const citations = finding.citations === undefined
      ? []
      : normalizeStringList(finding.citations, `findings[${index}].citations`, 2_048)
        .map(publicSourceUrl);
    return {
      claim: requiredText(finding.claim, `findings[${index}].claim`, 4_000),
      citations,
    };
  });
}

function normalizeSources(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new TypeError("sources must be an array");
  const seen = new Set();
  return value.map((source, index) => {
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      throw new TypeError(`sources[${index}] must be an object`);
    }
    const url = publicSourceUrl(source.url);
    if (seen.has(url)) throw new TypeError(`sources[${index}].url duplicates another source`);
    seen.add(url);
    return {
      url,
      title: optionalText(source.title, `sources[${index}].title`, 500),
      publisher: optionalText(source.publisher, `sources[${index}].publisher`, 300),
      publishedAt: isoTimestamp(source.publishedAt, `sources[${index}].publishedAt`, null),
      accessedAt: isoTimestamp(source.accessedAt, `sources[${index}].accessedAt`, null),
      excerpt: optionalText(source.excerpt, `sources[${index}].excerpt`, 1_000),
    };
  });
}

function slug(value, fallback, maximum) {
  const result = value.normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, maximum)
    .replace(/-$/u, "");
  return result || fallback;
}

function deterministicFilename(record) {
  const date = record.completedAt.slice(0, 10);
  const digest = createHash("sha256").update(record.taskId).digest("hex").slice(0, 10);
  return `${date}-${slug(record.topic, "research", 60)}-${slug(record.taskId, "task", 32)}-${digest}.md`;
}

export function normalizeResearchRecord(input, now = new Date()) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("research payload must be an object");
  }
  const suppliedRole = requiredText(input.role, "role", 64).toLowerCase();
  const role = RESEARCH_ROLE_ALIASES.get(suppliedRole);
  if (!role) {
    throw new TypeError("role must be technical-researcher or market-intelligence-analyst");
  }
  const status = requiredText(input.status, "status", 32).toLowerCase();
  if (!STATUSES.has(status)) throw new TypeError("status must be complete or incomplete");
  const capturedAt = now.toISOString();
  const record = {
    taskId: requiredText(input.taskId, "taskId", 200),
    role,
    topic: requiredText(input.topic, "topic", 300),
    question: requiredText(input.question, "question", 4_000),
    status,
    summary: requiredText(input.summary, "summary", 8_000),
    findings: normalizeFindings(input.findings),
    caveats: normalizeStringList(input.caveats, "caveats", 4_000),
    sources: normalizeSources(input.sources),
    startedAt: isoTimestamp(input.startedAt, "startedAt", null),
    completedAt: isoTimestamp(input.completedAt, "completedAt", capturedAt),
    capturedAt,
  };
  if (record.status === "complete" && record.sources.length === 0) {
    throw new TypeError("complete research must include at least one public source");
  }
  record.noteFilename = deterministicFilename(record);
  return record;
}

function openResearchDatabase(databasePath) {
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;");
  migrateResearchDatabase(database);
  return database;
}

export function migrateResearchDatabase(database) {
  database.exec("PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE;");
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS research_schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS research_records (
        id INTEGER PRIMARY KEY,
        task_id TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL CHECK (role IN ('technical-researcher', 'market-intelligence-analyst')),
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
        export_status TEXT NOT NULL DEFAULT 'pending'
          CHECK (export_status IN ('pending', 'exported', 'failed')),
        export_error TEXT,
        exported_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    const roleConstraint = database.prepare(`
      SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'research_records'
    `).get()?.sql || "";
    if (roleConstraint.includes("'pathfinder'") || roleConstraint.includes("'courier'")) {
      database.exec(`
        CREATE TABLE research_records_v2 (
          id INTEGER PRIMARY KEY,
          task_id TEXT NOT NULL UNIQUE,
          role TEXT NOT NULL CHECK (role IN ('technical-researcher', 'market-intelligence-analyst')),
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
          export_status TEXT NOT NULL DEFAULT 'pending'
            CHECK (export_status IN ('pending', 'exported', 'failed')),
          export_error TEXT,
          exported_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO research_records_v2 (
          id, task_id, role, topic, question, status, summary, findings_json,
          caveats_json, started_at, completed_at, captured_at, note_filename,
          export_status, export_error, exported_at, created_at, updated_at
        )
        SELECT
          id,
          task_id,
          CASE role
            WHEN 'pathfinder' THEN 'technical-researcher'
            WHEN 'courier' THEN 'market-intelligence-analyst'
            ELSE role
          END,
          topic, question, status, summary, findings_json, caveats_json,
          started_at, completed_at, captured_at, note_filename, export_status,
          export_error, exported_at, created_at, updated_at
        FROM research_records;
        DROP TABLE research_records;
        ALTER TABLE research_records_v2 RENAME TO research_records;
      `);
    }

    database.exec(`
      UPDATE research_records
      SET role = CASE role
        WHEN 'pathfinder' THEN 'technical-researcher'
        WHEN 'courier' THEN 'market-intelligence-analyst'
        ELSE role
      END
      WHERE role IN ('pathfinder', 'courier');
      CREATE TABLE IF NOT EXISTS research_sources (
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
      CREATE INDEX IF NOT EXISTS research_records_export_status_idx
        ON research_records(export_status, captured_at);
      CREATE INDEX IF NOT EXISTS research_sources_research_id_idx
        ON research_sources(research_id);
    `);
    database.prepare(`
      INSERT OR IGNORE INTO research_schema_migrations (version, applied_at)
      VALUES (?, ?)
    `).run(RESEARCH_SCHEMA_VERSION, new Date().toISOString());
    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  } finally {
    database.exec("PRAGMA foreign_keys = ON;");
  }
}

function insertRecord(database, record) {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = database.prepare(`
      INSERT OR IGNORE INTO research_records (
        task_id, role, topic, question, status, summary, findings_json,
        caveats_json, started_at, completed_at, captured_at, note_filename,
        export_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(
      record.taskId,
      record.role,
      record.topic,
      record.question,
      record.status,
      record.summary,
      JSON.stringify(record.findings),
      JSON.stringify(record.caveats),
      record.startedAt,
      record.completedAt,
      record.capturedAt,
      record.noteFilename,
      record.capturedAt,
      record.capturedAt,
    );
    const row = database.prepare("SELECT id FROM research_records WHERE task_id = ?").get(record.taskId);
    if (result.changes === 1) {
      const insertSource = database.prepare(`
        INSERT INTO research_sources (
          research_id, url, title, publisher, published_at, accessed_at, excerpt
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const source of record.sources) {
        insertSource.run(
          row.id,
          source.url,
          source.title,
          source.publisher,
          source.publishedAt,
          source.accessedAt,
          source.excerpt,
        );
      }
    }
    database.exec("COMMIT");
    return { id: row.id, created: result.changes === 1 };
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function authoritativeCaptureResult(databasePath, taskId) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    database.exec("PRAGMA busy_timeout = 5000;");
    const row = database.prepare(`
      SELECT note_filename, export_status, export_error
      FROM research_records
      WHERE task_id = ?
    `).get(taskId);
    if (!row) throw new Error("authoritative research record was not found after capture");
    return row;
  } finally {
    database.close();
  }
}

function yamlString(value) {
  return JSON.stringify(value ?? "");
}

function markdownText(value) {
  return String(value).replace(/\r\n?/gu, "\n");
}

function sourceLabel(source) {
  return source.title || source.publisher || new URL(source.url).hostname;
}

export function renderResearchMarkdown(record, sources) {
  const findings = JSON.parse(record.findings_json);
  const caveats = JSON.parse(record.caveats_json);
  const lines = [
    "---",
    "lanternwatch: research",
    `task_id: ${yamlString(record.task_id)}`,
    `role: ${yamlString(record.role)}`,
    `topic: ${yamlString(record.topic)}`,
    `status: ${yamlString(record.status)}`,
    `started_at: ${record.started_at ? yamlString(record.started_at) : "null"}`,
    `completed_at: ${yamlString(record.completed_at)}`,
    `captured_at: ${yamlString(record.captured_at)}`,
    `source_count: ${sources.length}`,
    "tags:",
    "  - lanternwatch",
    "  - research",
    `  - ${record.role}`,
    "---",
    "",
    `# ${markdownText(record.topic)}`,
    "",
  ];
  if (record.status === "incomplete") {
    lines.push("> [!warning] Incomplete research", "> This note preserves partial findings and unresolved work.", "");
  }
  lines.push(
    "## Research question",
    "",
    markdownText(record.question),
    "",
    "## Executive summary",
    "",
    markdownText(record.summary),
    "",
    "## Verified findings",
    "",
  );
  if (findings.length === 0) lines.push("_No verified findings were available._");
  for (const [index, finding] of findings.entries()) {
    const citations = finding.citations.length
      ? ` ${finding.citations.map((url, citationIndex) => `[[${index + 1}.${citationIndex + 1}]](${url})`).join(" ")}`
      : "";
    lines.push(`${index + 1}. ${markdownText(finding.claim)}${citations}`);
  }
  lines.push("", "## Caveats and unresolved questions", "");
  if (caveats.length === 0) lines.push("_None recorded._");
  for (const caveat of caveats) lines.push(`- ${markdownText(caveat)}`);
  lines.push("", "## Sources", "");
  if (sources.length === 0) lines.push("_No public sources were available for this incomplete investigation._");
  for (const source of sources) {
    const details = [source.publisher, source.published_at && `published ${source.published_at}`, source.accessed_at && `accessed ${source.accessed_at}`]
      .filter(Boolean)
      .join("; ");
    lines.push(`- [${markdownText(sourceLabel(source))}](${source.url})${details ? ` — ${details}` : ""}`);
    if (source.excerpt) {
      for (const excerptLine of markdownText(source.excerpt).split("\n")) lines.push(`  > ${excerptLine}`);
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function safeExportError(error) {
  const name = typeof error?.name === "string" ? error.name.replace(/[^A-Za-z0-9._-]/gu, "") : "Error";
  const code = typeof error?.code === "string" ? error.code.replace(/[^A-Za-z0-9._-]/gu, "") : "EXPORT_FAILED";
  return `${name}:${code}: Obsidian note export failed`;
}

function writeNoteAtomically(vaultPath, filename, contents) {
  mkdirSync(vaultPath, { recursive: true });
  const destination = path.join(vaultPath, filename);
  if (existsSync(destination)) return destination;
  const temporary = path.join(
    vaultPath,
    `.${filename}.${process.pid}.${createHash("sha256").update(`${Date.now()}-${Math.random()}`).digest("hex").slice(0, 8)}.tmp`,
  );
  try {
    writeFileSync(temporary, contents, { encoding: "utf8", flag: "wx" });
    try {
      renameSync(temporary, destination);
    } catch (error) {
      if (!existsSync(destination)) throw error;
      rmSync(temporary, { force: true });
    }
    return destination;
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

function pendingRows(database) {
  return database.prepare(`
    SELECT * FROM research_records
    WHERE export_status IN ('pending', 'failed')
    ORDER BY captured_at, id
  `).all();
}

export function retryResearchExports(options = {}) {
  const paths = {
    ...researchCapturePaths(options.environment),
    ...(options.databasePath ? { databasePath: path.resolve(options.databasePath) } : {}),
    ...(options.vaultPath ? { vaultPath: path.resolve(options.vaultPath) } : {}),
  };
  const database = openResearchDatabase(paths.databasePath);
  const results = [];
  try {
    for (const record of pendingRows(database)) {
      const sources = database.prepare(`
        SELECT url, title, publisher, published_at, accessed_at, excerpt
        FROM research_sources WHERE research_id = ? ORDER BY id
      `).all(record.id);
      try {
        writeNoteAtomically(paths.vaultPath, record.note_filename, renderResearchMarkdown(record, sources));
        const exportedAt = new Date().toISOString();
        database.prepare(`
          UPDATE research_records
          SET export_status = 'exported', export_error = NULL, exported_at = ?, updated_at = ?
          WHERE id = ?
        `).run(exportedAt, exportedAt, record.id);
        results.push({ taskId: record.task_id, status: "exported", noteFilename: record.note_filename });
      } catch (error) {
        const exportError = safeExportError(error);
        database.prepare(`
          UPDATE research_records
          SET export_status = 'failed', export_error = ?, updated_at = ?
          WHERE id = ?
        `).run(exportError, new Date().toISOString(), record.id);
        results.push({ taskId: record.task_id, status: "failed", error: exportError });
      }
    }
    return results;
  } finally {
    database.close();
  }
}

export function captureResearch(input, options = {}) {
  const paths = {
    ...researchCapturePaths(options.environment),
    ...(options.databasePath ? { databasePath: path.resolve(options.databasePath) } : {}),
    ...(options.vaultPath ? { vaultPath: path.resolve(options.vaultPath) } : {}),
  };
  const record = normalizeResearchRecord(input, options.now || new Date());
  const database = openResearchDatabase(paths.databasePath);
  let inserted;
  try {
    inserted = insertRecord(database, record);
  } finally {
    database.close();
  }
  const retries = retryResearchExports(paths);
  const authoritative = authoritativeCaptureResult(paths.databasePath, record.taskId);
  if (authoritative.export_status === "failed") {
    process.stderr.write(`Lanternwatch research export warning (${authoritative.export_error}).\n`);
  }
  return {
    taskId: record.taskId,
    created: inserted.created,
    exportStatus: authoritative.export_status,
    noteFilename: authoritative.note_filename,
    retried: retries.length,
  };
}

function argumentValue(argumentsList, flag) {
  const index = argumentsList.indexOf(flag);
  return index === -1 ? undefined : argumentsList[index + 1];
}

function readCaptureInput(argumentsList) {
  const inputPath = argumentValue(argumentsList, "--file");
  const raw = inputPath ? readFileSync(path.resolve(inputPath), "utf8") : readFileSync(0, "utf8");
  return JSON.parse(raw);
}

export function runResearchCaptureCli(argumentsList = process.argv.slice(2), environment = process.env) {
  const command = argumentsList[0] || "capture";
  const options = {
    environment,
    databasePath: argumentValue(argumentsList, "--database"),
    vaultPath: argumentValue(argumentsList, "--vault"),
  };
  if (command === "capture") {
    const result = captureResearch(readCaptureInput(argumentsList), options);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result;
  }
  if (command === "retry") {
    const results = retryResearchExports(options);
    const summary = {
      retried: results.length,
      exported: results.filter((result) => result.status === "exported").length,
      failed: results.filter((result) => result.status === "failed").length,
    };
    for (const result of results.filter((item) => item.status === "failed")) {
      process.stderr.write(`Lanternwatch research export warning (${result.error}).\n`);
    }
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    return summary;
  }
  throw new TypeError("command must be capture or retry");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runResearchCaptureCli();
  } catch (error) {
    const name = typeof error?.name === "string" ? error.name : "Error";
    const code = typeof error?.code === "string" ? `:${error.code}` : "";
    process.stderr.write(`Lanternwatch research capture rejected (${name}${code}).\n`);
    process.exitCode = 1;
  }
}
