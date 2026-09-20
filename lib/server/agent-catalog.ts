import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { CatalogAction, CatalogAgent, CatalogResponse, CatalogSettings, CatalogWorkspaceSnapshot } from "@/lib/guild-contract";

export type { CatalogAction } from "@/lib/guild-contract";

type CatalogDependencies = {
  database: DatabaseSync;
  storageRoot: string;
  allowedWorkspacePaths: string[];
  /** Test-only seam for filesystem identity rules; production uses process.platform. */
  platform?: NodeJS.Platform;
};

type CatalogOrigin = NonNullable<CatalogAgent["origin"]>;
type SnapshotDefinition = {
  sourcePath: string;
  source: string;
  name: string;
  description: string;
};

const DEFAULT_SETTINGS: CatalogSettings = { discoveryMode: "manual", collisionPolicy: "rename", lastScannedAt: null };
const LANTERNWATCH_MARKER = /Lanternwatch[\\/]Agents[\\/]|Lanternwatch Company Team|From the repository root, read AGENTS\.md, Agents[\\/].*-agent\.md/iu;
const NAME_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;

function now() { return new Date().toISOString(); }
function normalizedPath(value: string) { return path.resolve(value); }
function workspacePathIdentity(value: string, platform = process.platform) {
  const resolved = normalizedPath(value);
  return platform === "win32" ? resolved.toLowerCase() : resolved;
}
function sameSourceDirectory(left: string, right: string, { platform }: Pick<CatalogDependencies, "platform">) {
  return workspacePathIdentity(left, platform) === workspacePathIdentity(right, platform);
}
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

function safeDirectory(pathname: string) {
  try { return lstatSync(pathname).isDirectory() && !lstatSync(pathname).isSymbolicLink(); } catch { return false; }
}

function copyDestinations(name: string, dependencies: CatalogDependencies) {
  const destinations = [
    { scope: "global" as const, path: normalizedPath(path.join(globalDirectory(), `${name}.toml`)) },
    ...workspaceRoots(dependencies).map((workspacePath) => ({ scope: "workspace" as const, workspacePath, path: normalizedPath(path.join(workspaceDirectory(workspacePath), `${name}.toml`)) })),
  ];
  return destinations.filter((destination) => !existsSync(destination.path));
}

function catalogAgent(sourcePath: string, parsed: ReturnType<typeof parseToml>, scope: "global" | "workspace", enabled: boolean, tags: string[], lanternwatch: boolean, readOnly = false, origin: CatalogOrigin = scope): CatalogAgent {
  return {
    id: keyFor(sourcePath),
    sourcePath,
    name: parsed.name,
    description: parsed.description,
    // The directory that supplied a definition is its source classification.
    // LanternWatch instructions are a capability/presentation marker, not a
    // different Codex installation scope.
    scope,
    enabled,
    tags: lanternwatch ? sanitizeTags(["LanternWatch", scope, ...tags]) : tags,
    collision: false,
    readOnly,
    codexReady: true,
    origin,
    copyDestinations: [],
  };
}

/**
 * Older snapshots classified marker-matching definitions as LanternWatch even
 * when their TOMLs were physically discovered from Global or a workspace.
 * Recover those cached records at read time so a dashboard update does not
 * require a user to rescan before its source sections become accurate.
 */
function physicalClassification(sourcePath: string, dependencies: CatalogDependencies) {
  const directory = path.dirname(normalizedPath(sourcePath));
  if (directory === normalizedPath(globalDirectory())) {
    return { scope: "global" as const, origin: "global" as const };
  }
  const workspacePath = workspaceRoots(dependencies).find((root) => sameWorkspacePath(directory, workspaceDirectory(root), dependencies));
  if (!workspacePath) return undefined;
  return {
    scope: "workspace" as const,
    origin: workspaceOrigin(workspacePath, dependencies),
    workspacePath,
  };
}

function discoverDirectory(database: DatabaseSync, directory: string, scope: "global" | "workspace", storageRoot: string, origin: CatalogOrigin = scope): CatalogAgent[] {
  const agents: CatalogAgent[] = [];
  if (existsSync(directory)) {
    for (const entry of readdirSync(directory).filter((name) => name.endsWith(".toml")).sort()) {
      const sourcePath = normalizedPath(path.join(directory, entry));
      if (!safeFile(sourcePath)) continue;
      try {
        const source = readFileSync(sourcePath, "utf8");
        const parsed = parseToml(source, sourcePath);
        const metadata = readMetadata(database, sourcePath);
        const lanternwatch = LANTERNWATCH_MARKER.test(source);
        agents.push(catalogAgent(sourcePath, parsed, scope, true, metadata.tags, lanternwatch, false, origin));
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
        agents.push(catalogAgent(normalizedPath(metadataRow.source_path), parsed, scope, false, tags, LANTERNWATCH_MARKER.test(source), true, origin));
      } catch {}
    }
  }
  return agents;
}

function discoverExternal(database: DatabaseSync, dependencies: CatalogDependencies): CatalogAgent[] {
  const rows = database.prepare("SELECT source_path FROM agent_catalog_external ORDER BY source_path").all() as Array<{ source_path: string }>;
  const agents: CatalogAgent[] = [];
  for (const row of rows) {
    const sourcePath = normalizedPath(row.source_path);
    if (!safeFile(sourcePath)) continue;
    try {
      const source = readFileSync(sourcePath, "utf8");
      const parsed = parseToml(source, sourcePath);
      const metadata = readMetadata(database, sourcePath);
      agents.push({ id: keyFor(sourcePath), sourcePath, name: parsed.name, description: parsed.description, scope: "external", enabled: true, tags: metadata.tags, collision: false, readOnly: true, codexReady: false, origin: "external", copyDestinations: copyDestinations(parsed.name, dependencies) });
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

function validSnapshot(value: unknown, dependencies: CatalogDependencies): CatalogAgent[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const agent = candidate as Partial<CatalogAgent>;
    if (typeof agent.id !== "string" || typeof agent.name !== "string" || typeof agent.description !== "string" || typeof agent.sourcePath !== "string") return [];
    if (!["global", "workspace", "external", "lanternwatch"].includes(String(agent.scope))) return [];
    const origin = ["global", "lanternwatch", "workspace", "registered-workspace", "imported-workspace", "external"].includes(String(agent.origin))
      ? agent.origin as CatalogOrigin
      : agent.scope === "lanternwatch" ? "lanternwatch" : agent.scope;
    const legacyLanternWatchClassification = agent.scope === "lanternwatch" || origin === "lanternwatch";
    const physical = legacyLanternWatchClassification ? physicalClassification(agent.sourcePath, dependencies) : undefined;
    const destinations: NonNullable<CatalogAgent["copyDestinations"]> = Array.isArray(agent.copyDestinations) ? agent.copyDestinations.flatMap((destination) => {
      if (!destination || typeof destination !== "object") return [];
      const value = destination as { scope?: unknown; path?: unknown; workspacePath?: unknown };
      if ((value.scope !== "global" && value.scope !== "workspace") || typeof value.path !== "string") return [];
      return [{ scope: value.scope as "global" | "workspace", path: value.path, ...(typeof value.workspacePath === "string" ? { workspacePath: value.workspacePath } : {}) }];
    }) : [];
    return [{ id: agent.id, name: agent.name, description: agent.description, sourcePath: agent.sourcePath, scope: physical?.scope ?? agent.scope as CatalogAgent["scope"], enabled: Boolean(agent.enabled), tags: sanitizeTags(agent.tags), collision: Boolean(agent.collision), readOnly: Boolean(agent.readOnly), codexReady: Boolean(agent.codexReady), origin: physical?.origin ?? origin, ...(physical?.workspacePath ? { workspacePath: physical.workspacePath } : typeof agent.workspacePath === "string" ? { workspacePath: agent.workspacePath } : {}), copyDestinations: destinations }];
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
    CREATE TABLE IF NOT EXISTS agent_catalog_workspace (
      workspace_path TEXT PRIMARY KEY,
      registered_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_catalog_workspace_snapshot (
      workspace_path TEXT PRIMARY KEY,
      agents_json TEXT NOT NULL,
      imported_at TEXT NOT NULL
    );
  `);
}

function registeredWorkspaceRoots(database: DatabaseSync) {
  return (database.prepare("SELECT workspace_path FROM agent_catalog_workspace ORDER BY workspace_path").all() as Array<{ workspace_path: string }>)
    .map((row) => normalizedPath(row.workspace_path));
}

function registeredWorkspacePaths(database: DatabaseSync) {
  return (database.prepare("SELECT workspace_path FROM agent_catalog_workspace ORDER BY workspace_path").all() as Array<{ workspace_path: string }>)
    .map((row) => normalizedPath(row.workspace_path));
}

function sameWorkspacePath(left: string, right: string, { platform }: CatalogDependencies) {
  return workspacePathIdentity(left, platform) === workspacePathIdentity(right, platform);
}

function isRegisteredWorkspaceRoot(workspacePath: string, dependencies: CatalogDependencies) {
  return registeredWorkspaceRoots(dependencies.database)
    .some((registeredWorkspacePath) => sameWorkspacePath(registeredWorkspacePath, workspacePath, dependencies));
}

function isAllowedWorkspaceRoot(workspacePath: string, dependencies: CatalogDependencies) {
  return dependencies.allowedWorkspacePaths
    .map(normalizedPath)
    .some((allowedWorkspacePath) => sameWorkspacePath(allowedWorkspacePath, workspacePath, dependencies));
}

function workspaceOrigin(workspacePath: string, dependencies: CatalogDependencies): Extract<CatalogOrigin, "workspace" | "registered-workspace"> {
  return isAllowedWorkspaceRoot(workspacePath, dependencies) || !isRegisteredWorkspaceRoot(workspacePath, dependencies)
    ? "workspace"
    : "registered-workspace";
}

function workspaceSnapshotMetadata(database: DatabaseSync): CatalogWorkspaceSnapshot[] {
  return (database.prepare("SELECT workspace_path, agents_json, imported_at FROM agent_catalog_workspace_snapshot ORDER BY workspace_path").all() as Array<{ workspace_path: string; agents_json: string; imported_at: string }>)
    .map((row) => {
      let agentCount = 0;
      try {
        const parsed = JSON.parse(row.agents_json);
        agentCount = Array.isArray(parsed) ? parsed.length : 0;
      } catch { /* Corrupt managed data remains removable and reports no valid count. */ }
      return { workspacePath: normalizedPath(row.workspace_path), agentCount, importedAt: row.imported_at };
    });
}

function catalogResponse(database: DatabaseSync, agents: CatalogAgent[], catalogSettings: CatalogSettings): CatalogResponse {
  const workspacePaths = registeredWorkspacePaths(database);
  const snapshots = workspaceSnapshotMetadata(database);
  return {
    agents,
    settings: catalogSettings,
    workspacePaths,
    workspaceSnapshots: snapshots.map((snapshot) => snapshot.workspacePath),
    workspaceSnapshotMetadata: snapshots,
  };
}

function workspaceRoots({ database, allowedWorkspacePaths, platform }: CatalogDependencies) {
  const seen = new Set<string>();
  return [...allowedWorkspacePaths.map(normalizedPath), ...registeredWorkspaceRoots(database)]
    .filter((workspacePath) => {
      const identity = workspacePathIdentity(workspacePath, platform);
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    })
    // A user home directory can be registered as a project. Its derived
    // `.codex/agents` directory is then the same physical source already
    // scanned as Global, so it must not be scanned a second time as workspace.
    .filter((workspacePath) => !sameSourceDirectory(workspaceDirectory(workspacePath), globalDirectory(), { platform }));
}

function snapshotDefinitions(database: DatabaseSync) {
  const rows = database.prepare("SELECT workspace_path, agents_json FROM agent_catalog_workspace_snapshot ORDER BY workspace_path").all() as Array<{ workspace_path: string; agents_json: string }>;
  return rows.flatMap((row) => {
    try {
      const candidates = JSON.parse(row.agents_json) as unknown;
      if (!Array.isArray(candidates)) return [];
      return candidates.flatMap((candidate) => {
        if (!candidate || typeof candidate !== "object") return [];
        const definition = candidate as Partial<SnapshotDefinition>;
        if (typeof definition.sourcePath !== "string" || typeof definition.source !== "string" || typeof definition.name !== "string" || typeof definition.description !== "string") return [];
        try {
          const parsed = parseToml(definition.source, definition.sourcePath);
          if (parsed.name !== definition.name || parsed.description !== definition.description) return [];
          return [{ workspacePath: normalizedPath(row.workspace_path), ...definition as SnapshotDefinition }];
        } catch { return []; }
      });
    } catch { return []; }
  });
}

function discoverWorkspaceSnapshots(database: DatabaseSync, dependencies: CatalogDependencies): CatalogAgent[] {
  return snapshotDefinitions(database).map((definition) => ({
    id: keyFor(`workspace-snapshot\0${definition.workspacePath}\0${definition.sourcePath}`),
    sourcePath: normalizedPath(definition.sourcePath),
    name: definition.name,
    description: definition.description,
    scope: "external",
    enabled: true,
    tags: ["workspace-snapshot"],
    collision: false,
    readOnly: true,
    codexReady: false,
    origin: "imported-workspace",
    workspacePath: definition.workspacePath,
    copyDestinations: copyDestinations(definition.name, dependencies),
  }));
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

function scanCurrent(dependencies: CatalogDependencies) {
  const { database, storageRoot } = dependencies;
  const roots = workspaceRoots(dependencies);
  return markCollisions([
    ...discoverDirectory(database, globalDirectory(), "global", storageRoot),
    ...roots.flatMap((root) => discoverDirectory(database, workspaceDirectory(root), "workspace", storageRoot, workspaceOrigin(root, dependencies)).map((agent) => ({ ...agent, workspacePath: root }))),
    ...discoverExternal(database, dependencies),
    ...discoverWorkspaceSnapshots(database, dependencies),
  ]).sort((a, b) => a.name.localeCompare(b.name) || a.scope.localeCompare(b.scope) || a.sourcePath.localeCompare(b.sourcePath));
}

function scanAndStore(dependencies: CatalogDependencies): CatalogResponse {
  const { database, storageRoot } = dependencies;
  const roots = workspaceRoots(dependencies);
  const agents = scanCurrent(dependencies);
  const scannedAt = now();
  database.prepare("INSERT INTO agent_catalog_snapshot(cache_key, agents_json, scanned_at) VALUES (?, ?, ?) ON CONFLICT(cache_key) DO UPDATE SET agents_json = excluded.agents_json, scanned_at = excluded.scanned_at").run(snapshotKey(storageRoot, roots), JSON.stringify(agents), scannedAt);
  writeSetting(database, "lastScannedAt", scannedAt);
  return catalogResponse(database, agents, { ...settings(database), lastScannedAt: scannedAt });
}

export function getCatalog(dependencies: CatalogDependencies): CatalogResponse {
  const { database, storageRoot } = dependencies;
  ensureCatalogSchema(database);
  const roots = workspaceRoots(dependencies);
  const snapshot = database.prepare("SELECT agents_json FROM agent_catalog_snapshot WHERE cache_key = ?").get(snapshotKey(storageRoot, roots)) as { agents_json: string } | undefined;
  let agents: CatalogAgent[] = [];
  try { agents = validSnapshot(snapshot ? JSON.parse(snapshot.agents_json) : [], dependencies); } catch {}
  return catalogResponse(database, agents, settings(database));
}

function assertWorkspace(dependencies: CatalogDependencies, workspacePath: string | undefined) {
  if (!workspacePath) throw new Error("Choose a workspace destination.");
  const target = normalizedPath(workspacePath);
  const root = workspaceRoots(dependencies).find((candidate) => sameWorkspacePath(candidate, target, dependencies));
  if (!root) throw new Error("That workspace is not available in LanternWatch.");
  return root;
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

function sourceScope(sourcePath: string, dependencies: CatalogDependencies) {
  if (path.dirname(sourcePath) === normalizedPath(globalDirectory())) return "global" as const;
  if (workspaceRoots(dependencies).some((workspace) => sameWorkspacePath(path.dirname(sourcePath), workspaceDirectory(workspace), dependencies))) return "workspace" as const;
  throw new Error("That agent is not in a managed Codex directory.");
}

function isManagedSource(sourcePath: string, dependencies: CatalogDependencies) {
  return path.dirname(sourcePath) === normalizedPath(globalDirectory())
    || workspaceRoots(dependencies).some((workspace) => sameWorkspacePath(path.dirname(sourcePath), workspaceDirectory(workspace), dependencies));
}

function assertMutableManagedAgent(dependencies: CatalogDependencies, sourcePath: string, allowMissingSource = false) {
  const scope = sourceScope(sourcePath, dependencies);
  if (!safeFile(sourcePath) && !allowMissingSource) {
    throw new Error("The agent file is unavailable.");
  }
  return scope;
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
  if (target.readOnly) throw new Error("That agent is read-only in this catalog.");
  if (!target.enabled || !target.codexReady || !target.collision) throw new Error("That agent does not have an unresolved same-name Codex collision.");
  const candidates = agents.filter((agent) => agent.enabled && agent.codexReady && agent.name.toLowerCase() === target.name.toLowerCase());
  if (candidates.length !== 2) throw new Error("Resolve exactly two same-name Codex definitions at a time.");
  assertMutableManagedAgent(dependencies, sourcePath);
  return { target, agents };
}

function snapshotSource(database: DatabaseSync, sourcePath: string) {
  const target = normalizedPath(sourcePath);
  const definition = snapshotDefinitions(database).find((candidate) => normalizedPath(candidate.sourcePath) === target);
  if (!definition) return undefined;
  return { source: definition.source, parsed: parseToml(definition.source, definition.sourcePath) };
}

function readWorkspaceSnapshot(workspacePath: string): SnapshotDefinition[] {
  const root = normalizedPath(workspacePath);
  const directory = workspaceDirectory(root);
  if (!safeDirectory(root)) throw new Error("Choose a readable workspace folder.");
  if (!existsSync(directory)) return [];
  if (!safeDirectory(directory)) throw new Error("The workspace agent folder is not a readable directory.");
  return readdirSync(directory).filter((entry) => entry.endsWith(".toml")).sort().flatMap((entry) => {
    const sourcePath = normalizedPath(path.join(directory, entry));
    if (!safeFile(sourcePath)) return [];
    try {
      const source = readFileSync(sourcePath, "utf8");
      const parsed = parseToml(source, sourcePath);
      return [{ sourcePath, source, name: parsed.name, description: parsed.description }];
    } catch { return []; }
  });
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
  if (action.action === "register-workspace") {
    const workspacePath = normalizedPath(action.workspacePath);
    if (!safeDirectory(workspacePath)) throw new Error("Choose a readable workspace folder.");
    return withCatalogTransaction(database, () => {
      database.prepare("INSERT INTO agent_catalog_workspace(workspace_path, registered_at) VALUES (?, ?) ON CONFLICT(workspace_path) DO UPDATE SET registered_at = excluded.registered_at").run(workspacePath, now());
      return scanAndStore(dependencies);
    });
  }
  if (action.action === "unregister-workspace") {
    const workspacePath = normalizedPath(action.workspacePath);
    return withCatalogTransaction(database, () => {
      database.prepare("DELETE FROM agent_catalog_workspace WHERE workspace_path = ?").run(workspacePath);
      return scanAndStore(dependencies);
    });
  }
  if (action.action === "import-workspace-snapshot") {
    const workspacePath = normalizedPath(action.workspacePath);
    // Read and validate before the transaction: a failed folder read must leave
    // the previously saved browser snapshot exactly as it was.
    const definitions = readWorkspaceSnapshot(workspacePath);
    return withCatalogTransaction(database, () => {
      database.prepare("INSERT INTO agent_catalog_workspace_snapshot(workspace_path, agents_json, imported_at) VALUES (?, ?, ?) ON CONFLICT(workspace_path) DO UPDATE SET agents_json = excluded.agents_json, imported_at = excluded.imported_at").run(workspacePath, JSON.stringify(definitions), now());
      return scanAndStore(dependencies);
    });
  }
  if (action.action === "remove-workspace-snapshot") {
    const workspacePath = normalizedPath(action.workspacePath);
    return withCatalogTransaction(database, () => {
      // Snapshot removal is catalog-only. It deliberately never touches the
      // imported workspace or any TOML it contained.
      database.prepare("DELETE FROM agent_catalog_workspace_snapshot WHERE workspace_path = ?").run(workspacePath);
      return scanAndStore(dependencies);
    });
  }
  if (action.action === "create") {
    const name = assertName(action.name);
    const description = action.description.trim().slice(0, 500);
    const developerInstructions = action.developerInstructions.trim();
    if (!description || !developerInstructions) throw new Error("Description and developer instructions are required.");
    const root = action.scope === "global" ? globalDirectory() : workspaceDirectory(assertWorkspace(dependencies, action.workspacePath));
    const target = normalizedPath(path.join(root, `${name}.toml`));
    if (existsSync(target)) throw new Error("An agent file with that name already exists in this location.");
    atomicWrite(target, agentToml(name, description, developerInstructions));
    writeMetadata(database, target, sanitizeTags(action.tags), null);
    return scanAndStore(dependencies);
  }
  const sourcePath = normalizedPath(action.sourcePath);
  if (action.action === "register") {
    if (!safeFile(sourcePath)) throw new Error("Choose a readable local TOML file.");
    if (isManagedSource(sourcePath, dependencies)) throw new Error("This TOML is already in a managed Codex folder.");
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
    const registered = (() => {
      try { return assertRegisteredExternal(database, sourcePath); } catch (error) {
        const snapshot = snapshotSource(database, sourcePath);
        if (snapshot) return snapshot.parsed;
        throw error;
      }
    })();
    const source = safeFile(sourcePath) && database.prepare("SELECT source_path FROM agent_catalog_external WHERE source_path = ?").get(sourcePath)
      ? readFileSync(sourcePath, "utf8")
      : snapshotSource(database, sourcePath)?.source;
    if (!source) throw new Error("The saved definition is unavailable for copying.");
    const root = action.scope === "global" ? globalDirectory() : workspaceDirectory(assertWorkspace(dependencies, action.workspacePath));
    const target = normalizedPath(path.join(root, `${registered.name}.toml`));
    if (existsSync(target)) throw new Error("An agent file with that name already exists in this location.");
    const metadata = readMetadata(database, sourcePath);
    atomicWrite(target, source);
    writeMetadata(database, target, metadata.tags, null);
    database.prepare("DELETE FROM agent_catalog_external WHERE source_path = ?").run(sourcePath);
    database.prepare("DELETE FROM agent_catalog_metadata WHERE source_path = ?").run(sourcePath);
    return scanAndStore(dependencies);
  }
  if (action.action === "resolve-collision") return resolveCollision(dependencies, action);
  assertMutableManagedAgent(dependencies, sourcePath, action.action === "toggle" && action.enabled);
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
