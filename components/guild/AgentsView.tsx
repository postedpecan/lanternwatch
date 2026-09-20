"use client";

import { AgentCatalogPanel } from "@/components/guild/AgentCatalogPanel";
import { useGuildData } from "@/components/guild/GuildDataContext";
import { AGENT_COPY } from "@/components/guild/agent-copy";

export function AgentsView() {
  const { agentCatalog, agentCatalogSettings, agentMetrics, agentWorkspacePaths, agentActivities, projects, selectedProjectId, statistics } = useGuildData();
  const selectedProject = projects.find((project) => project.id === selectedProjectId);

  return <section className="agent-management-page">
    <h1 className="sr-only">{AGENT_COPY.page.title}</h1>
    <AgentCatalogPanel
      agents={agentCatalog}
      settings={agentCatalogSettings}
      metrics={agentMetrics}
      workspacePaths={agentWorkspacePaths}
      activities={agentActivities}
      statistics={statistics}
      projectScopeLabel={selectedProject ? AGENT_COPY.page.filterProject(selectedProject.name) : AGENT_COPY.page.filterAll}
      hasProjectFilter={Boolean(selectedProject)}
    />
  </section>;
}
