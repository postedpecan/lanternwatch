import assert from "node:assert/strict";
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
  return { root, workspaceRoot, dependencies, globalDir: path.join(process.env.CODEX_HOME, "agents"), workspaceDir: path.join(workspaceRoot, ".codex", "agents") };
}

test("manual catalog reads only a saved scan and shows LanternWatch definitions read-only", async (t) => {
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
  assert.equal(catalog.agents.filter((agent) => agent.scope === "lanternwatch" && agent.readOnly).length, 2);
  assert.ok(catalog.agents.filter((agent) => agent.scope === "lanternwatch").every((agent) => agent.tags.includes("LanternWatch")));
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
  assert.throws(() => applyCatalogAction(dependencies, { action: "tags", sourcePath: catalog.agents.find((agent) => agent.scope === "lanternwatch").sourcePath, tags: ["blocked"] }), /read-only/i);
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

test("tags an unresolved workspace duplicate locally and rejects invalid resolution targets", async (t) => {
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

  assert.throws(() => applyCatalogAction(dependencies, { action: "resolve-collision", sourcePath: globalPath, resolution: "tag" }), /workspace definition/i);
  await writeFile(path.join(workspaceDir, "solo.toml"), toml("solo"));
  applyCatalogAction(dependencies, { action: "scan" });
  assert.throws(() => applyCatalogAction(dependencies, { action: "resolve-collision", sourcePath: path.join(workspaceDir, "solo.toml"), resolution: "disable" }), /unresolved same-name/i);

  const readOnlyGlobal = path.join(globalDir, "guarded.toml");
  const readOnlyWorkspace = path.join(workspaceDir, "guarded.toml");
  await writeFile(readOnlyGlobal, `${toml("guarded")}# Lanternwatch/Agents/guarded.md\n`);
  await writeFile(readOnlyWorkspace, `${toml("guarded")}# Lanternwatch/Agents/guarded.md\n`);
  applyCatalogAction(dependencies, { action: "scan" });
  assert.throws(() => applyCatalogAction(dependencies, { action: "resolve-collision", sourcePath: readOnlyWorkspace, resolution: "disable" }), /read-only/i);
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
