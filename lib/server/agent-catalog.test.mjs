import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const workspace = path.resolve(import.meta.dirname, "../..");
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: "data:text/javascript,export%20{}", shortCircuit: true };
    if (specifier.startsWith("@/")) {
      const target = path.join(workspace, specifier.slice(2));
      return { url: pathToFileURL(existsSync(target) ? target : `${target}.ts`).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const { applyCatalogAction, getCatalog } = await import("./agent-catalog.ts");
const toml = (name, description = "Fixture agent") => `name = "${name}"\ndescription = "${description}"\ndeveloper_instructions = "Work carefully."\n`;
const lanternwatchToml = (name, description = "Fixture LanternWatch agent") => `${toml(name, description)}# Lanternwatch/Agents/${name}.md\n`;

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", windowsHide: true });
}

function initializeFixtureRepository(workspaceRoot) {
  git(workspaceRoot, "init", "--quiet");
  git(workspaceRoot, "config", "user.name", "LanternWatch fixture");
  git(workspaceRoot, "config", "user.email", "fixture@example.test");
}

function commitFixtureRepository(workspaceRoot, message) {
  git(workspaceRoot, "add", "--all");
  git(workspaceRoot, "commit", "--quiet", "-m", message);
}

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "lanternwatch-catalog-"));
  const original = process.env.CODEX_HOME;
  process.env.CODEX_HOME = path.join(root, "codex");
  const workspaceRoot = path.join(root, "project");
  const database = new DatabaseSync(path.join(root, "catalog.db"));
  const dependencies = { database, storageRoot: path.join(root, "storage"), allowedWorkspacePaths: [workspaceRoot] };
  t.after(async () => {
    database.close();
    if (original === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = original;
    await rm(root, { recursive: true, force: true });
  });
  return { root, database, workspaceRoot, dependencies, globalDir: path.join(process.env.CODEX_HOME, "agents"), workspaceDir: path.join(workspaceRoot, ".codex", "agents") };
}

test("manual catalog reads only a saved scan and keeps marker-matching managed definitions editable", async (t) => {
  const { globalDir, workspaceDir, dependencies } = await fixture(t);
  await mkdir(globalDir, { recursive: true });
  await mkdir(workspaceDir, { recursive: true });
  await writeFile(path.join(globalDir, "same.toml"), toml("same"));
  await writeFile(path.join(workspaceDir, "same.toml"), toml("same", "Workspace copy"));
  await writeFile(path.join(globalDir, "legacy.toml"), `${toml("legacy")}# Lanternwatch/Agents/legacy.md\n`);
  await writeFile(path.join(workspaceDir, "internal-team.toml"), `name = "internal-team"\ndescription = "Internal template"\ndeveloper_instructions = """\nFrom the repository root, read AGENTS.md, Agents/interface-weaver-agent.md\n"""\n`);

  assert.deepEqual(getCatalog(dependencies).agents, []);
  let catalog = applyCatalogAction(dependencies, { action: "scan" });
  assert.equal(catalog.agents.length, 4);
  assert.equal(catalog.agents.filter((agent) => agent.name === "same" && agent.collision).length, 2);
  const markerMatching = catalog.agents.filter((agent) => agent.tags.includes("LanternWatch"));
  assert.equal(markerMatching.length, 2);
  assert.ok(markerMatching.every((agent) => !agent.readOnly));
  const global = catalog.agents.find((agent) => agent.name === "same" && agent.scope === "global");
  assert.ok(global);

  applyCatalogAction(dependencies, { action: "tags", sourcePath: global.sourcePath, tags: ["release", "release", "  trusted "] });
  catalog = getCatalog(dependencies);
  assert.deepEqual(catalog.agents.find((agent) => agent.sourcePath === global.sourcePath)?.tags, ["release", "trusted"]);
  applyCatalogAction(dependencies, { action: "toggle", sourcePath: global.sourcePath, enabled: false });
  assert.equal(getCatalog(dependencies).agents.find((agent) => agent.sourcePath === global.sourcePath)?.enabled, false);
  assert.equal(existsSync(global.sourcePath), false);
  applyCatalogAction(dependencies, { action: "toggle", sourcePath: global.sourcePath, enabled: true });
  assert.equal(existsSync(global.sourcePath), true);

  await writeFile(path.join(globalDir, "later.toml"), toml("later"));
  assert.equal(getCatalog(dependencies).agents.some((agent) => agent.name === "later"), false);
  catalog = applyCatalogAction(dependencies, { action: "scan" });
  assert.equal(catalog.agents.some((agent) => agent.name === "later"), true);
  const lanternwatch = catalog.agents.find((agent) => agent.tags.includes("LanternWatch"));
  applyCatalogAction(dependencies, { action: "tags", sourcePath: lanternwatch.sourcePath, tags: ["managed"] });
  assert.ok(getCatalog(dependencies).agents.find((agent) => agent.sourcePath === lanternwatch.sourcePath)?.tags.includes("managed"));
});

test("automatic one-time scan is only performed when that setting is saved", async (t) => {
  const { globalDir, dependencies } = await fixture(t);
  await mkdir(globalDir, { recursive: true });
  await writeFile(path.join(globalDir, "before-auto.toml"), toml("before-auto"));
  let catalog = applyCatalogAction(dependencies, { action: "settings", settings: { discoveryMode: "manual" } });
  assert.deepEqual(catalog.agents, []);
  catalog = applyCatalogAction(dependencies, { action: "settings", settings: { discoveryMode: "automatic-once" } });
  assert.equal(catalog.agents.some((agent) => agent.name === "before-auto"), true);
  assert.ok(catalog.settings.lastScannedAt);
  await writeFile(path.join(globalDir, "after-auto.toml"), toml("after-auto"));
  assert.equal(getCatalog(dependencies).agents.some((agent) => agent.name === "after-auto"), false);
});

test("creates, renames, registers, and imports agents without modifying the external original", async (t) => {
  const { root, globalDir, dependencies } = await fixture(t);
  applyCatalogAction(dependencies, { action: "create", scope: "global", name: "release-helper", description: "Release helper", developerInstructions: "Check the release carefully.", tags: ["release"] });
  let catalog = getCatalog(dependencies);
  const created = catalog.agents.find((agent) => agent.name === "release-helper");
  assert.ok(created && created.codexReady && !created.readOnly);
  applyCatalogAction(dependencies, { action: "rename", sourcePath: created.sourcePath, name: "deploy-helper" });
  catalog = getCatalog(dependencies);
  assert.equal(catalog.agents[0].name, "deploy-helper");
  assert.match(readFileSync(catalog.agents[0].sourcePath, "utf8"), /name = "deploy-helper"/);
  assert.equal(readdirSync(path.join(root, "storage", "agent-backups")).length, 1);

  const externalPath = path.join(root, "outside", "importable.toml");
  await mkdir(path.dirname(externalPath), { recursive: true });
  await writeFile(externalPath, toml("importable", "External definition"));
  catalog = applyCatalogAction(dependencies, { action: "register", sourcePath: externalPath });
  const external = catalog.agents.find((agent) => agent.sourcePath === externalPath);
  assert.ok(external && external.scope === "external" && external.readOnly && !external.codexReady);
  assert.throws(() => applyCatalogAction(dependencies, { action: "tags", sourcePath: externalPath, tags: ["blocked"] }), /managed Codex directory/i);
  catalog = applyCatalogAction(dependencies, { action: "import", sourcePath: externalPath, scope: "global" });
  assert.equal(existsSync(externalPath), true);
  assert.equal(catalog.agents.some((agent) => agent.sourcePath === externalPath), false);
  const imported = catalog.agents.find((agent) => agent.name === "importable" && agent.scope === "global");
  assert.ok(imported?.codexReady);
  assert.equal(readFileSync(path.join(globalDir, "importable.toml"), "utf8"), readFileSync(externalPath, "utf8"));
});

test("keeps marker-matching Global and workspace definitions in their physical source sections", async (t) => {
  const { globalDir, workspaceDir, dependencies } = await fixture(t);
  await mkdir(globalDir, { recursive: true });
  await mkdir(workspaceDir, { recursive: true });
  const globalPath = path.join(globalDir, "shared-marker.toml");
  const workspacePath = path.join(workspaceDir, "shared-marker.toml");
  await writeFile(globalPath, lanternwatchToml("shared-marker", "Global marker definition"));
  await writeFile(workspacePath, lanternwatchToml("shared-marker", "Workspace marker definition"));

  const catalog = applyCatalogAction(dependencies, { action: "scan" });
  const global = catalog.agents.find((agent) => agent.sourcePath === globalPath);
  const workspace = catalog.agents.find((agent) => agent.sourcePath === workspacePath);
  assert.ok(global && workspace);
  assert.deepEqual(
    { scope: global.scope, origin: global.origin, tags: global.tags, readOnly: global.readOnly },
    { scope: "global", origin: "global", tags: ["LanternWatch", "global"], readOnly: false },
  );
  assert.deepEqual(
    { scope: workspace.scope, origin: workspace.origin, tags: workspace.tags, readOnly: workspace.readOnly },
    { scope: "workspace", origin: "workspace", tags: ["LanternWatch", "workspace"], readOnly: false },
  );
  assert.equal(global.collision, true, "same names remain separately attributed physical definitions");
  assert.equal(workspace.collision, true, "same names remain separately attributed physical definitions");
});

test("repairs legacy marker snapshots from their physical source paths", async (t) => {
  const { database, globalDir, workspaceDir, dependencies } = await fixture(t);
  await mkdir(globalDir, { recursive: true });
  await mkdir(workspaceDir, { recursive: true });
  const globalPath = path.join(globalDir, "legacy-global.toml");
  const workspacePath = path.join(workspaceDir, "legacy-workspace.toml");
  await writeFile(globalPath, lanternwatchToml("legacy-global"));
  await writeFile(workspacePath, lanternwatchToml("legacy-workspace"));
  applyCatalogAction(dependencies, { action: "scan" });

  const snapshot = database.prepare("SELECT agents_json FROM agent_catalog_snapshot").get();
  const agents = JSON.parse(snapshot.agents_json);
  for (const agent of agents) {
    agent.scope = "lanternwatch";
    agent.origin = "lanternwatch";
  }
  database.prepare("UPDATE agent_catalog_snapshot SET agents_json = ?").run(JSON.stringify(agents));

  const recovered = getCatalog(dependencies).agents;
  assert.deepEqual(
    recovered.map((agent) => ({ sourcePath: agent.sourcePath, scope: agent.scope, origin: agent.origin })),
    [
      { sourcePath: globalPath, scope: "global", origin: "global" },
      { sourcePath: workspacePath, scope: "workspace", origin: "workspace" },
    ],
  );
});

test("registers a workspace only for explicit scans and preserves its source origin", async (t) => {
  const { root, dependencies } = await fixture(t);
  const registeredWorkspace = path.join(root, "registered-project");
  const agentDirectory = path.join(registeredWorkspace, ".codex", "agents");
  const agentPath = path.join(agentDirectory, "registered-helper.toml");
  await mkdir(agentDirectory, { recursive: true });
  await writeFile(agentPath, toml("registered-helper"));

  assert.deepEqual(getCatalog(dependencies).agents, []);
  let catalog = applyCatalogAction(dependencies, { action: "register-workspace", workspacePath: registeredWorkspace });
  assert.deepEqual(catalog.workspacePaths, [registeredWorkspace]);
  assert.deepEqual(catalog.workspaceSnapshots, []);
  const registered = catalog.agents.find((agent) => agent.sourcePath === agentPath);
  assert.ok(registered);
  assert.equal(registered.origin, "registered-workspace");
  assert.equal(registered.workspacePath, registeredWorkspace);
  assert.equal(registered.scope, "workspace");

  const emptyWorkspace = path.join(root, "empty-registered-project");
  await mkdir(emptyWorkspace, { recursive: true });
  catalog = applyCatalogAction(dependencies, { action: "register-workspace", workspacePath: emptyWorkspace });
  assert.deepEqual(catalog.workspacePaths, [emptyWorkspace, registeredWorkspace].sort(), "an empty registered workspace is returned from durable registration data");

  await writeFile(path.join(agentDirectory, "later.toml"), toml("later"));
  assert.equal(getCatalog(dependencies).agents.some((agent) => agent.name === "later"), false, "registration never starts a watcher");
  catalog = applyCatalogAction(dependencies, { action: "scan" });
  assert.equal(catalog.agents.some((agent) => agent.name === "later"), true);
  catalog = applyCatalogAction(dependencies, { action: "unregister-workspace", workspacePath: registeredWorkspace });
  assert.deepEqual(catalog.workspacePaths, [emptyWorkspace], "empty registered roots remain explicitly manageable until removed");
  assert.equal(catalog.agents.some((agent) => agent.sourcePath === agentPath), false);
  assert.equal(existsSync(agentPath), true, "unregistering only removes LanternWatch registration data");
});

test("deduplicates Windows workspace casing variants without a false collision", async (t) => {
  const { database, workspaceRoot, workspaceDir, dependencies } = await fixture(t);
  await mkdir(workspaceDir, { recursive: true });
  const sourcePath = path.join(workspaceDir, "case-helper.toml");
  await writeFile(sourcePath, toml("case-helper"));

  // Inject Windows identity rules so this fixture is valid on case-sensitive hosts too.
  const windowsDependencies = { ...dependencies, platform: "win32" };
  applyCatalogAction(windowsDependencies, { action: "scan" });
  const registeredVariant = workspaceRoot.replace(/project$/u, "PROJECT");
  database.prepare("INSERT INTO agent_catalog_workspace(workspace_path, registered_at) VALUES (?, ?)").run(registeredVariant, "2026-09-20T00:00:00.000Z");

  const catalog = applyCatalogAction(windowsDependencies, { action: "scan" });
  const agents = catalog.agents.filter((agent) => agent.name === "case-helper");
  assert.equal(agents.length, 1, "the case variants scan one physical workspace only");
  assert.deepEqual(
    { sourcePath: agents[0]?.sourcePath, workspacePath: agents[0]?.workspacePath, scope: agents[0]?.scope, origin: agents[0]?.origin, collision: agents[0]?.collision },
    { sourcePath, workspacePath: workspaceRoot, scope: "workspace", origin: "workspace", collision: false },
    "the first live root remains the canonical catalog source",
  );
  assert.deepEqual(catalog.workspacePaths, [registeredVariant], "deduplication never rewrites durable registration rows");
});

test("excludes a workspace source only when it aliases the Global agent directory for that platform", async (t) => {
  const { root, database, workspaceRoot, dependencies } = await fixture(t);
  process.env.CODEX_HOME = path.join(root, ".codex");
  const globalDir = path.join(process.env.CODEX_HOME, "agents");
  const windowsGlobalDir = path.join(root, ".CODEX", "agents");
  const trueWorkspaceDir = path.join(workspaceRoot, ".codex", "agents");
  await Promise.all([mkdir(globalDir, { recursive: true }), mkdir(windowsGlobalDir, { recursive: true }), mkdir(trueWorkspaceDir, { recursive: true })]);
  await Promise.all([
    writeFile(path.join(globalDir, "global-helper.toml"), toml("global-helper")),
    writeFile(path.join(windowsGlobalDir, "global-helper.toml"), toml("global-helper")),
    writeFile(path.join(trueWorkspaceDir, "workspace-helper.toml"), toml("workspace-helper")),
  ]);

  const sharedDependencies = { ...dependencies, allowedWorkspacePaths: [root, workspaceRoot] };
  getCatalog(sharedDependencies);
  database.prepare("INSERT INTO agent_catalog_workspace(workspace_path, registered_at) VALUES (?, ?)").run(root, "2026-09-20T00:00:00.000Z");

  const unixCatalog = applyCatalogAction({ ...sharedDependencies, platform: "linux" }, { action: "scan" });
  assert.deepEqual(
    unixCatalog.agents.map((agent) => agent.name),
    ["global-helper", "workspace-helper"],
    "non-Windows source identity excludes an exact global-directory alias",
  );

  process.env.CODEX_HOME = path.join(root, ".CODEX");
  const windowsCatalog = applyCatalogAction({ ...sharedDependencies, platform: "win32" }, { action: "scan" });
  assert.deepEqual(
    windowsCatalog.agents.map((agent) => agent.name),
    ["global-helper", "workspace-helper"],
    "Windows source identity scans the Global directory once while retaining a true workspace",
  );
  assert.deepEqual(windowsCatalog.workspacePaths, [root], "the collision filter never mutates durable workspace registrations");
});

test("imports a read-only workspace snapshot atomically and copies from saved data", async (t) => {
  const { root, globalDir, dependencies } = await fixture(t);
  const importedWorkspace = path.join(root, "imported-project");
  const importedDirectory = path.join(importedWorkspace, ".codex", "agents");
  const firstPath = path.join(importedDirectory, "snapshot-first.toml");
  const secondPath = path.join(importedDirectory, "snapshot-second.toml");
  await mkdir(importedDirectory, { recursive: true });
  await writeFile(firstPath, toml("snapshot-first", "First browser snapshot"));

  let catalog = applyCatalogAction(dependencies, { action: "import-workspace-snapshot", workspacePath: importedWorkspace });
  assert.deepEqual(catalog.workspaceSnapshots, [importedWorkspace]);
  assert.deepEqual(catalog.workspaceSnapshotMetadata.map(({ workspacePath, agentCount }) => ({ workspacePath, agentCount })), [{ workspacePath: importedWorkspace, agentCount: 1 }]);
  let first = catalog.agents.find((agent) => agent.sourcePath === firstPath && agent.origin === "imported-workspace");
  assert.ok(first);
  assert.equal(first.readOnly, true);
  assert.equal(first.codexReady, false);
  assert.equal(first.workspacePath, importedWorkspace);
  assert.ok(first.copyDestinations?.some((destination) => destination.scope === "global" && destination.path === path.join(globalDir, "snapshot-first.toml")));
  assert.throws(() => applyCatalogAction(dependencies, { action: "tags", sourcePath: first.sourcePath, tags: ["blocked"] }), /managed Codex directory/i, "snapshot definitions remain copy-only");

  await rm(firstPath);
  await writeFile(secondPath, toml("snapshot-second", "Replacement browser snapshot"));
  catalog = applyCatalogAction(dependencies, { action: "import-workspace-snapshot", workspacePath: importedWorkspace });
  assert.equal(catalog.workspaceSnapshotMetadata[0]?.agentCount, 1);
  assert.equal(catalog.agents.some((agent) => agent.name === "snapshot-first" && agent.origin === "imported-workspace"), false, "re-import replaces the saved snapshot rather than appending to it");
  const second = catalog.agents.find((agent) => agent.sourcePath === secondPath && agent.origin === "imported-workspace");
  assert.ok(second);
  assert.throws(() => applyCatalogAction(dependencies, { action: "import-workspace-snapshot", workspacePath: path.join(root, "missing-project") }), /readable workspace/i);
  assert.equal(getCatalog(dependencies).agents.some((agent) => agent.sourcePath === secondPath && agent.origin === "imported-workspace"), true, "failed import leaves the prior snapshot intact");

  await rm(secondPath);
  catalog = applyCatalogAction(dependencies, { action: "import", sourcePath: second.sourcePath, scope: "global" });
  assert.equal(readFileSync(path.join(globalDir, "snapshot-second.toml"), "utf8"), toml("snapshot-second", "Replacement browser snapshot"), "copy uses the captured definition after the source disappears");
  assert.throws(() => applyCatalogAction(dependencies, { action: "import", sourcePath: second.sourcePath, scope: "global" }), /already exists/i, "copy destinations remain collision-safe");

  catalog = applyCatalogAction(dependencies, { action: "remove-workspace-snapshot", workspacePath: importedWorkspace });
  assert.deepEqual(catalog.workspaceSnapshots, []);
  assert.deepEqual(catalog.workspaceSnapshotMetadata, []);
  assert.equal(catalog.agents.some((agent) => agent.origin === "imported-workspace" && agent.workspacePath === importedWorkspace), false);
  assert.equal(existsSync(importedWorkspace), true, "snapshot removal never deletes the imported workspace");
  assert.equal(existsSync(path.join(globalDir, "snapshot-second.toml")), true, "snapshot removal never deletes copied agents");
});

test("allows managed Global and workspace collision targets while preserving collision validation", async (t) => {
  const { globalDir, workspaceDir, dependencies } = await fixture(t);
  await mkdir(globalDir, { recursive: true });
  await mkdir(workspaceDir, { recursive: true });
  const globalPath = path.join(globalDir, "same.toml");
  const workspacePath = path.join(workspaceDir, "same.toml");
  const originalWorkspaceToml = toml("same", "Workspace duplicate");
  await writeFile(globalPath, toml("same"));
  await writeFile(workspacePath, originalWorkspaceToml);
  applyCatalogAction(dependencies, { action: "scan" });

  let catalog = applyCatalogAction(dependencies, { action: "resolve-collision", sourcePath: workspacePath, resolution: "tag" });
  const workspace = catalog.agents.find((agent) => agent.sourcePath === workspacePath);
  assert.ok(workspace?.collision);
  assert.ok(workspace?.tags.includes("duplicate-source"));
  assert.equal(readFileSync(workspacePath, "utf8"), originalWorkspaceToml);
  assert.equal(catalog.agents.find((agent) => agent.sourcePath === globalPath)?.collision, true);

  catalog = applyCatalogAction(dependencies, { action: "resolve-collision", sourcePath: globalPath, resolution: "tag", tags: ["global-source"] });
  assert.ok(catalog.agents.find((agent) => agent.sourcePath === globalPath)?.tags.includes("global-source"));
  await writeFile(path.join(workspaceDir, "solo.toml"), toml("solo"));
  applyCatalogAction(dependencies, { action: "scan" });
  assert.throws(() => applyCatalogAction(dependencies, { action: "resolve-collision", sourcePath: path.join(workspaceDir, "solo.toml"), resolution: "disable" }), /unresolved same-name/i);

  const globalLanternwatch = path.join(globalDir, "guarded.toml");
  const workspaceLanternwatch = path.join(workspaceDir, "guarded.toml");
  await writeFile(globalLanternwatch, `${toml("guarded")}# Lanternwatch/Agents/guarded.md\n`);
  await writeFile(workspaceLanternwatch, `${toml("guarded")}# Lanternwatch/Agents/guarded.md\n`);
  applyCatalogAction(dependencies, { action: "scan" });
  catalog = applyCatalogAction(dependencies, { action: "resolve-collision", sourcePath: globalLanternwatch, resolution: "rename", name: "global-guarded" });
  assert.equal(catalog.agents.some((agent) => agent.sourcePath === globalLanternwatch), false);
  assert.equal(catalog.agents.find((agent) => agent.sourcePath === workspaceLanternwatch)?.collision, false);
});

test("keeps Global and workspace LanternWatch definitions editable in clean and dirty worktrees", async (t) => {
  assert.match(git(process.cwd(), "--version"), /^git version /);
  const { globalDir, workspaceRoot, workspaceDir, dependencies } = await fixture(t);
  await mkdir(globalDir, { recursive: true });
  await mkdir(workspaceDir, { recursive: true });
  initializeFixtureRepository(workspaceRoot);
  const workspacePath = path.join(workspaceDir, "lantern.toml");
  const globalPath = path.join(globalDir, "global-lantern.toml");
  await writeFile(workspacePath, lanternwatchToml("lantern"));
  await writeFile(globalPath, lanternwatchToml("global-lantern"));
  commitFixtureRepository(workspaceRoot, "track workspace LanternWatch definition");

  let catalog = applyCatalogAction(dependencies, { action: "scan" });
  assert.equal(catalog.agents.find((agent) => agent.sourcePath === workspacePath)?.readOnly, false, "a clean workspace source remains editable");
  assert.equal(catalog.agents.find((agent) => agent.sourcePath === globalPath)?.readOnly, false, "a Global source remains editable");
  applyCatalogAction(dependencies, { action: "tags", sourcePath: workspacePath, tags: ["clean"] });
  applyCatalogAction(dependencies, { action: "tags", sourcePath: globalPath, tags: ["global"] });
  catalog = applyCatalogAction(dependencies, { action: "toggle", sourcePath: workspacePath, enabled: false });
  assert.equal(catalog.agents.find((agent) => agent.sourcePath === workspacePath)?.readOnly, true, "a disabled definition remains non-editable until restored");
  assert.throws(() => applyCatalogAction(dependencies, { action: "tags", sourcePath: workspacePath, tags: ["blocked"] }), /unavailable/i);
  applyCatalogAction(dependencies, { action: "toggle", sourcePath: workspacePath, enabled: true });

  await writeFile(path.join(workspaceRoot, "uncommitted.txt"), "workspace dirt\n");
  catalog = applyCatalogAction(dependencies, { action: "scan" });
  assert.equal(catalog.agents.find((agent) => agent.sourcePath === workspacePath)?.readOnly, false, "a dirty workspace source remains editable");
  assert.equal(catalog.agents.find((agent) => agent.sourcePath === globalPath)?.readOnly, false, "a Global source remains editable while a workspace is dirty");
  applyCatalogAction(dependencies, { action: "tags", sourcePath: workspacePath, tags: ["dirty"] });
  assert.deepEqual(getCatalog(dependencies).agents.find((agent) => agent.sourcePath === workspacePath)?.tags, ["LanternWatch", "workspace", "dirty"]);
});

test("resolves an existing catalog database collision by rename or recoverable disable", async (t) => {
  const { root, globalDir, workspaceDir, dependencies } = await fixture(t);
  await mkdir(globalDir, { recursive: true });
  await mkdir(workspaceDir, { recursive: true });
  const globalSame = path.join(globalDir, "same.toml");
  const workspaceSame = path.join(workspaceDir, "same.toml");
  await writeFile(globalSame, toml("same"));
  await writeFile(workspaceSame, toml("same", "Workspace copy"));
  applyCatalogAction(dependencies, { action: "scan" });
  applyCatalogAction(dependencies, { action: "tags", sourcePath: workspaceSame, tags: ["kept"] });

  let catalog = applyCatalogAction(dependencies, { action: "resolve-collision", sourcePath: workspaceSame, resolution: "rename", name: "workspace-same" });
  const renamedPath = path.join(workspaceDir, "workspace-same.toml");
  assert.equal(existsSync(workspaceSame), false);
  assert.equal(existsSync(renamedPath), true);
  assert.equal(readFileSync(renamedPath, "utf8"), toml("workspace-same", "Workspace copy"));
  assert.deepEqual(catalog.agents.find((agent) => agent.sourcePath === renamedPath)?.tags, ["kept"]);
  assert.equal(catalog.agents.find((agent) => agent.sourcePath === globalSame)?.collision, false);
  assert.equal(catalog.agents.find((agent) => agent.sourcePath === renamedPath)?.collision, false);
  assert.equal(readdirSync(path.join(root, "storage", "agent-backups")).length, 1);

  const globalOther = path.join(globalDir, "other.toml");
  const workspaceOther = path.join(workspaceDir, "other.toml");
  await writeFile(globalOther, toml("other"));
  await writeFile(workspaceOther, toml("other", "Disable this workspace source"));
  applyCatalogAction(dependencies, { action: "scan" });
  catalog = applyCatalogAction(dependencies, { action: "resolve-collision", sourcePath: workspaceOther, resolution: "disable" });
  const disabled = catalog.agents.find((agent) => agent.sourcePath === workspaceOther);
  assert.equal(disabled?.enabled, false);
  assert.equal(disabled?.collision, false);
  assert.equal(catalog.agents.find((agent) => agent.sourcePath === globalOther)?.collision, false);
  assert.equal(existsSync(workspaceOther), false);
  assert.equal(readdirSync(path.join(root, "storage", "disabled-agents")).length, 1);
});
