"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import type { AgentMetric, CatalogAgent, CatalogResponse, CatalogSettings, CatalogWorkspaceSnapshot, GuildAgentActivity, GuildStatistics } from "@/lib/guild-contract";
import { formatAge, formatElapsed, formatMoment, titleCase } from "@/lib/guild-format";
import { AGENT_COPY } from "@/components/guild/agent-copy";
import { isProtectedRosterDefinition, partitionRosterDefinitions, rosterSectionKey, rosterSectionTitle, type RosterDefinition, type RosterSection } from "@/components/guild/agent-roster";

type AgentGroup = { key: string; name: string; definitions: CatalogAgent[]; metric: AgentMetric };
type CollisionResolution = "tag" | "rename" | "disable";
type ExtendedCatalogAgent = CatalogAgent & { copyDestination?: string; sourceGroup?: string; importedWorkspacePath?: string };

function isEditableProjectDefinition(agent: CatalogAgent) {
  return !isProtectedRosterDefinition(agent);
}

function definitionProtectionLabel(agent: CatalogAgent) {
  return agent.origin === "imported-workspace" ? AGENT_COPY.protection.snapshot : AGENT_COPY.protection.external;
}

function sourceGroup(agent: CatalogAgent) {
  return AGENT_COPY.catalog.group[rosterSectionKey(agent)];
}

function copyDestination(agent: CatalogAgent) {
  const extended = agent as ExtendedCatalogAgent;
  const destinations = agent.copyDestinations?.map((destination) => destination.path).filter(Boolean) ?? [];
  return destinations.join(AGENT_COPY.catalog.detailSeparator) || extended.copyDestination || AGENT_COPY.catalog.copyDestination[agent.scope];
}

function emptyMetric(agent: string): AgentMetric {
  return { agent, runCount: 0, trackedActiveSeconds: 0, activeInstances: 0, lastActivityAt: null, lastActivityMessage: null };
}

function groupAgents(agents: CatalogAgent[], metrics: Record<string, AgentMetric>) {
  const groups = new Map<string, AgentGroup>();
  for (const agent of agents) {
    const key = agent.name.toLowerCase();
    const group = groups.get(key) ?? { key, name: agent.name, definitions: [], metric: metrics[key] ?? emptyMetric(agent.name) };
    group.definitions.push(agent);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.metric.runCount - a.metric.runCount || b.metric.trackedActiveSeconds - a.metric.trackedActiveSeconds || a.name.localeCompare(b.name));
}

function AgentTags({ agent }: { agent: CatalogAgent }) {
  return <span className="agent-tags"><i>{sourceGroup(agent)}</i>{agent.tags.map((tag) => <i key={tag}>{tag}</i>)}</span>;
}

function Modal({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);
  return <dialog ref={dialog} className="agent-modal" aria-label={title} onCancel={(event) => { event.preventDefault(); onClose(); }} onClose={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="agent-modal-head"><h2>{title}</h2><button type="button" className="icon-btn" onClick={onClose} aria-label={`${AGENT_COPY.modal.close} ${title}`} title={AGENT_COPY.modal.close}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" /></svg></button></div>
    {children}
  </dialog>;
}

function CreateAgentModal({ open, onClose, workspacePaths, request }: { open: boolean; onClose: () => void; workspacePaths: string[]; request: (body: unknown) => Promise<boolean> }) {
  const [scope, setScope] = useState<"global" | "workspace">("global");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const saved = await request({ action: "create", scope, workspacePath: scope === "workspace" ? data.get("workspacePath") : undefined, name: data.get("name"), description: data.get("description"), developerInstructions: data.get("instructions"), tags: String(data.get("tags") || "").split(",").map((tag) => tag.trim()).filter(Boolean) });
    if (saved) { event.currentTarget.reset(); setScope("global"); onClose(); }
  };
  return <Modal open={open} title={AGENT_COPY.modal.createTitle} onClose={onClose}>
    <form className="agent-modal-form" onSubmit={submit}>
      <label>{AGENT_COPY.modal.destination}<select value={scope} onChange={(event) => setScope(event.target.value as "global" | "workspace")}><option value="global">{AGENT_COPY.modal.globalAgents}</option><option value="workspace">{AGENT_COPY.modal.workspaceAgents}</option></select></label>
      {scope === "workspace" && <label>{AGENT_COPY.modal.workspace}<select name="workspacePath" required>{workspacePaths.map((workspace) => <option key={workspace} value={workspace}>{workspace}</option>)}</select></label>}
      <label>{AGENT_COPY.modal.name}<input name="name" required pattern="[a-z][a-z0-9_-]{0,63}" placeholder={AGENT_COPY.modal.namePlaceholder} autoComplete="off" /></label>
      <label>{AGENT_COPY.modal.description}<input name="description" required maxLength={500} /></label>
      <label>{AGENT_COPY.modal.instructions}<textarea name="instructions" required rows={5} /></label>
      <label>{AGENT_COPY.modal.customTags}<input name="tags" placeholder={AGENT_COPY.modal.tagsPlaceholder} /></label>
      <div className="agent-modal-actions"><button type="button" onClick={onClose}>{AGENT_COPY.modal.cancel}</button><button className="primary-btn" type="submit">{AGENT_COPY.modal.create}</button></div>
    </form>
  </Modal>;
}

function RegisterAgentModal({ open, onClose, request }: { open: boolean; onClose: () => void; request: (body: unknown) => Promise<boolean> }) {
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const sourcePath = String(new FormData(event.currentTarget).get("sourcePath") || "");
    if (await request({ action: "register", sourcePath })) { event.currentTarget.reset(); onClose(); }
  };
  return <Modal open={open} title={AGENT_COPY.modal.registerTitle} onClose={onClose}>
    <form className="agent-modal-form" onSubmit={submit}>
      <p className="modal-note">{AGENT_COPY.modal.registerNote}</p>
      <label>{AGENT_COPY.modal.path}<input name="sourcePath" required placeholder={AGENT_COPY.modal.pathPlaceholder} autoComplete="off" /></label>
      <div className="agent-modal-actions"><button type="button" onClick={onClose}>{AGENT_COPY.modal.cancel}</button><button className="primary-btn" type="submit">{AGENT_COPY.modal.register}</button></div>
    </form>
  </Modal>;
}

function ImportAgentModal({ agent, open, onClose, workspacePaths, request }: { agent: CatalogAgent | null; open: boolean; onClose: () => void; workspacePaths: string[]; request: (body: unknown) => Promise<boolean> }) {
  const [scope, setScope] = useState<"global" | "workspace">("global");
  if (!agent) return null;
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (await request({ action: "import", sourcePath: agent.sourcePath, scope, workspacePath: scope === "workspace" ? data.get("workspacePath") : undefined })) { setScope("global"); onClose(); }
  };
  return <Modal open={open} title={`${AGENT_COPY.modal.addToCodex}: ${agent.name}`} onClose={onClose}>
    <form className="agent-modal-form" onSubmit={submit}>
      <p className="modal-note">{AGENT_COPY.modal.importNote}</p>
      <label>{AGENT_COPY.modal.destination}<select value={scope} onChange={(event) => setScope(event.target.value as "global" | "workspace")}><option value="global">{AGENT_COPY.modal.globalAgents}</option><option value="workspace">{AGENT_COPY.modal.workspaceAgents}</option></select></label>
      {scope === "workspace" && <label>{AGENT_COPY.modal.workspace}<select name="workspacePath" required>{workspacePaths.map((workspace) => <option key={workspace} value={workspace}>{workspace}</option>)}</select></label>}
      <div className="agent-modal-actions"><button type="button" onClick={onClose}>{AGENT_COPY.modal.cancel}</button><button className="primary-btn" type="submit">{AGENT_COPY.modal.addToCodex}</button></div>
    </form>
  </Modal>;
}

function SettingsModal({ open, onClose, settings, request }: { open: boolean; onClose: () => void; settings: CatalogSettings; request: (body: unknown) => Promise<boolean> }) {
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (await request({ action: "settings", settings: { discoveryMode: data.get("discoveryMode") } })) onClose();
  };
  return <Modal open={open} title={AGENT_COPY.modal.settingsTitle} onClose={onClose}>
    <form className="agent-modal-form" onSubmit={submit}>
      <label>{AGENT_COPY.modal.discovery}<select name="discoveryMode" defaultValue={settings.discoveryMode}><option value="manual">{AGENT_COPY.modal.manual}</option><option value="automatic-once">{AGENT_COPY.modal.automaticOnce}</option></select></label>
      <p className="modal-note">{AGENT_COPY.modal.settingsNote}</p>
      <div className="agent-modal-actions"><button type="button" onClick={onClose}>{AGENT_COPY.modal.cancel}</button><button className="primary-btn" type="submit">{AGENT_COPY.modal.saveSettings}</button></div>
    </form>
  </Modal>;
}

function ManageAgentModal({ agent, open, onClose, request }: { agent: CatalogAgent | null; open: boolean; onClose: () => void; request: (body: unknown) => Promise<boolean> }) {
  if (!agent) return null;
  const saveTags = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (await request({ action: "tags", sourcePath: agent.sourcePath, tags: String(data.get("tags") || "").split(",").map((tag) => tag.trim()).filter(Boolean) })) onClose();
  };
  const rename = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (await request({ action: "rename", sourcePath: agent.sourcePath, name: data.get("name") })) onClose();
  };
  return <Modal open={open} title={AGENT_COPY.modal.manage(agent.name)} onClose={onClose}>
    <div className="agent-source"><span>{agent.enabled ? AGENT_COPY.modal.enabled : AGENT_COPY.modal.disabled}</span><code title={agent.sourcePath}>{agent.sourcePath}</code></div>
    <form className="agent-modal-form" onSubmit={saveTags}><label>{AGENT_COPY.modal.customTags}<input name="tags" defaultValue={agent.tags.join(", ")} /></label><button type="submit">{AGENT_COPY.modal.saveTags}</button></form>
    <form className="agent-modal-form" onSubmit={rename}><label>{AGENT_COPY.modal.rename}<input name="name" defaultValue={agent.name} required pattern="[a-z][a-z0-9_-]{0,63}" /></label><button type="submit">{AGENT_COPY.modal.rename}</button></form>
    <div className="agent-modal-actions"><button type="button" onClick={onClose}>{AGENT_COPY.modal.close}</button><button type="button" onClick={() => void request({ action: "toggle", sourcePath: agent.sourcePath, enabled: !agent.enabled }).then((saved) => { if (saved) onClose(); })}>{agent.enabled ? AGENT_COPY.modal.turnOff : AGENT_COPY.modal.turnOn}</button></div>
  </Modal>;
}

function CollisionResolutionModal({ group, open, onClose, request, busy }: { group: AgentGroup | null; open: boolean; onClose: () => void; request: (body: unknown) => Promise<boolean>; busy: boolean }) {
  const mutableDefinitions = group?.definitions.filter(isEditableProjectDefinition) ?? [];
  const hasManagedDefinition = mutableDefinitions.length > 0;
  const [sourcePath, setSourcePath] = useState("");
  const [resolution, setResolution] = useState<CollisionResolution>("tag");
  const [name, setName] = useState("");

  useEffect(() => {
    if (!open || !group) return;
    const firstMutableDefinition = group.definitions.find(isEditableProjectDefinition);
    setSourcePath(firstMutableDefinition?.sourcePath ?? "");
    setResolution("tag");
    setName(group.name);
  }, [group, open]);

  if (!group) return null;
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!hasManagedDefinition) return;
    const action = {
      action: "resolve-collision",
      sourcePath,
      resolution,
      ...(resolution === "tag" ? { tags: ["duplicate-source"] } : {}),
      ...(resolution === "rename" ? { name } : {}),
    };
    if (await request(action)) onClose();
  };

  return <Modal open={open} title={AGENT_COPY.modal.resolve(group.name)} onClose={onClose}>
    <form className="agent-modal-form collision-resolution-form" onSubmit={submit} aria-busy={busy}>
      <p className="modal-note">{AGENT_COPY.modal.collisionNote}</p>
      <div className="collision-sources" role="list" aria-label={AGENT_COPY.modal.duplicateDefinitions(group.name)}>
        {group.definitions.map((agent) => <div key={agent.sourcePath} role="listitem"><AgentTags agent={agent} /><code title={agent.sourcePath}>{agent.sourcePath}</code>{isEditableProjectDefinition(agent) && <span>{AGENT_COPY.modal.canChange}</span>}</div>)}
      </div>
      {hasManagedDefinition ? <label>{AGENT_COPY.modal.definitionToResolve}<select value={sourcePath} onChange={(event) => setSourcePath(event.target.value)} disabled={busy}>{mutableDefinitions.map((agent) => <option key={agent.sourcePath} value={agent.sourcePath}>{agent.sourcePath}</option>)}</select></label> : <p className="catalog-error" role="status">{AGENT_COPY.modal.noManagedDefinition}</p>}
      <fieldset className="collision-resolution-options" disabled={busy || !hasManagedDefinition}>
        <legend>{AGENT_COPY.modal.chooseResolution}</legend>
        <label className="resolution-choice"><input type="radio" name="collisionResolution" value="tag" checked={resolution === "tag"} onChange={() => setResolution("tag")} autoFocus /><span><strong>{AGENT_COPY.modal.addTag}</strong><small>{AGENT_COPY.modal.addTagDescription}</small></span></label>
        <label className="resolution-choice"><input type="radio" name="collisionResolution" value="rename" checked={resolution === "rename"} onChange={() => setResolution("rename")} /><span><strong>{AGENT_COPY.modal.rename}</strong><small>{AGENT_COPY.modal.renameDescription}</small></span></label>
        {resolution === "rename" && <label className="resolution-name">{AGENT_COPY.modal.newName}<input value={name} onChange={(event) => setName(event.target.value)} required pattern="[a-z][a-z0-9_-]{0,63}" autoComplete="off" /></label>}
        <label className="resolution-choice"><input type="radio" name="collisionResolution" value="disable" checked={resolution === "disable"} onChange={() => setResolution("disable")} /><span><strong>{AGENT_COPY.modal.disable}</strong><small>{AGENT_COPY.modal.disableDescription}</small></span></label>
      </fieldset>
      <div className="agent-modal-actions"><button type="button" onClick={onClose} disabled={busy}>{AGENT_COPY.modal.cancel}</button><button className="primary-btn" type="submit" disabled={busy || !hasManagedDefinition}>{busy ? AGENT_COPY.modal.resolving : resolution === "tag" ? AGENT_COPY.modal.addTag : resolution === "rename" ? AGENT_COPY.modal.renameDefinition : AGENT_COPY.modal.disableDefinition}</button></div>
    </form>
  </Modal>;
}

function AgentDashboard({ groups, activities, statistics, scopeLabel, hasProjectFilter }: { groups: AgentGroup[]; activities: GuildAgentActivity[]; statistics: GuildStatistics; scopeLabel: string; hasProjectFilter: boolean }) {
  const definitions = groups.flatMap((group) => group.definitions);
  const active = groups.filter((group) => group.metric.activeInstances > 0).length;
  const disabled = definitions.filter((agent) => !agent.enabled).length;
  const external = definitions.filter((agent) => agent.scope === "external").length;
  const lanternwatch = definitions.filter((agent) => agent.scope === "lanternwatch").length;
  const unresolved = groups.filter((group) => group.definitions.filter((agent) => agent.codexReady && agent.enabled).length > 1).length;
  const totalRuns = Number.isFinite(statistics?.totalRuns) ? statistics.totalRuns : groups.reduce((total, group) => total + group.metric.runCount, 0);
  const trackedTime = groups.reduce((total, group) => total + group.metric.trackedActiveSeconds, 0);
  const workloads = [...groups].filter((group) => group.metric.trackedActiveSeconds > 0).sort((a, b) => b.metric.trackedActiveSeconds - a.metric.trackedActiveSeconds || b.metric.runCount - a.metric.runCount);
  const highestWorkload = workloads[0]?.metric.trackedActiveSeconds ?? 0;
  const statuses = [
    { id: "complete", label: AGENT_COPY.dashboard.completed, value: statistics?.completedRuns ?? 0 },
    { id: "interrupted", label: AGENT_COPY.dashboard.interrupted, value: statistics?.interruptedRuns ?? 0 },
    { id: "active", label: AGENT_COPY.dashboard.active, value: statistics?.activeRuns ?? 0 },
    { id: "stalled", label: AGENT_COPY.dashboard.stalled, value: statistics?.stalledRuns ?? 0 },
  ];
  const largestStatus = Math.max(...statuses.map((status) => status.value), 0);
  return <section className="agent-dashboard" aria-labelledby="agentDashboardTitle">
    <div className="section-heading"><div><h2 id="agentDashboardTitle">{AGENT_COPY.dashboard.title}</h2></div><span title={scopeLabel}>{hasProjectFilter ? AGENT_COPY.dashboard.scopeProject : AGENT_COPY.dashboard.scopeAll}</span></div>
    <div className="agent-stat-grid">
      <article><span>{AGENT_COPY.dashboard.definitions}</span><strong>{definitions.length}</strong><small>{definitions.filter((agent) => agent.codexReady).length} {AGENT_COPY.dashboard.codexReady}{AGENT_COPY.catalog.detailSeparator}{external} {AGENT_COPY.dashboard.external}</small></article>
      <article><span>{AGENT_COPY.dashboard.currentOccupancy}</span><strong>{active} {AGENT_COPY.dashboard.active.toLowerCase()}</strong><small>{disabled} {AGENT_COPY.dashboard.disabled}{AGENT_COPY.catalog.detailSeparator}{lanternwatch} {AGENT_COPY.dashboard.lanternwatch}</small></article>
      <article><span>{AGENT_COPY.dashboard.trackedWork}</span><strong>{AGENT_COPY.dashboard.runs(totalRuns)}</strong><small>{formatElapsed(trackedTime)} {AGENT_COPY.dashboard.lifecycleTime}</small></article>
      <article><span>{AGENT_COPY.dashboard.unresolvedSources}</span><strong>{unresolved}</strong><small>{AGENT_COPY.dashboard.sameName}</small></article>
    </div>
    <div className="agent-operations-grid">
      <article className="agent-chart-card"><div className="agent-chart-head"><div><h3>{AGENT_COPY.dashboard.workload}</h3><p>{AGENT_COPY.dashboard.workloadDescription}</p></div><span>{scopeLabel}</span></div>
        {workloads.length ? <div className="workload-chart" role="list" aria-label={AGENT_COPY.dashboard.workload}>{workloads.map((group) => { const width = Math.max(5, Math.round((group.metric.trackedActiveSeconds / highestWorkload) * 100)); return <div className="workload-row" role="listitem" key={group.key}><strong title={group.name}>{titleCase(group.name)}</strong><div className="workload-track" aria-label={`${titleCase(group.name)}: ${formatElapsed(group.metric.trackedActiveSeconds)}`}><i style={{ "--workload-width": `${width}%` } as CSSProperties} /></div><span>{formatElapsed(group.metric.trackedActiveSeconds)}</span><small>{AGENT_COPY.dashboard.runs(group.metric.runCount)}{AGENT_COPY.catalog.detailSeparator}{AGENT_COPY.dashboard.activeInstances(group.metric.activeInstances)}</small></div>; })}</div> : <p className="chart-empty">{AGENT_COPY.dashboard.noWorkload}</p>}
      </article>
      <article className="agent-chart-card"><div className="agent-chart-head"><div><h3>{AGENT_COPY.dashboard.statusBreakdown}</h3><p>{AGENT_COPY.dashboard.statusDescription}</p></div></div>
        {largestStatus ? <div className="status-breakdown" role="list" aria-label={AGENT_COPY.dashboard.statusBreakdown}>{statuses.map((status) => <div role="listitem" key={status.id} className={`status-breakdown-row ${status.id}`}><span>{status.label}</span><div aria-label={`${status.label}: ${status.value}`}><i style={{ "--status-width": `${Math.round((status.value / largestStatus) * 100)}%` } as CSSProperties} /></div><strong>{status.value}</strong></div>)}</div> : <p className="chart-empty">{AGENT_COPY.dashboard.noRunStatus}</p>}
      </article>
    </div>
    <section className="occupancy-strip" aria-labelledby="occupancyTitle"><div><h3 id="occupancyTitle">{AGENT_COPY.dashboard.occupancy}</h3><p>{AGENT_COPY.dashboard.occupancyDescription}</p></div>{activities.length ? <div className="occupancy-items" role="list">{activities.map((activity) => <article role="listitem" key={activity.id}><span className={`occupancy-status ${activity.status}`}>{activity.status === "queued" ? AGENT_COPY.dashboard.queued : AGENT_COPY.dashboard.working}</span><strong title={activity.agent}>{titleCase(activity.agent)}</strong><small><b>{AGENT_COPY.dashboard.project}</b> <span title={activity.projectName}>{activity.projectName}</span></small><small><b>{AGENT_COPY.dashboard.elapsed}</b> {formatElapsed(activity.durationSeconds)}</small></article>)}</div> : <p className="chart-empty">{AGENT_COPY.dashboard.noOccupancy}</p>}</section>
  </section>;
}

function WorkspaceSourcesModal({ open, onClose, workspacePaths, workspaceSnapshots, request, busy }: { open: boolean; onClose: () => void; workspacePaths: string[]; workspaceSnapshots: CatalogWorkspaceSnapshot[]; request: (body: unknown) => Promise<boolean>; busy: boolean }) {
  const [workspacePath, setWorkspacePath] = useState("");
  const [snapshotPath, setSnapshotPath] = useState("");
  const registerWorkspace = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const path = workspacePath.trim();
    if (path && await request({ action: "register-workspace", workspacePath: path })) setWorkspacePath("");
  };
  const importSnapshot = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const path = snapshotPath.trim();
    if (path && await request({ action: "import-workspace-snapshot", workspacePath: path })) setSnapshotPath("");
  };
  const reimporting = workspaceSnapshots.some((snapshot) => snapshot.workspacePath.toLocaleLowerCase() === snapshotPath.trim().toLocaleLowerCase());
  return <Modal open={open} title={AGENT_COPY.modal.workspaceSourcesTitle} onClose={onClose}>
    <form className="agent-modal-form" onSubmit={registerWorkspace}>
      <h3>{AGENT_COPY.modal.manualWorkspace}</h3>
      <p className="modal-note">{AGENT_COPY.modal.manualWorkspaceNote}</p>
      <label>{AGENT_COPY.modal.workspacePath}<input value={workspacePath} onChange={(event) => setWorkspacePath(event.target.value)} required placeholder={AGENT_COPY.modal.workspacePathPlaceholder} autoComplete="off" /></label>
      <div className="agent-modal-actions"><button className="primary-btn" type="submit" disabled={busy}>{AGENT_COPY.modal.registerWorkspace}</button></div>
    </form>
    <section className="workspace-source-section" aria-labelledby="registeredWorkspacePathsTitle">
      <h3 id="registeredWorkspacePathsTitle">{AGENT_COPY.catalog.registeredPaths}</h3>
      {workspacePaths.length ? <div className="workspace-source-list" role="list">{workspacePaths.map((path) => <div role="listitem" key={path}><code title={path}>{path}</code><button type="button" onClick={() => void request({ action: "unregister-workspace", workspacePath: path })} disabled={busy}>{AGENT_COPY.modal.unregisterWorkspace}</button></div>)}</div> : <p className="modal-note">{AGENT_COPY.catalog.noRegisteredPaths}</p>}
    </section>
    <form className="agent-modal-form workspace-snapshot-form" onSubmit={importSnapshot}>
      <h3>{AGENT_COPY.modal.snapshotWorkspace}</h3>
      <p className="modal-note">{AGENT_COPY.modal.snapshotWorkspaceNote}</p>
      <label>{AGENT_COPY.modal.workspacePath}<input value={snapshotPath} onChange={(event) => setSnapshotPath(event.target.value)} required placeholder={AGENT_COPY.modal.workspacePathPlaceholder} autoComplete="off" /></label>
      <p className="modal-note">{AGENT_COPY.modal.snapshotRemovalNote}</p>
      <div className="agent-modal-actions"><button type="button" onClick={() => { const path = snapshotPath.trim(); if (path) void request({ action: "remove-workspace-snapshot", workspacePath: path }).then((removed) => { if (removed) setSnapshotPath(""); }); }} disabled={busy || !snapshotPath.trim()}>{AGENT_COPY.modal.removeSnapshot}</button><button className="primary-btn" type="submit" disabled={busy}>{reimporting ? AGENT_COPY.modal.reimportSnapshot : AGENT_COPY.modal.importSnapshot}</button></div>
    </form>
    <section className="workspace-source-section" aria-labelledby="importedWorkspaceSnapshotsTitle">
      <h3 id="importedWorkspaceSnapshotsTitle">{AGENT_COPY.catalog.importedSnapshots}</h3>
      {workspaceSnapshots.length ? <div className="workspace-source-list" role="list">{workspaceSnapshots.map((snapshot) => <div role="listitem" key={snapshot.workspacePath}><div className="workspace-snapshot-summary"><code title={snapshot.workspacePath}>{snapshot.workspacePath}</code><small>{AGENT_COPY.modal.snapshotDetails(snapshot.agentCount, formatMoment(snapshot.importedAt))}</small></div><div className="workspace-source-actions"><button type="button" onClick={() => setSnapshotPath(snapshot.workspacePath)} disabled={busy}>{AGENT_COPY.modal.reimportSnapshot}</button><button type="button" onClick={() => void request({ action: "remove-workspace-snapshot", workspacePath: snapshot.workspacePath })} disabled={busy}>{AGENT_COPY.modal.removeSnapshot}</button></div></div>)}</div> : <p className="modal-note">{AGENT_COPY.catalog.noImportedSnapshots}</p>}
    </section>
    <div className="agent-modal-actions"><button type="button" onClick={onClose} disabled={busy}>{AGENT_COPY.modal.close}</button></div>
  </Modal>;
}

function AgentRosterCard({ definition, group, busy, onManage, onImport, onResolve, request }: { definition: RosterDefinition; group: AgentGroup; busy: boolean; onManage: (agent: CatalogAgent) => void; onImport: (agent: CatalogAgent) => void; onResolve: (group: AgentGroup) => void; request: (body: unknown) => Promise<boolean> }) {
  const { agent, metric } = definition;
  const enabledCodexDefinitions = group.definitions.filter((candidate) => candidate.codexReady && candidate.enabled);
  const unresolved = enabledCodexDefinitions.length > 1;
  const hasMutableDefinition = group.definitions.some(isEditableProjectDefinition);
  const status = metric.activeInstances ? AGENT_COPY.catalog.status.working : !enabledCodexDefinitions.length && group.definitions.some((candidate) => candidate.codexReady) ? AGENT_COPY.catalog.status.disabled : unresolved ? AGENT_COPY.catalog.status.unresolved : AGENT_COPY.catalog.status.idle;
  const protectedDefinition = isProtectedRosterDefinition(agent);
  const workspaceDefinition = agent.workspacePath ?? AGENT_COPY.catalog.noWorkspaceDefinition;
  return <article className={`agent-roster-card${unresolved ? " collision" : ""}`} role="listitem">
    <div className="agent-roster-title"><div><h4 title={agent.name}>{agent.name}</h4><span className={`agent-status ${status.toLowerCase().replaceAll(" ", "-")}`}>{status}</span></div></div>
    <div className="agent-facts"><span>{AGENT_COPY.catalog.trackedTime} <b>{formatElapsed(metric.trackedActiveSeconds)}</b></span><span>{AGENT_COPY.catalog.activeNow} <b>{metric.activeInstances}</b></span><span>{AGENT_COPY.catalog.lastActivity} <b title={metric.lastActivityAt ?? undefined}>{metric.lastActivityAt ? formatAge(Math.max(0, Math.floor((Date.now() - Date.parse(metric.lastActivityAt)) / 1000))) : AGENT_COPY.catalog.none}</b></span><span>{AGENT_COPY.catalog.runCount} <b>{AGENT_COPY.dashboard.runs(metric.runCount)}</b></span></div>
    {metric.lastActivityMessage && <p className="agent-last-activity">{metric.lastActivityMessage}</p>}
    {unresolved && <div className="collision-copy"><p><strong>{AGENT_COPY.collision.title}</strong> {hasMutableDefinition ? AGENT_COPY.collision.editable : AGENT_COPY.collision.protected}</p><button type="button" onClick={() => onResolve(group)} disabled={busy}>{hasMutableDefinition ? AGENT_COPY.collision.resolve : AGENT_COPY.collision.guidance}</button></div>}
    <div className="agent-card-details">
      <div><span className="agent-detail-label">{AGENT_COPY.catalog.sourceAndTags}</span><AgentTags agent={agent} /></div>
      <div><span className="agent-detail-label">{AGENT_COPY.catalog.definition}</span><span className="agent-detail-value" title={agent.description}>{agent.description}</span></div>
      <div><span className="agent-detail-label">{AGENT_COPY.catalog.workspaceDefinition}</span><span className="agent-detail-value" title={workspaceDefinition}>{workspaceDefinition}</span></div>
      <div><span className="agent-detail-label">{AGENT_COPY.catalog.sourcePath}</span><code title={agent.sourcePath}>{agent.sourcePath}</code></div>
      <div><span className="agent-detail-label">{AGENT_COPY.catalog.copyDestinationLabel}</span><span className="agent-copy-destination" title={copyDestination(agent)}>{copyDestination(agent)}</span></div>
    </div>
    <div className="agent-card-controls">
      {protectedDefinition ? <><span className="readonly-label">{definitionProtectionLabel(agent)}</span><div className="agent-definition-actions"><button type="button" onClick={() => onImport(agent)} disabled={busy}>{AGENT_COPY.modal.addToCodex}</button>{agent.scope === "external" && <button type="button" onClick={() => void request({ action: "unregister", sourcePath: agent.sourcePath })} disabled={busy}>{AGENT_COPY.catalog.remove}</button>}</div></> : <div className="agent-definition-actions"><button type="button" onClick={() => onManage(agent)} disabled={busy}>{AGENT_COPY.catalog.manage}</button></div>}
    </div>
  </article>;
}

function RosterSection({ section, groups, busy, onManage, onImport, onResolve, request }: { section: RosterSection; groups: Map<string, AgentGroup>; busy: boolean; onManage: (agent: CatalogAgent) => void; onImport: (agent: CatalogAgent) => void; onResolve: (group: AgentGroup) => void; request: (body: unknown) => Promise<boolean> }) {
  const title = section.workspacePath ? rosterSectionTitle(section) : AGENT_COPY.catalog.group[section.key];
  const titleId = `agentRoster-${section.id}-Title`;
  return <section className="agent-roster-section" aria-labelledby={titleId}><div className="agent-roster-section-head"><div className="agent-roster-section-heading"><h3 id={titleId}>{title}</h3>{section.workspacePath && <code className="agent-roster-section-path" title={section.workspacePath}>{section.workspacePath}</code>}</div><span>{section.definitions.length}</span></div><div className="agent-roster" role="list">{section.definitions.map((definition) => <AgentRosterCard key={definition.agent.sourcePath} definition={definition} group={groups.get(definition.agent.name.toLowerCase()) ?? { key: definition.agent.name.toLowerCase(), name: definition.agent.name, definitions: [definition.agent], metric: definition.metric }} busy={busy} onManage={onManage} onImport={onImport} onResolve={onResolve} request={request} />)}</div></section>;
}

export function AgentCatalogPanel({ agents, settings, metrics, workspacePaths, activities, statistics, projectScopeLabel, hasProjectFilter }: { agents: CatalogAgent[]; settings: CatalogSettings; metrics: Record<string, AgentMetric>; workspacePaths: string[]; activities: GuildAgentActivity[]; statistics: GuildStatistics; projectScopeLabel: string; hasProjectFilter: boolean }) {
  const [catalog, setCatalog] = useState(agents);
  const [catalogSettings, setCatalogSettings] = useState(settings);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [workspaceSourcesOpen, setWorkspaceSourcesOpen] = useState(false);
  const [registeredWorkspacePaths, setRegisteredWorkspacePaths] = useState<string[]>([]);
  const [workspaceSnapshots, setWorkspaceSnapshots] = useState<CatalogWorkspaceSnapshot[]>([]);
  const [managedAgent, setManagedAgent] = useState<CatalogAgent | null>(null);
  const [importAgent, setImportAgent] = useState<CatalogAgent | null>(null);
  const [collisionGroup, setCollisionGroup] = useState<AgentGroup | null>(null);
  useEffect(() => setCatalog(agents), [agents]);
  useEffect(() => setCatalogSettings(settings), [settings]);
  const applyCatalogResponse = (payload: CatalogResponse) => {
    setCatalog(payload.agents);
    setCatalogSettings(payload.settings);
    setRegisteredWorkspacePaths(payload.workspacePaths);
    setWorkspaceSnapshots(payload.workspaceSnapshotMetadata);
  };
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/guild/agents").then(async (response) => {
      if (!response.ok) return;
      const payload = await response.json() as CatalogResponse;
      if (!cancelled) applyCatalogResponse(payload);
    }).catch(() => { /* The dashboard payload remains a useful offline fallback. */ });
    return () => { cancelled = true; };
  }, []);
  const groups = useMemo(() => groupAgents(catalog, metrics), [catalog, metrics]);
  const rosterSections = useMemo(() => partitionRosterDefinitions(catalog, metrics), [catalog, metrics]);
  const groupsByName = useMemo(() => new Map(groups.map((group) => [group.key, group])), [groups]);
  const request = async (body: unknown) => {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/guild/agents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json() as CatalogResponse;
      if (!response.ok) throw new Error((payload as CatalogResponse & { error?: string }).error || AGENT_COPY.errors.update);
      applyCatalogResponse(payload);
      return true;
    } catch (reason) { setError(reason instanceof Error ? reason.message : AGENT_COPY.errors.update); return false; }
    finally { setBusy(false); }
  };
  const scanNote = catalogSettings.lastScannedAt ? AGENT_COPY.catalog.lastScan(formatMoment(catalogSettings.lastScannedAt)) : AGENT_COPY.catalog.noScan;
  return <section className="agent-company" aria-labelledby="agentCatalogTitle">
    <AgentDashboard groups={groups} activities={activities} statistics={statistics} scopeLabel={projectScopeLabel} hasProjectFilter={hasProjectFilter} />
    <div className="agent-roster-head"><div><h2 id="agentCatalogTitle">{AGENT_COPY.catalog.title}</h2><p>{scanNote}</p></div><div><button type="button" onClick={() => void request({ action: "scan" })} disabled={busy}>{AGENT_COPY.catalog.refresh}</button><button type="button" onClick={() => setWorkspaceSourcesOpen(true)} disabled={busy}>{AGENT_COPY.catalog.workspaceSources}</button><button type="button" onClick={() => setSettingsOpen(true)} disabled={busy}>{AGENT_COPY.catalog.settings}</button><button type="button" onClick={() => setRegisterOpen(true)} disabled={busy}>{AGENT_COPY.catalog.register}</button><button className="primary-btn" type="button" onClick={() => setCreateOpen(true)} disabled={busy}>{AGENT_COPY.catalog.create}</button></div></div>
    <p className="catalog-copy">{AGENT_COPY.catalog.manualNotice}</p>
    {error && <p className="catalog-error" role="alert">{error}</p>}
    {rosterSections.length ? <div className="agent-roster-sections">{rosterSections.map((section) => <RosterSection key={section.id} section={section} groups={groupsByName} busy={busy} onManage={setManagedAgent} onImport={setImportAgent} onResolve={setCollisionGroup} request={request} />)}</div> : <p className="catalog-empty">{AGENT_COPY.catalog.empty}</p>}
    <CreateAgentModal open={createOpen} onClose={() => setCreateOpen(false)} workspacePaths={workspacePaths} request={request} />
    <RegisterAgentModal open={registerOpen} onClose={() => setRegisterOpen(false)} request={request} />
    <ImportAgentModal agent={importAgent} open={Boolean(importAgent)} onClose={() => setImportAgent(null)} workspacePaths={workspacePaths} request={request} />
    <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} settings={catalogSettings} request={request} />
    <WorkspaceSourcesModal open={workspaceSourcesOpen} onClose={() => setWorkspaceSourcesOpen(false)} workspacePaths={registeredWorkspacePaths} workspaceSnapshots={workspaceSnapshots} request={request} busy={busy} />
    <ManageAgentModal agent={managedAgent} open={Boolean(managedAgent)} onClose={() => setManagedAgent(null)} request={request} />
    <CollisionResolutionModal group={collisionGroup} open={Boolean(collisionGroup)} onClose={() => setCollisionGroup(null)} request={request} busy={busy} />
  </section>;
}
