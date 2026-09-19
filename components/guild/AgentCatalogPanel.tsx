"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { AgentMetric, CatalogAgent, CatalogSettings } from "@/lib/guild-contract";
import { formatAge, formatElapsed, formatMoment, titleCase } from "@/lib/guild-format";

type AgentGroup = { key: string; name: string; definitions: CatalogAgent[]; metric: AgentMetric };
type CatalogResponse = { agents: CatalogAgent[]; settings: CatalogSettings; error?: string };
type CollisionResolution = "tag" | "rename" | "disable";

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
  return <span className="agent-tags"><i>{agent.scope}</i>{agent.tags.map((tag) => <i key={tag}>{tag}</i>)}</span>;
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
    <div className="agent-modal-head"><h2>{title}</h2><button type="button" className="icon-btn" onClick={onClose} aria-label={`Close ${title}`} title="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" /></svg></button></div>
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
  return <Modal open={open} title="Create agent" onClose={onClose}>
    <form className="agent-modal-form" onSubmit={submit}>
      <label>Destination<select value={scope} onChange={(event) => setScope(event.target.value as "global" | "workspace")}><option value="global">Global Codex agents</option><option value="workspace">Workspace Codex agents</option></select></label>
      {scope === "workspace" && <label>Workspace<select name="workspacePath" required>{workspacePaths.map((workspace) => <option key={workspace} value={workspace}>{workspace}</option>)}</select></label>}
      <label>Name<input name="name" required pattern="[a-z][a-z0-9_-]{0,63}" placeholder="release-helper" autoComplete="off" /></label>
      <label>Description<input name="description" required maxLength={500} /></label>
      <label>Developer instructions<textarea name="instructions" required rows={5} /></label>
      <label>Custom tags<input name="tags" placeholder="release, trusted" /></label>
      <div className="agent-modal-actions"><button type="button" onClick={onClose}>Cancel</button><button className="primary-btn" type="submit">Create agent</button></div>
    </form>
  </Modal>;
}

function RegisterAgentModal({ open, onClose, request }: { open: boolean; onClose: () => void; request: (body: unknown) => Promise<boolean> }) {
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const sourcePath = String(new FormData(event.currentTarget).get("sourcePath") || "");
    if (await request({ action: "register", sourcePath })) { event.currentTarget.reset(); onClose(); }
  };
  return <Modal open={open} title="Register existing TOML" onClose={onClose}>
    <form className="agent-modal-form" onSubmit={submit}>
      <p className="modal-note">Register any valid local agent TOML to track it here. Codex cannot use an external definition until you add a copy to a Codex global or workspace folder.</p>
      <label>Local TOML path<input name="sourcePath" required placeholder="D:\\Agents\\release-helper.toml" autoComplete="off" /></label>
      <div className="agent-modal-actions"><button type="button" onClick={onClose}>Cancel</button><button className="primary-btn" type="submit">Register agent</button></div>
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
  return <Modal open={open} title={`Add ${agent.name} to Codex`} onClose={onClose}>
    <form className="agent-modal-form" onSubmit={submit}>
      <p className="modal-note">LanternWatch copies this TOML and keeps the external original unchanged. The registered external entry is removed after a successful copy to avoid duplicate attribution.</p>
      <label>Destination<select value={scope} onChange={(event) => setScope(event.target.value as "global" | "workspace")}><option value="global">Codex global agents</option><option value="workspace">Workspace agents</option></select></label>
      {scope === "workspace" && <label>Workspace<select name="workspacePath" required>{workspacePaths.map((workspace) => <option key={workspace} value={workspace}>{workspace}</option>)}</select></label>}
      <div className="agent-modal-actions"><button type="button" onClick={onClose}>Cancel</button><button className="primary-btn" type="submit">Add to Codex</button></div>
    </form>
  </Modal>;
}

function SettingsModal({ open, onClose, settings, request }: { open: boolean; onClose: () => void; settings: CatalogSettings; request: (body: unknown) => Promise<boolean> }) {
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (await request({ action: "settings", settings: { discoveryMode: data.get("discoveryMode") } })) onClose();
  };
  return <Modal open={open} title="Catalog settings" onClose={onClose}>
    <form className="agent-modal-form" onSubmit={submit}>
      <label>Discovery<select name="discoveryMode" defaultValue={settings.discoveryMode}><option value="manual">Manual - refresh only</option><option value="automatic-once">Automatic - scan once now</option></select></label>
      <p className="modal-note">Automatic scans once when you save this setting. LanternWatch never watches folders, polls for files, or scans again in the background. Same-name sources are handled from each duplicate card, where Add tag is selected by default.</p>
      <div className="agent-modal-actions"><button type="button" onClick={onClose}>Cancel</button><button className="primary-btn" type="submit">Save settings</button></div>
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
  return <Modal open={open} title={`Manage ${agent.name}`} onClose={onClose}>
    <div className="agent-source"><span>{agent.enabled ? "Enabled" : "Disabled"}</span><code title={agent.sourcePath}>{agent.sourcePath}</code></div>
    <form className="agent-modal-form" onSubmit={saveTags}><label>Custom tags<input name="tags" defaultValue={agent.tags.join(", ")} /></label><button type="submit">Save tags</button></form>
    <form className="agent-modal-form" onSubmit={rename}><label>Rename<input name="name" defaultValue={agent.name} required pattern="[a-z][a-z0-9_-]{0,63}" /></label><button type="submit">Rename agent</button></form>
    <div className="agent-modal-actions"><button type="button" onClick={onClose}>Close</button><button type="button" onClick={() => void request({ action: "toggle", sourcePath: agent.sourcePath, enabled: !agent.enabled }).then((saved) => { if (saved) onClose(); })}>{agent.enabled ? "Turn off" : "Turn on"}</button></div>
  </Modal>;
}

function CollisionResolutionModal({ group, open, onClose, request, busy }: { group: AgentGroup | null; open: boolean; onClose: () => void; request: (body: unknown) => Promise<boolean>; busy: boolean }) {
  const workspaceDefinitions = group?.definitions.filter((agent) => agent.scope === "workspace" && agent.enabled && !agent.readOnly) ?? [];
  const [sourcePath, setSourcePath] = useState("");
  const [resolution, setResolution] = useState<CollisionResolution>("tag");
  const [name, setName] = useState("");

  useEffect(() => {
    if (!open || !group) return;
    const firstWorkspaceDefinition = group.definitions.find((agent) => agent.scope === "workspace" && agent.enabled && !agent.readOnly);
    setSourcePath(firstWorkspaceDefinition?.sourcePath ?? "");
    setResolution("tag");
    setName(group.name);
  }, [group, open]);

  if (!group) return null;
  const hasEditableWorkspaceDefinition = workspaceDefinitions.length > 0;
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!hasEditableWorkspaceDefinition) return;
    const action = {
      action: "resolve-collision",
      sourcePath,
      resolution,
      ...(resolution === "tag" ? { tags: ["duplicate-source"] } : {}),
      ...(resolution === "rename" ? { name } : {}),
    };
    if (await request(action)) onClose();
  };

  return <Modal open={open} title={`Resolve ${group.name} sources`} onClose={onClose}>
    <form className="agent-modal-form collision-resolution-form" onSubmit={submit} aria-busy={busy}>
      <p className="modal-note">LanternWatch found enabled Codex definitions with the same name. Only a workspace definition can be changed here; global and LanternWatch definitions remain untouched.</p>
      <div className="collision-sources" role="list" aria-label={`Duplicate ${group.name} definitions`}>
        {group.definitions.map((agent) => <div key={agent.id} role="listitem"><AgentTags agent={agent} /><code title={agent.sourcePath}>{agent.sourcePath}</code>{agent.scope === "workspace" && agent.enabled && !agent.readOnly && <span>Can change</span>}</div>)}
      </div>
      {hasEditableWorkspaceDefinition ? <label>Workspace definition to change<select value={sourcePath} onChange={(event) => setSourcePath(event.target.value)} disabled={busy}>{workspaceDefinitions.map((agent) => <option key={agent.sourcePath} value={agent.sourcePath}>{agent.sourcePath}</option>)}</select></label> : <p className="catalog-error" role="status">No enabled workspace definition can be changed. Add or enable one in this workspace to resolve this collision; global sources remain read-only here.</p>}
      <fieldset className="collision-resolution-options" disabled={busy || !hasEditableWorkspaceDefinition}>
        <legend>Choose how LanternWatch should handle this duplicate</legend>
        <label className="resolution-choice"><input type="radio" name="collisionResolution" value="tag" checked={resolution === "tag"} onChange={() => setResolution("tag")} autoFocus /><span><strong>Add tag</strong><small>Recommended default. Adds the local <code>duplicate-source</code> tag to identify this workspace source. The same-name warning stays because tags do not change which source Codex selects.</small></span></label>
        <label className="resolution-choice"><input type="radio" name="collisionResolution" value="rename" checked={resolution === "rename"} onChange={() => setResolution("rename")} /><span><strong>Rename</strong><small>Renames only the selected workspace definition and its TOML filename. This can clear the duplicate warning.</small></span></label>
        {resolution === "rename" && <label className="resolution-name">New workspace agent name<input value={name} onChange={(event) => setName(event.target.value)} required pattern="[a-z][a-z0-9_-]{0,63}" autoComplete="off" /></label>}
        <label className="resolution-choice"><input type="radio" name="collisionResolution" value="disable" checked={resolution === "disable"} onChange={() => setResolution("disable")} /><span><strong>Disable</strong><small>Moves only the selected workspace definition to LanternWatch&apos;s recoverable disabled-agent store. This can clear the duplicate warning.</small></span></label>
      </fieldset>
      <div className="agent-modal-actions"><button type="button" onClick={onClose} disabled={busy}>Cancel</button><button className="primary-btn" type="submit" disabled={busy || !hasEditableWorkspaceDefinition}>{busy ? "Resolving…" : resolution === "tag" ? "Add tag" : resolution === "rename" ? "Rename workspace agent" : "Disable workspace agent"}</button></div>
    </form>
  </Modal>;
}

function AgentDashboard({ groups }: { groups: AgentGroup[] }) {
  const definitions = groups.flatMap((group) => group.definitions);
  const active = groups.filter((group) => group.metric.activeInstances > 0).length;
  const disabled = definitions.filter((agent) => !agent.enabled).length;
  const external = definitions.filter((agent) => agent.scope === "external").length;
  const lanternwatch = definitions.filter((agent) => agent.scope === "lanternwatch").length;
  const unresolved = groups.filter((group) => group.definitions.filter((agent) => agent.codexReady && agent.enabled).length > 1).length;
  const totalRuns = groups.reduce((total, group) => total + group.metric.runCount, 0);
  const trackedTime = groups.reduce((total, group) => total + group.metric.trackedActiveSeconds, 0);
  const topByRuns = groups.find((group) => group.metric.runCount > 0);
  const topByTime = [...groups].sort((a, b) => b.metric.trackedActiveSeconds - a.metric.trackedActiveSeconds || b.metric.runCount - a.metric.runCount)[0];
  return <section className="agent-dashboard" aria-labelledby="agentDashboardTitle">
    <div className="section-heading"><div><h2 id="agentDashboardTitle">All agents</h2></div><span>Lifecycle metrics follow the current project filter</span></div>
    <div className="agent-stat-grid">
      <article><span>Definitions</span><strong>{definitions.length}</strong><small>{definitions.filter((agent) => agent.codexReady).length} Codex-ready · {external} external</small></article>
      <article><span>Current status</span><strong>{active} active</strong><small>{disabled} disabled · {lanternwatch} LanternWatch</small></article>
      <article><span>Tracked work</span><strong>{totalRuns} runs</strong><small>{formatElapsed(trackedTime)} lifecycle time</small></article>
      <article><span>Unresolved sources</span><strong>{unresolved}</strong><small>Same-name enabled Codex definitions</small></article>
    </div>
    <div className="agent-leaders">
      <article><span>Most runs</span><strong>{topByRuns ? titleCase(topByRuns.name) : "No activity"}</strong><small>{topByRuns ? `${topByRuns.metric.runCount} tracked runs` : "No lifecycle events yet"}</small></article>
      <article><span>Most agent time</span><strong>{topByTime?.metric.trackedActiveSeconds ? titleCase(topByTime.name) : "No activity"}</strong><small>{topByTime?.metric.trackedActiveSeconds ? formatElapsed(topByTime.metric.trackedActiveSeconds) : "No reported active windows yet"}</small></article>
    </div>
  </section>;
}

export function AgentCatalogPanel({ agents, settings, metrics, workspacePaths }: { agents: CatalogAgent[]; settings: CatalogSettings; metrics: Record<string, AgentMetric>; workspacePaths: string[] }) {
  const [catalog, setCatalog] = useState(agents);
  const [catalogSettings, setCatalogSettings] = useState(settings);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [managedAgent, setManagedAgent] = useState<CatalogAgent | null>(null);
  const [importAgent, setImportAgent] = useState<CatalogAgent | null>(null);
  const [collisionGroup, setCollisionGroup] = useState<AgentGroup | null>(null);
  useEffect(() => setCatalog(agents), [agents]);
  useEffect(() => setCatalogSettings(settings), [settings]);
  const groups = useMemo(() => groupAgents(catalog, metrics), [catalog, metrics]);
  const request = async (body: unknown) => {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/guild/agents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json() as CatalogResponse;
      if (!response.ok) throw new Error(payload.error || "Agent catalog update failed.");
      setCatalog(payload.agents);
      setCatalogSettings(payload.settings);
      return true;
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Agent catalog update failed."); return false; }
    finally { setBusy(false); }
  };
  const scanNote = catalogSettings.lastScannedAt ? `Last scan ${formatMoment(catalogSettings.lastScannedAt)}` : "No scan saved yet";
  return <section className="agent-company" aria-labelledby="agentCatalogTitle">
    <AgentDashboard groups={groups} />
    <div className="agent-roster-head"><div><h2 id="agentCatalogTitle">Agent roster</h2><p>{scanNote}</p></div><div><button type="button" onClick={() => void request({ action: "scan" })} disabled={busy}>Refresh agents</button><button type="button" onClick={() => setSettingsOpen(true)} disabled={busy}>Settings</button><button type="button" onClick={() => setRegisterOpen(true)} disabled={busy}>Register TOML</button><button className="primary-btn" type="button" onClick={() => setCreateOpen(true)} disabled={busy}>Create agent</button></div></div>
    <p className="catalog-copy">Manual mode never scans by itself. Refresh whenever you want a new scan, or choose Automatic one-time scan in Settings. For same-name sources, Resolve in LanternWatch starts with Add tag selected.</p>
    {error && <p className="catalog-error" role="alert">{error}</p>}
    <div className="agent-roster" role="list">{groups.length ? groups.map((group) => {
      const enabledCodexDefinitions = group.definitions.filter((agent) => agent.codexReady && agent.enabled);
      const unresolved = enabledCodexDefinitions.length > 1;
      const status = group.metric.activeInstances ? "Working" : !enabledCodexDefinitions.length && group.definitions.some((agent) => agent.codexReady) ? "Disabled" : unresolved ? "Source unresolved" : "Idle";
      return <article className={`agent-roster-card${unresolved ? " collision" : ""}`} role="listitem" key={group.key}>
        <div className="agent-roster-title"><div><h3>{group.name}</h3><span className={`agent-status ${status.toLowerCase().replaceAll(" ", "-")}`}>{status}</span></div><strong>{group.metric.runCount} run{group.metric.runCount === 1 ? "" : "s"}</strong></div>
        <div className="agent-facts"><span>Tracked time <b>{formatElapsed(group.metric.trackedActiveSeconds)}</b></span><span>Active now <b>{group.metric.activeInstances}</b></span><span>Last activity <b>{group.metric.lastActivityAt ? formatAge(Math.max(0, Math.floor((Date.now() - Date.parse(group.metric.lastActivityAt)) / 1000))) : "None"}</b></span></div>
        {group.metric.lastActivityMessage && <p className="agent-last-activity">{group.metric.lastActivityMessage}</p>}
        {unresolved && <div className="collision-copy"><p><strong>Same-name Codex definitions found.</strong> Add a tag to identify sources in LanternWatch, or rename/disable a workspace definition to remove the ambiguity. Tags keep both entries visible but activity remains unresolved.</p><button type="button" onClick={() => setCollisionGroup(group)} disabled={busy}>Resolve in LanternWatch</button></div>}
        <div className="agent-definitions">{group.definitions.map((agent) => <div key={agent.id}><div><AgentTags agent={agent} /><code title={agent.sourcePath}>{agent.sourcePath}</code></div>{agent.scope === "external" ? <div className="agent-definition-actions"><button type="button" onClick={() => setImportAgent(agent)} disabled={busy}>Add to Codex</button><button type="button" onClick={() => void request({ action: "unregister", sourcePath: agent.sourcePath })} disabled={busy}>Remove</button></div> : agent.readOnly ? <span className="readonly-label">Read-only</span> : <button type="button" onClick={() => setManagedAgent(agent)} disabled={busy}>Manage</button>}</div>)}</div>
      </article>;
    }) : <p className="catalog-empty">No saved scan yet. Refresh agents, select Automatic one-time scan, create an agent, or register an existing local TOML.</p>}</div>
    <CreateAgentModal open={createOpen} onClose={() => setCreateOpen(false)} workspacePaths={workspacePaths} request={request} />
    <RegisterAgentModal open={registerOpen} onClose={() => setRegisterOpen(false)} request={request} />
    <ImportAgentModal agent={importAgent} open={Boolean(importAgent)} onClose={() => setImportAgent(null)} workspacePaths={workspacePaths} request={request} />
    <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} settings={catalogSettings} request={request} />
    <ManageAgentModal agent={managedAgent} open={Boolean(managedAgent)} onClose={() => setManagedAgent(null)} request={request} />
    <CollisionResolutionModal group={collisionGroup} open={Boolean(collisionGroup)} onClose={() => setCollisionGroup(null)} request={request} busy={busy} />
  </section>;
}
