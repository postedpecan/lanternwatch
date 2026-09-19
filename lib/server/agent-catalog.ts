import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { CatalogAction, CatalogAgent, CatalogSettings } from "@/lib/guild-contract";

export type { CatalogAction } from "@/lib/guild-contract";

type CatalogDependencies = {
  database: DatabaseSync;
  storageRoot: string;
  allowedWorkspacePaths: string[];
};

const DEFAULT_SETTINGS: CatalogSettings = { discoveryMode: "manual", collisionPolicy: "rename", lastScannedAt: null };
const LANTERNWATCH_MARKER = /Lanternwatch[\\/]Agents[\\/]|Lanternwatch Company Team|From the repository root, read AGENTS\.md, Agents[\\/].*-agent\.md/iu;
const NAME_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;

function now() { return new Date().toISOString(); }
function normalizedPath(value: string) { return path.resolve(value); }
function keyFor(value: string) { return createHash("sha256").update(value.toLocaleLowerCase()).digest("hex").slice(0, 32); }
function globalDirectory() { return path.join(process.env.CODEX_HOME || path.join(homedir(), ".codex"), "agents"); }
function workspaceDirectory(workspacePath: string) { return path.join(workspacePath, ".codex", "agents"); }
function disabledDirectory(storageRoot: string) { return path.join(storageRoot, "disabled-agents"); }
function snapshotKey(storageRoot: string, workspaceRoots: string[]) { return keyFor(`${storageRoot}\0${workspaceRoots.slice().sort().join("\0")}`); }

function sanitizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((tag): tag is string => typeof tag === "string")
    .map((tag) => tag.trim().replace(/\s+/g, " ").slice(0, 32)).filter(Boolean))].slice(0, 12);
}

function readMetadata(database: DatabaseSync, sourcePath: string) {
  const row = database.prepare("SELECT tags_json, disabled_path FROM agent_catalog_metadata WHERE source_path = ?").get(sourcePath) as { tags_json: string; disabled_path: string | null } | undefined;
  let tags: string[] = [];
  try { tags = sanitizeTags(row ? JSON.parse(row.tags_json) : []); } catch {}
  return { tags, disabledPath: row?.disabled_path ?? null };
}

function writeMetadata(database: DatabaseSync, sourcePath: string, tags: string[], disabledPath: string | null) {
  database.prepare(`
    INSERT INTO agent_catalog_metadata(source_path, tags_json, disabled_path, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(source_path) DO UPDATE SET tags_json = excluded.tags_json, disabled_path = excluded.disabled_path, updated_at = excluded.updated_at
  `).run(sourcePath, JSON.stringify(sanitizeTags(tags)), disabledPath, now());
}

function parseToml(source: string, sourcePath: string) {
  const field = (name: string) => new RegExp(`^\\s*${name}\\s*=\\s*"([^"]*)"\\s*$`, "m").exec(source)?.[1]
    ?? new RegExp(`^\\s*${name}\\s*=\\s*"""\\n?([\\s\\S]*?)"""\\s*$`, "m").exec(source)?.[1];
  const name = field("name")?.trim();
  const description = field("description")?.trim();
  const developerInstructions = field("developer_instructions")?.trim();
  if (!name || !description || !developerInstructions || !NAME_PATTERN.test(name)) throw new Error(`Invalid Codex agent definition: ${sourcePath}`);
  return { name, description, developerInstructions };
}

function tomlString(value: string) { return JSON.stringify(value); }
function agentToml(name: string, description: string, developerInstructions: string) {
  return `name = ${tomlString(name)}\ndescription = ${tomlString(description)}\ndeveloper_instructions = ${tomlString(developerInstructions)}\n`;
}

function safeFile(pathname: string) {
  try { return lstatSync(pathname).isFile() && !lstatSync(pathname).isSymbolicLink(); } catch { return false; }
}

function catalogAgent(sourcePath: string, parsed: ReturnType<typeof parseToml>, scope: "global" | "workspace", enabled: boolean, tags: string[], lanternwatch: boolean): CatalogAgent {
  return {
    id: keyFor(sourcePath),
    sourcePath,
    name: parsed.name,
    description: parsed.description,
    scope: lanternwatch ? "lanternwatch" : scope,
    enabled,
    tags: lanternwatch ? sanitizeTags(["LanternWatch", scope, ...tags]) : tags,
    collision: false,
    readOnly: lanternwatch,
    codexReady: true,
  };
}

function discoverDirectory(database: DatabaseSync, directory: string, scope: "global" | "workspace", storageRoot: string): CatalogAgent[] {
  const agents: CatalogAgent[] = [];
  if (existsSync(directory)) {
    for (const entry of readdirSync(directory).filter((name) => name.endsWith(".toml")).sort()) {
      const sourcePath = normalizedPath(path.join(directory, entry));
      if (!safeFile(sourcePath)) continue;
      try {
        const source = readFileSync(sourcePath, "utf8");
        const parsed = parseToml(source, sourcePath);
        const metadata = readMetadata(database, sourcePath);
        agents.push(catalogAgent(sourcePath, parsed, scope, true, metadata.tags, LANTERNWATCH_MARKER.test(source)));
      } catch { /* One malformed local file must not break the catalog. */ }
    }
  }
  const disabledRoot = disabledDirectory(storageRoot);
  if (existsSync(disabledRoot)) {
    for (const entry of readdirSync(disabledRoot).filter((name) => name.endsWith(".toml")).sort()) {
      const disabledPath = path.join(disabledRoot, entry);
      if (!safeFile(disabledPath)) continue;
      const metadataRow = database.prepare("SELECT source_path, tags_json FROM agent_catalog_metadata WHERE disabled_path = ?").get(disabledPath) as { source_path: string; tags_json: string } | undefined;
      if (!metadataRow || path.dirname(normalizedPath(metadataRow.source_path)) !== normalizedPath(directory)) continue;
      try {
        const source = readFileSync(disabledPath, "utf8");
        const parsed = parseToml(source, disabledPath);
        let tags: string[] = [];
        try { tags = sanitizeTags(JSON.parse(metadataRow.tags_json)); } catch {}
        agents.push(catalogAgent(normalizedPath(metadataRow.source_path), parsed, scope, false, tags, LANTERNWATCH_MARKER.test(source)));
      } catch {}
    }
  }
  return agents;
}

function discoverExternal(database: DatabaseSync): CatalogAgent[] {
  const rows = database.prepare("SELECT source_path FROM agent_catalog_external ORDER BY source_path").all() as Array<{ source_path: string }>;
  const agents: CatalogAgent[] = [];
  for (const row of rows) {
    const sourcePath = normalizedPath(row.source_path);
    if (!safeFile(sourcePath)) continue;
    try {
      const source = readFileSync(sourcePath, "utf8");
      const parsed = parseToml(source, sourcePath);
      const metadata = readMetadata(database, sourcePath);
      agents.push({ id: keyFor(sourcePath), sourcePath, name: parsed.name, description: parsed.description, scope: "external", enabled: true, tags: metadata.tags, collision: false, readOnly: true, codexReady: false });
    } catch { /* A registered source may be removed or invalidated outside LanternWatch. */ }
  }
  return agents;
}

function markCollisions(agents: CatalogAgent[]) {
  const names = new Map<string, number>();
  for (const agent of agents.filter((agent) => agent.codexReady && agent.enabled)) names.set(agent.name.toLowerCase(), (names.get(agent.name.toLowerCase()) ?? 0) + 1);
  for (const agent of agents) agent.collision = agent.codexReady && agent.enabled && (names.get(agent.name.toLowerCase()) ?? 0) > 1;
  return agents;
}

function validSnapshot(value: unknown): CatalogAgent[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const agent = candidate as Partial<CatalogAgent>;
    if (typeof agent.id !== "string" || typeof agent.name !== "string" || typeof agent.description !== "string" || typeof agent.sourcePath !== "string") return [];
    if (!["global", "workspace", "external", "lanternwatch"].includes(String(agent.scope))) return [];
    return [{ id: agent.id, name: agent.name, description: agent.description, sourcePath: agent.sourcePath, scope: agent.scope as CatalogAgent["scope"], enabled: Boolean(agent.enabled), tags: sanitizeTags(agent.tags), collision: Boolean(agent.collision), readOnly: Boolean(agent.readOnly), codexReady: Boolean(agent.codexReady) }];
  });
}

export function ensureCatalogSchema(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS agent_catalog_metadata (
      source_path TEXT PRIMARY KEY,
      tags_json TEXT NOT NULL DEFAULT '[]',
      disabled_path TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_catalog_settings (
      setting_key TEXT PRIMARY KEY,
      setting_value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_catalog_snapshot (
      cache_key TEXT PRIMARY KEY,
      agents_json TEXT NOT NULL,
      scanned_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_catalog_external (
      source_path TEXT PRIMARY KEY,
      registered_at TEXT NOT NULL
    );
  `);
}

function settings(database: DatabaseSync): CatalogSettings {
  const rows = database.prepare("SELECT setting_key, setting_value FROM agent_catalog_settings").all() as Array<{ setting_key: string; setting_value: string }>;
  const value = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    if (row.setting_key === "discoveryMode" && ["manual", "automatic-once"].includes(row.setting_value)) value.discoveryMode = row.setting_value as CatalogSettings["discoveryMode"];
    if (row.setting_key === "discoveryMode" && ["automatic", "watcher"].includes(row.setting_value)) value.discoveryMode = "manual";
    if (row.setting_key === "collisionPolicy" && ["rename", "tag", "disable"].includes(row.setting_value)) value.collisionPolicy = row.setting_value as CatalogSettings["collisionPolicy"];
    if (row.setting_key === "lastScannedAt" && !Number.isNaN(Date.parse(row.setting_value))) value.lastScannedAt = row.setting_value;
  }
  return value;
}

function writeSetting(database: DatabaseSync, key: string, value: string) {
  database.prepare("INSERT INTO agent_catalog_settings(setting_key, setting_value, updated_at) VALUES (?, ?, ?) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = excluded.updated_at").run(key, value, now());
}

function scanCurrent({ database, storageRoot, allowedWorkspacePaths }: CatalogDependencies) {
  const workspaceRoots = [...new Set(allowedWorkspacePaths.map(normalizedPath))];
  return markCollisions([
    ...discoverDirectory(database, globalDirectory(), "global", storageRoot),
    ...workspaceRoots.flatMap((root) => discoverDirectory(database, workspaceDirectory(root), "workspace", storageRoot)),
    ...discoverExternal(database),
  ]).sort((a, b) => a.name.localeCompare(b.name) || a.scope.localeCompare(b.scope) || a.sourcePath.localeCompare(b.sourcePath));
}

function scanAndStore({ database, storageRoot, allowedWorkspacePaths }: CatalogDependencies) {
  const workspaceRoots = [...new Set(allowedWorkspacePaths.map(normalizedPath))];
  const agents = scanCurrent({ database, storageRoot, allowedWorkspacePaths });
  const scannedAt = now();
  database.prepare("INSERT INTO agent_catalog_snapshot(cache_key, agents_json, scanned_at) VALUES (?, ?, ?) ON CONFLICT(cache_key) DO UPDATE SET agents_json = excluded.agents_json, scanned_at = excluded.scanned_at").run(snapshotKey(storageRoot, workspaceRoots), JSON.stringify(agents), scannedAt);
  writeSetting(database, "lastScannedAt", scannedAt);
  return { agents, settings: { ...settings(database), lastScannedAt: scannedAt } };
}

export function getCatalog({ database, storageRoot, allowedWorkspacePaths }: CatalogDependencies): { agents: CatalogAgent[]; settings: CatalogSettings } {
  ensureCatalogSchema(database);
  const workspaceRoots = [...new Set(allowedWorkspacePaths.map(normalizedPath))];
  const snapshot = database.prepare("SELECT agents_json FROM agent_catalog_snapshot WHERE cache_key = ?").get(snapshotKey(storageRoot, workspaceRoots)) as { agents_json: string } | undefined;
  let agents: CatalogAgent[] = [];
  try { agents = validSnapshot(snapshot ? JSON.parse(snapshot.agents_json) : []); } catch {}
  return { agents, settings: settings(database) };
}

function assertWorkspace(allowed: string[], workspacePath: string | undefined) {
  if (!workspacePath) throw new Error("Choose a workspace destination.");
  const target = normalizedPath(workspacePath);
  if (!allowed.map(normalizedPath).includes(target)) throw new Error("That workspace is not available in LanternWatch.");
  return target;
}

function assertName(value: string) {
  const name = value.trim();
  if (!NAME_PATTERN.test(name)) throw new Error("Agent names must use lowercase letters, numbers, hyphens, or underscores.");
  return name;
}

function atomicWrite(target: string, content: string) {
  mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  writeFileSync(temporary, content, "utf8");
  renameSync(temporary, target);
}

function backupAgent(source: string, storageRoot: string, originalPath: string) {
  const directory = path.join(storageRoot, "agent-backups");
  mkdirSync(directory, { recursive: true });
  copyFileSync(source, path.join(directory, `${keyFor(originalPath)}-${Date.now()}.toml`));
}

function sourceScope(sourcePath: string, allowedWorkspacePaths: string[]) {
  if (path.dirname(sourcePath) === normalizedPath(globalDirectory())) return "global" as const;
  if (allowedWorkspacePaths.some((workspace) => path.dirname(sourcePath) === normalizedPath(workspaceDirectory(workspace)))) return "workspace" as const;
  throw new Error("That agent is not in a managed Codex directory.");
}

function isManagedSource(sourcePath: string, allowedWorkspacePaths: string[]) {
  return path.dirname(sourcePath) === normalizedPath(globalDirectory())
    || allowedWorkspacePaths.some((workspace) => path.dirname(sourcePath) === normalizedPath(workspaceDirectory(workspace)));
}

function assertManagedUserAgent(sourcePath: string, allowedWorkspacePaths: string[]) {
  sourceScope(sourcePath, allowedWorkspacePaths);
  if (safeFile(sourcePath) && LANTERNWATCH_MARKER.test(readFileSync(sourcePath, "utf8"))) throw new Error("LanternWatch definitions are read-only in this catalog.");
}

function assertRegisteredExternal(database: DatabaseSync, sourcePath: string) {
  const row = database.prepare("SELECT source_path FROM agent_catalog_external WHERE source_path = ?").get(sourcePath) as { source_path: string } | undefined;
  if (!row) throw new Error("Register this external TOML before adding it to Codex.");
  if (!safeFile(sourcePath)) throw new Error("The registered TOML is unavailable.");
  return parseToml(readFileSync(sourcePath, "utf8"), sourcePath);
}

const DEFAULT_DUPLICATE_SOURCE_TAG = "duplicate-source";

function assertCollisionTarget(dependencies: CatalogDependencies, sourcePath: string) {
  const agents = scanCurrent(dependencies);
  const target = agents.find((agent) => agent.sourcePath === sourcePath);
  if (!target) throw new Error("Refresh agents and choose an unresolved workspace definition.");
  if (target.readOnly || target.scope === "lanternwatch") throw new Error("LanternWatch definitions are read-only in this catalog.");
  if (target.scope !== "workspace") throw new Error("Resolve duplicate sources from a user-owned workspace definition.");
  if (!target.enabled || !target.codexReady || !target.collision) throw new Error("That agent does not have an unresolved same-name Codex collision.");
  const candidates = agents.filter((agent) => agent.enabled && agent.codexReady && agent.name.toLowerCase() === target.name.toLowerCase());
  if (candidates.length !== 2) throw new Error("Resolve exactly two same-name Codex definitions at a time.");
  assertManagedUserAgent(sourcePath, dependencies.allowedWorkspacePaths);
  return { target, agents };
}

function withCatalogTransaction<T>(database: DatabaseSync, work: () => T) {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch { /* The transaction may not have started. */ }
    throw error;
  }
}

function resolveCollision(dependencies: CatalogDependencies, action: Extract<CatalogAction, { action: "resolve-collision" }>) {
  const { database, storageRoot } = dependencies;
  const sourcePath = normalizedPath(action.sourcePath);
  const { agents } = assertCollisionTarget(dependencies, sourcePath);
  const metadata = readMetadata(database, sourcePath);

  if (action.resolution === "tag") {
    const additions = sanitizeTags(action.tags);
    const tags = sanitizeTags([...metadata.tags, ...(additions.length ? additions : [DEFAULT_DUPLICATE_SOURCE_TAG])]);
    return withCatalogTransaction(database, () => {
      writeMetadata(database, sourcePath, tags, metadata.disabledPath);
      return scanAndStore(dependencies);
    });
  }

  if (action.resolution === "disable") {
    const destination = path.join(disabledDirectory(storageRoot), `${keyFor(sourcePath)}.toml`);
    if (!safeFile(sourcePath)) throw new Error("The agent file is unavailable for disabling.");
    if (existsSync(destination)) throw new Error("A disabled copy already exists; restore it before disabling again.");
    let moved = false;
    try {
      return withCatalogTransaction(database, () => {
        mkdirSync(path.dirname(destination), { recursive: true });
        renameSync(sourcePath, destination);
        moved = true;
        writeMetadata(database, sourcePath, metadata.tags, destination);
        return scanAndStore(dependencies);
      });
    } catch (error) {
      if (moved && safeFile(destination) && !existsSync(sourcePath)) {
        try { renameSync(destination, sourcePath); } catch { /* Preserve the recoverable disabled copy if rollback cannot move it. */ }
      }
      throw error;
    }
  }

  if (action.resolution !== "rename") throw new Error("Choose tag, rename, or disable to resolve the duplicate source.");
  const nextName = assertName(action.name ?? "");
  const currentName = agents.find((agent) => agent.sourcePath === sourcePath)?.name;
  if (!currentName || nextName.toLowerCase() === currentName.toLowerCase()) {
    throw new Error("Choose a different name to resolve this duplicate source.");
  }
  if (agents.some((agent) => agent.sourcePath !== sourcePath && agent.enabled && agent.codexReady && agent.name.toLowerCase() === nextName.toLowerCase())) {
    throw new Error("That name would still collide with an enabled Codex definition.");
  }
  if (!safeFile(sourcePath)) throw new Error("The agent file is unavailable for renaming.");
  const parsed = parseToml(readFileSync(sourcePath, "utf8"), sourcePath);
  const originalSource = readFileSync(sourcePath, "utf8");
  const nextSource = path.join(path.dirname(sourcePath), `${nextName}.toml`);
  if (nextSource !== sourcePath && existsSync(nextSource)) throw new Error("An agent with that name already exists in this location.");
  let moved = false;
  let rewritten = false;
  try {
    return withCatalogTransaction(database, () => {
      backupAgent(sourcePath, storageRoot, sourcePath);
      if (nextSource !== sourcePath) {
        renameSync(sourcePath, nextSource);
        moved = true;
      }
      atomicWrite(nextSource, agentToml(nextName, parsed.description, parsed.developerInstructions));
      rewritten = true;
      if (nextSource !== sourcePath) {
        database.prepare("DELETE FROM agent_catalog_metadata WHERE source_path = ?").run(sourcePath);
        writeMetadata(database, nextSource, metadata.tags, null);
      }
      return scanAndStore(dependencies);
    });
  } catch (error) {
    if (rewritten && safeFile(nextSource)) {
      try { atomicWrite(nextSource, originalSource); } catch { /* Keep the backup if filesystem rollback fails. */ }
    }
    if (moved && safeFile(nextSource) && !existsSync(sourcePath)) {
      try { renameSync(nextSource, sourcePath); } catch { /* Keep the backup if filesystem rollback fails. */ }
    }
    throw error;
  }
}

export function applyCatalogAction(dependencies: CatalogDependencies, action: CatalogAction) {
  const { database, storageRoot, allowedWorkspacePaths } = dependencies;
  ensureCatalogSchema(database);
  if (action.action === "scan") return scanAndStore(dependencies);
  if (action.action === "settings") {
    const next = { ...settings(database), ...action.settings };
    if (!["manual", "automatic-once"].includes(next.discoveryMode) || !["rename", "tag", "disable"].includes(next.collisionPolicy)) throw new Error("Invalid catalog setting.");
    writeSetting(database, "discoveryMode", next.discoveryMode);
    writeSetting(database, "collisionPolicy", next.collisionPolicy);
    return next.discoveryMode === "automatic-once" ? scanAndStore(dependencies) : getCatalog(dependencies);
  }
  if (action.action === "create") {
    const name = assertName(action.name);
    const description = action.description.trim().slice(0, 500);
    const developerInstructions = action.developerInstructions.trim();
    if (!description || !developerInstructions) throw new Error("Description and developer instructions are required.");
    const root = action.scope === "global" ? globalDirectory() : workspaceDirectory(assertWorkspace(allowedWorkspacePaths, action.workspacePath));
    const target = normalizedPath(path.join(root, `${name}.toml`));
    if (existsSync(target)) throw new Error("An agent file with that name already exists in this location.");
    atomicWrite(target, agentToml(name, description, developerInstructions));
    writeMetadata(database, target, sanitizeTags(action.tags), null);
    return scanAndStore(dependencies);
  }
  const sourcePath = normalizedPath(action.sourcePath);
  if (action.action === "register") {
    if (!safeFile(sourcePath)) throw new Error("Choose a readable local TOML file.");
    if (isManagedSource(sourcePath, allowedWorkspacePaths)) throw new Error("This TOML is already in a managed Codex folder.");
    parseToml(readFileSync(sourcePath, "utf8"), sourcePath);
    database.prepare("INSERT INTO agent_catalog_external(source_path, registered_at) VALUES (?, ?) ON CONFLICT(source_path) DO UPDATE SET registered_at = excluded.registered_at").run(sourcePath, now());
    return scanAndStore(dependencies);
  }
  if (action.action === "unregister") {
    database.prepare("DELETE FROM agent_catalog_external WHERE source_path = ?").run(sourcePath);
    database.prepare("DELETE FROM agent_catalog_metadata WHERE source_path = ?").run(sourcePath);
    return scanAndStore(dependencies);
  }
  if (action.action === "import") {
    const parsed = assertRegisteredExternal(database, sourcePath);
    const root = action.scope === "global" ? globalDirectory() : workspaceDirectory(assertWorkspace(allowedWorkspacePaths, action.workspacePath));
    const target = normalizedPath(path.join(root, `${parsed.name}.toml`));
    if (existsSync(target)) throw new Error("An agent file with that name already exists in this location.");
    const metadata = readMetadata(database, sourcePath);
    atomicWrite(target, readFileSync(sourcePath, "utf8"));
    writeMetadata(database, target, metadata.tags, null);
    database.prepare("DELETE FROM agent_catalog_external WHERE source_path = ?").run(sourcePath);
    database.prepare("DELETE FROM agent_catalog_metadata WHERE source_path = ?").run(sourcePath);
    return scanAndStore(dependencies);
  }
  if (action.action === "resolve-collision") return resolveCollision(dependencies, action);
  assertManagedUserAgent(sourcePath, allowedWorkspacePaths);
  const metadata = readMetadata(database, sourcePath);
  if (action.action === "tags") {
    writeMetadata(database, sourcePath, sanitizeTags(action.tags), metadata.disabledPath);
    return scanAndStore(dependencies);
  }
  if (action.action === "toggle") {
    if (action.enabled) {
      if (!metadata.disabledPath || !safeFile(metadata.disabledPath)) throw new Error("The disabled agent file is unavailable for restoration.");
      if (existsSync(sourcePath)) throw new Error("Cannot restore because the original agent path is now occupied.");
      mkdirSync(path.dirname(sourcePath), { recursive: true });
      renameSync(metadata.disabledPath, sourcePath);
      writeMetadata(database, sourcePath, metadata.tags, null);
    } else {
      const destination = path.join(disabledDirectory(storageRoot), `${keyFor(sourcePath)}.toml`);
      if (existsSync(destination)) throw new Error("A disabled copy already exists; restore it before disabling again.");
      mkdirSync(path.dirname(destination), { recursive: true });
      renameSync(sourcePath, destination);
      writeMetadata(database, sourcePath, metadata.tags, destination);
    }
    return scanAndStore(dependencies);
  }
  if (action.action !== "rename") throw new Error("Invalid agent catalog action.");
  const nextName = assertName(action.name);
  const location = metadata.disabledPath && safeFile(metadata.disabledPath) ? metadata.disabledPath : sourcePath;
  if (!safeFile(location)) throw new Error("The agent file is unavailable for renaming.");
  const parsed = parseToml(readFileSync(location, "utf8"), location);
  const nextSource = path.join(path.dirname(sourcePath), `${nextName}.toml`);
  if (nextSource !== sourcePath && existsSync(nextSource)) throw new Error("An agent with that name already exists in this location.");
  backupAgent(location, storageRoot, sourcePath);
  atomicWrite(location, agentToml(nextName, parsed.description, parsed.developerInstructions));
  if (!metadata.disabledPath && nextSource !== sourcePath) renameSync(sourcePath, nextSource);
  if (metadata.disabledPath) {
    database.prepare("DELETE FROM agent_catalog_metadata WHERE source_path = ?").run(sourcePath);
    writeMetadata(database, nextSource, metadata.tags, metadata.disabledPath);
  } else if (nextSource !== sourcePath) {
    database.prepare("DELETE FROM agent_catalog_metadata WHERE source_path = ?").run(sourcePath);
    writeMetadata(database, nextSource, metadata.tags, null);
  }
  return scanAndStore(dependencies);
}
