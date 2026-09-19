"use client";

import { AgentCatalogPanel } from "@/components/guild/AgentCatalogPanel";
import { useGuildData } from "@/components/guild/GuildDataContext";

export function AgentsView() {
  const { agentCatalog, agentCatalogSettings, agentMetrics, agentWorkspacePaths } = useGuildData();

  return <main className="agent-management-page">
    <AgentCatalogPanel agents={agentCatalog} settings={agentCatalogSettings} metrics={agentMetrics} workspacePaths={agentWorkspacePaths} />
  </main>;
}
