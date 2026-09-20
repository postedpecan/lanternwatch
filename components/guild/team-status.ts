import type { RosterDefinition, RosterSection } from "./agent-roster";
import type { CatalogAgent, GuildAgentActivity } from "@/lib/guild-contract";

export type TeamStatusDefinition = RosterDefinition & {
  activities: GuildAgentActivity[];
};

export type TeamStatusSection = Omit<RosterSection, "definitions"> & {
  definitions: TeamStatusDefinition[];
};

export type TeamStatusModel = {
  sections: TeamStatusSection[];
  unresolvedActivities: GuildAgentActivity[];
};

/**
 * A live activity belongs to a catalog card only when the server's resolved
 * presentation path exactly identifies that definition. Names are not a safe
 * identity because Codex permits same-named definitions in different sources.
 */
export function associateTeamStatusActivities(
  rosterSections: RosterSection[],
  agents: CatalogAgent[],
  activities: GuildAgentActivity[],
): TeamStatusModel {
  const activityBySourcePath = new Map<string, GuildAgentActivity[]>();
  for (const activity of activities) {
    const sourcePath = activity.presentation?.sourcePath;
    if (!sourcePath) continue;
    const rows = activityBySourcePath.get(sourcePath) ?? [];
    rows.push(activity);
    activityBySourcePath.set(sourcePath, rows);
  }

  const sections = rosterSections.map((section) => ({
    ...section,
    definitions: section.definitions.map((definition) => ({
      ...definition,
      activities: activityBySourcePath.get(definition.agent.sourcePath) ?? [],
    })),
  }));
  const catalogSourcePaths = new Set(agents.map((agent) => agent.sourcePath));

  return {
    sections,
    // Preserve the incoming activity order for the fallback just as for each
    // card. An unresolved presentation must never be guessed from its name.
    unresolvedActivities: activities.filter((activity) => {
      const sourcePath = activity.presentation?.sourcePath;
      return !sourcePath || !catalogSourcePaths.has(sourcePath);
    }),
  };
}
