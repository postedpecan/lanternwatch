import type { AgentMetric, CatalogAgent } from "@/lib/guild-contract";

export const ROSTER_SECTION_ORDER = ["global", "lanternwatch", "workspace", "imported-workspace", "external"] as const;

export type RosterSectionKey = (typeof ROSTER_SECTION_ORDER)[number];

export type RosterDefinition = {
  agent: CatalogAgent;
  metric: AgentMetric;
};

export type RosterSection = {
  /** Stable source-aware key for React and heading associations. */
  id: string;
  key: RosterSectionKey;
  definitions: RosterDefinition[];
  /** Present only for one-time imported workspace snapshots. */
  workspacePath?: string;
};

function emptyMetric(agent: string): AgentMetric {
  return { agent, runCount: 0, trackedActiveSeconds: 0, activeInstances: 0, lastActivityAt: null, lastActivityMessage: null };
}

export function rosterSectionKey(agent: CatalogAgent): RosterSectionKey {
  // `origin` describes where the definition physically lives. It takes
  // precedence over the execution scope and classification tags: a global
  // definition marked for LanternWatch remains in the Global roster section.
  switch (agent.origin) {
    case "global": return "global";
    case "lanternwatch": return "lanternwatch";
    case "workspace":
    case "registered-workspace": return "workspace";
    case "imported-workspace": return "imported-workspace";
    case "external": return "external";
  }

  // Older saved snapshots may not include `origin`, so retain the prior
  // scope-based placement as a backwards-compatible fallback.
  if (agent.scope === "external") return "external";
  if (agent.scope === "lanternwatch") return "lanternwatch";
  if (agent.scope === "workspace") return "workspace";
  return "global";
}

function normalizedWorkspacePath(workspacePath: string) {
  return workspacePath.trim().replaceAll("/", "\\").replace(/\\+$/, "").toLocaleLowerCase();
}

function sortedDefinitions(definitions: RosterDefinition[]) {
  return [...definitions].sort((a, b) => b.metric.trackedActiveSeconds - a.metric.trackedActiveSeconds || a.agent.name.localeCompare(b.agent.name) || a.agent.sourcePath.localeCompare(b.agent.sourcePath));
}

/** The imported workspace's folder name is the visual section label. */
export function rosterSectionTitle(section: RosterSection) {
  if (!section.workspacePath) return section.key;
  const segments = section.workspacePath.replaceAll("/", "\\").replace(/\\+$/, "").split("\\").filter(Boolean);
  return segments.at(-1) ?? section.workspacePath;
}

export function partitionRosterDefinitions(agents: CatalogAgent[], metrics: Record<string, AgentMetric>): RosterSection[] {
  const sections = new Map<RosterSectionKey, RosterDefinition[]>(ROSTER_SECTION_ORDER.map((key) => [key, []]));
  const importedWorkspaces = new Map<string, { workspacePath?: string; definitions: RosterDefinition[] }>();
  for (const agent of agents) {
    const definition = { agent, metric: metrics[agent.name.toLowerCase()] ?? emptyMetric(agent.name) };
    if (rosterSectionKey(agent) === "imported-workspace") {
      const workspacePath = agent.workspacePath?.trim();
      const key = workspacePath ? normalizedWorkspacePath(workspacePath) : "unattributed-imported-workspace";
      const workspace = importedWorkspaces.get(key) ?? { workspacePath, definitions: [] };
      workspace.definitions.push(definition);
      importedWorkspaces.set(key, workspace);
      continue;
    }
    sections.get(rosterSectionKey(agent))?.push(definition);
  }

  const sourceSections = ROSTER_SECTION_ORDER
    .filter((key) => key !== "imported-workspace")
    .map((key) => ({ id: key, key, definitions: sections.get(key) ?? [] }))
    // These two primary sources are stable landmarks in the roster. Keeping
    // their sections when empty makes the source boundary visible before a
    // scan discovers a definition and prevents either source being absorbed
    // into a same-named definition elsewhere.
    .filter((section) => section.definitions.length > 0 || section.key === "global" || section.key === "lanternwatch")
    .map((section) => ({ ...section, definitions: sortedDefinitions(section.definitions) }));
  const importedSections = [...importedWorkspaces.entries()]
    .sort(([leftKey, left], [rightKey, right]) => rosterSectionTitle({ id: leftKey, key: "imported-workspace", workspacePath: left.workspacePath, definitions: [] }).localeCompare(rosterSectionTitle({ id: rightKey, key: "imported-workspace", workspacePath: right.workspacePath, definitions: [] })) || leftKey.localeCompare(rightKey))
    .map(([key, workspace]) => ({ id: `imported-workspace-${key}`, key: "imported-workspace" as const, workspacePath: workspace.workspacePath, definitions: sortedDefinitions(workspace.definitions) }));
  const externalIndex = sourceSections.findIndex((section) => section.key === "external");
  const beforeExternal = externalIndex < 0 ? sourceSections : sourceSections.slice(0, externalIndex);
  const afterExternal = externalIndex < 0 ? [] : sourceSections.slice(externalIndex);
  return [...beforeExternal, ...importedSections, ...afterExternal];
}

export function isProtectedRosterDefinition(agent: CatalogAgent) {
  return agent.scope === "external" || agent.origin === "imported-workspace";
}
