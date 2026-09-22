import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const UI_FILES = ["AgentsView.tsx", "AgentCatalogPanel.tsx"];

test("Agents UI routes product copy through the source-owned copy module", async () => {
  const sources = await Promise.all(UI_FILES.map((file) => readFile(new URL(`./${file}`, import.meta.url), "utf8")));

  for (const source of sources) {
    assert.match(source, /agent-copy/);
  }

  for (const retiredCopy of ["uncommitted changes", "read-only after commit", "workspace is clean", "editable now"]) {
    assert.ok(!sources.some((source) => source.toLowerCase().includes(retiredCopy)), retiredCopy);
  }

  // These labels are deliberately checked here so new UI labels are added to
  // agent-copy.ts instead of being embedded in a rendering component.
  for (const label of ["Recorded agent workload", "Run-status context", "Live occupancy", "Agent roster", "Workspace sources", "Tokens"]) {
    assert.ok(!sources.some((source) => source.includes(`>${label}<`) || source.includes(`\"${label}\"`)), label);
  }

  const panel = sources[UI_FILES.indexOf("AgentCatalogPanel.tsx")];
  for (const action of ["register-workspace", "unregister-workspace", "import-workspace-snapshot", "remove-workspace-snapshot"]) {
    assert.match(panel, new RegExp(`action: \"${action}\"`), action);
  }

  assert.ok(panel.indexOf('className="agent-card-details"') < panel.indexOf('className="agent-card-controls"'), "agent metadata must be stacked before controls");
  assert.doesNotMatch(panel, /agent\.readOnly/, "editability must not depend on a worktree or read-only flag");

  // Runtime values, class names, and input values remain allowed. Static
  // alphabetic JSX text belongs in agent-copy.ts so it cannot create a second
  // product-copy source in an active Agents UI component.
  for (const source of sources) {
    // Arrow functions in JSX attributes contain `=>`, whose `>` is not a tag
    // boundary. Mask it before the lightweight static-text guard runs.
    const withoutJsxArrows = source.replaceAll("=>", "__ARROW__");
    assert.doesNotMatch(
      withoutJsxArrows,
      /<(?:p|span|label|legend|strong|small|button)\b[^>]*>\s*[A-Za-z]/,
      "Move static Agents UI text into agent-copy.ts before rendering it",
    );
  }
});

test("roster renders stable source sections, distinct same-name cards, and workspace sections", async () => {
  const { partitionRosterDefinitions, rosterSectionKey } = await import("./agent-roster.ts");
  const agent = (name, scope, extras = {}) => ({
    id: `${scope}-${name}-${extras.origin ?? "default"}`,
    name,
    description: `${name} definition`,
    scope,
    sourcePath: `D:\\Agents\\${scope}-${name}.toml`,
    enabled: true,
    tags: [],
    collision: false,
    readOnly: false,
    codexReady: true,
    ...extras,
  });
  const agents = [
    // LanternWatch membership is a tag, not a physical source. This mirrors
    // an older marker-classified global definition whose execution scope is
    // still LanternWatch, but whose source must stay in Global.
    agent("same", "lanternwatch", { origin: "global", tags: ["LanternWatch"] }),
    agent("same", "lanternwatch", { origin: "lanternwatch" }),
    agent("zulu", "workspace", { origin: "registered-workspace" }),
    agent("alpha", "workspace", { origin: "registered-workspace" }),
    agent("snapshot", "workspace", { origin: "imported-workspace", workspacePath: "D:\\Work\\Client", readOnly: true, codexReady: false }),
    agent("beta", "workspace", { origin: "imported-workspace", workspacePath: "D:\\Work\\Client", readOnly: true, codexReady: false }),
    agent("archive", "workspace", { origin: "imported-workspace", workspacePath: "D:\\Archive\\Client", readOnly: true, codexReady: false }),
    agent("outside", "external", { readOnly: true, codexReady: false }),
  ];
  const metric = (name, trackedActiveSeconds) => ({ agent: name, runCount: 0, trackedActiveSeconds, activeInstances: 0, lastActivityAt: null, lastActivityMessage: null });
  const sections = partitionRosterDefinitions(agents, { same: metric("same", 20), zulu: metric("zulu", 5), alpha: metric("alpha", 5), snapshot: metric("snapshot", 10), beta: metric("beta", 2) });

  assert.deepEqual(sections.map((section) => section.key), ["global", "lanternwatch", "workspace", "imported-workspace", "imported-workspace", "external"]);
  assert.deepEqual(sections.find((section) => section.key === "global")?.definitions.map((definition) => definition.agent.name), ["same"]);
  const globalDefinition = sections.find((section) => section.key === "global")?.definitions[0]?.agent;
  assert.ok(globalDefinition, "the Global section contains the marker-tagged global definition");
  assert.equal(rosterSectionKey(globalDefinition), "global", "physical global origin overrides a LanternWatch classification");
  assert.deepEqual(globalDefinition?.tags, ["LanternWatch"], "the LanternWatch membership tag remains visible on the Global definition");
  assert.deepEqual(sections.find((section) => section.key === "lanternwatch")?.definitions.map((definition) => definition.agent.name), ["same"]);
  assert.deepEqual(sections.find((section) => section.key === "workspace")?.definitions.map((definition) => definition.agent.name), ["alpha", "zulu"]);
  const imported = sections.filter((section) => section.key === "imported-workspace");
  assert.equal(imported.length, 2, "each imported workspace has its own roster section");
  assert.deepEqual(imported.map((section) => section.workspacePath), ["D:\\Archive\\Client", "D:\\Work\\Client"], "same folder names remain distinct by their supporting path");
  assert.deepEqual(imported.find((section) => section.workspacePath === "D:\\Work\\Client")?.definitions.map((definition) => definition.agent.name), ["snapshot", "beta"], "workspace entries sort by tracked time before their name");

  const emptySections = partitionRosterDefinitions([], {});
  assert.deepEqual(emptySections.map((section) => section.key), ["global", "lanternwatch"], "Global and LanternWatch headings remain visible before any definitions are discovered");
  assert.ok(emptySections.every((section) => section.definitions.length === 0), "stable empty sections do not fabricate roster cards");

  const panel = await readFile(new URL("./AgentCatalogPanel.tsx", import.meta.url), "utf8");
  assert.match(panel, /function sourceGroup\(agent: CatalogAgent\) \{\s+return AGENT_COPY\.catalog\.group\[rosterSectionKey\(agent\)\];\s+\}/, "the visible source label follows physical roster placement, while tags render separately");
  assert.match(panel, /<i>\{sourceGroup\(agent\)\}<\/i>\{agent\.tags\.map/, "the source label and LanternWatch tag stay distinct UI tokens");
  assert.match(panel, /<section className="agent-roster-section" aria-labelledby=\{titleId\}>/, "each source is rendered as a labelled roster section");
  assert.match(panel, /<h3 id=\{titleId\}>\{title\}<\/h3>/, "each roster section exposes its heading");
  assert.match(panel, /<div className="agent-roster" role="list">/, "each source section owns its own card list");
});

test("Team Status keeps source cards separate and leaves same-name unresolved activity unattributed", async () => {
  const [{ associateTeamStatusActivities }, { partitionRosterDefinitions }] = await Promise.all([import("./team-status.ts"), import("./agent-roster.ts")]);
  const agent = (name, origin, sourcePath, extras = {}) => ({
    id: sourcePath,
    name,
    description: `${name} definition`,
    scope: origin === "lanternwatch" ? "lanternwatch" : "global",
    origin,
    sourcePath,
    enabled: true,
    tags: [],
    collision: false,
    readOnly: false,
    codexReady: true,
    ...extras,
  });
  const metric = (name) => ({ agent: name, runCount: 0, trackedActiveSeconds: 0, activeInstances: 0, lastActivityAt: null, lastActivityMessage: null });
  const activity = (id, name, sourcePath) => ({
    id,
    agentInstanceId: id,
    agent: name,
    projectId: "project",
    projectName: "Project",
    runId: "run",
    status: "working",
    message: `${id} activity`,
    startedAt: "2026-09-19T00:00:00.000Z",
    updatedAt: "2026-09-19T00:00:00.000Z",
    durationSeconds: 1,
    presentation: sourcePath ? { sourcePath, scope: "global", tags: [], unresolved: false } : { tags: [], unresolved: true },
  });
  // Catalog ids are case-insensitive source-path hashes, so distinct paths
  // may deliberately collide. Source path remains the definition identity.
  const duplicatedCatalogId = "06da645c8b4fadb0340816e03c21b96f";
  const globalDefinition = agent("same", "global", "C:\\Users\\User\\.codex\\agents\\same.toml", { id: duplicatedCatalogId, tags: ["LanternWatch"] });
  const lanternwatchDefinition = agent("same", "lanternwatch", "D:\\Work\\Lantern Watch\\.codex\\agents\\same.toml", { id: duplicatedCatalogId });
  const alphaSnapshot = agent("alpha", "imported-workspace", "D:\\Imported\\Alpha\\.codex\\agents\\alpha.toml", { workspacePath: "D:\\Imported\\Alpha" });
  const zuluSnapshot = agent("zulu", "imported-workspace", "D:\\Imported\\Zulu\\.codex\\agents\\zulu.toml", { workspacePath: "D:\\Imported\\Zulu" });
  const definitions = [globalDefinition, lanternwatchDefinition, zuluSnapshot, alphaSnapshot];
  const model = associateTeamStatusActivities(
    partitionRosterDefinitions(definitions, { same: metric("same"), alpha: metric("alpha"), zulu: metric("zulu") }),
    definitions,
    [activity("global-row", "same", globalDefinition.sourcePath), activity("global-row-later", "same", globalDefinition.sourcePath), activity("lanternwatch-row", "same", lanternwatchDefinition.sourcePath), activity("unresolved-row", "same")],
  );

  assert.deepEqual(model.sections.map((section) => section.id), ["global", "lanternwatch", "imported-workspace-d:\\imported\\alpha", "imported-workspace-d:\\imported\\zulu"]);
  assert.deepEqual(model.sections[0].definitions[0].agent.tags, ["LanternWatch"], "a Global definition retains its LanternWatch tag");
  assert.deepEqual(model.sections[0].definitions[0].activities.map((row) => row.id), ["global-row", "global-row-later"], "exact-path activity ordering is preserved");
  assert.deepEqual(model.sections[1].definitions[0].activities.map((row) => row.id), ["lanternwatch-row"], "same-named LanternWatch activity stays on its own card");
  assert.deepEqual(model.unresolvedActivities.map((row) => row.id), ["unresolved-row"], "unresolved same-name activity is not attributed to either definition");

  const liveView = await readFile(new URL("./LiveView.tsx", import.meta.url), "utf8");
  assert.equal(globalDefinition.id, lanternwatchDefinition.id, "the fixture exercises a duplicate catalog id");
  assert.notEqual(globalDefinition.sourcePath, lanternwatchDefinition.sourcePath, "the fixture preserves distinct definition paths");
  assert.match(liveView, /partitionRosterDefinitions\(catalogAgents, agentMetrics\)/, "Team Status uses the shared source partition helper");
  assert.match(liveView, /Source unresolved/, "unmatched activity has a truthful fallback treatment");
  assert.match(liveView, /const definitionKey = agent\.sourcePath;/, "agent-instance cards use the source path as their definition key");
  assert.match(liveView, /const titleId = `agentGroup-\$\{encodeURIComponent\(definitionKey\)\}`;/, "agent-instance headings encode the same source-aware identity for valid IDREFs");
  assert.match(liveView, /key=\{definitionKey\} aria-labelledby=\{titleId\}/, "agent-instance card keys and heading associations stay unique together");
  assert.match(liveView, /className=\{`catalog-agent\$\{agent\.collision \? " collision" : ""\}`\} role="listitem" key=\{agent\.sourcePath\}/, "catalog definitions use their source path as the list key");
  const catalogPanel = await readFile(new URL("./AgentCatalogPanel.tsx", import.meta.url), "utf8");
  assert.match(catalogPanel, /group\.definitions\.map\(\(agent\) => <div key=\{agent\.sourcePath\} role="listitem">/, "collision resolution keeps duplicate-id definitions separate");
  assert.match(catalogPanel, /<AgentRosterCard key=\{definition\.agent\.sourcePath\}/, "roster cards use source-path identity rather than the duplicate catalog hash");
  assert.match(liveView, /const contributionKey = mode === "live" \? \(agent as CatalogAgent\)\.sourcePath : agent\.id;/, "Role activity uses a catalog definition's source path as its live key and preserves the demo id key");
  assert.match(liveView, /<span key=\{contributionKey\} className=\{`contribution-cell \$\{status\}`\}/, "Role activity renders with the mode-specific stable key");
});
