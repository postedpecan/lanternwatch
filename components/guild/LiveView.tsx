"use client";

import { useState, type FormEvent } from "react";
import { AGENTS, AGENT_IDS, STEPS, type AgentId } from "@/lib/guild-data";
import type { AgentPresentation, CatalogAgent, CatalogSettings, GuildAgentActivity, GuildProject, GuildRun, GuildStorageHealth, StoredGuildEvent } from "@/lib/guild-contract";
import { formatAge, formatElapsed, formatMoment, titleCase } from "@/lib/guild-format";
import { describeHookDiagnostic } from "@/components/guild/hook-diagnostic";
import { getDemoNextStepIndex, getFocusedWorkflowActivities } from "@/components/guild/workflow-activity";
import { needsDelegationWarning } from "@/components/guild/delegation-warning";
import { AGENT_COPY } from "@/components/guild/agent-copy";
import { associateTeamStatusActivities } from "@/components/guild/team-status";
import { partitionRosterDefinitions, rosterSectionTitle } from "@/components/guild/agent-roster";
import {
  DEMO_TOTAL_DURATION_SECONDS,
  runtimeFor,
  useGuildData,
  type DataMode,
  type GuildState,
} from "@/components/guild/GuildDataContext";

const orderedAgents = AGENT_IDS.map((id) => AGENTS.find((agent) => agent.id === id)!);

function AgentTags({ presentation }: { presentation?: AgentPresentation }) {
  if (!presentation) return null;
  if (presentation.unresolved) return <span className="agent-tags unresolved" title="More than one enabled definition has this name; LanternWatch cannot prove which one produced this activity.">Source unresolved</span>;
  if (!presentation.scope && !presentation.tags.length) return null;
  return <span className="agent-tags">{presentation.scope && <i>{presentation.scope}</i>}{presentation.tags.map((tag) => <i key={tag}>{tag}</i>)}</span>;
}

function AgentCatalogPanel({ agents, settings }: { agents: CatalogAgent[]; settings: CatalogSettings }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const request = async (body: unknown) => {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/guild/agents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Agent catalog update failed.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Agent catalog update failed."); }
    finally { setBusy(false); }
  };
  const submitCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void request({ action: "create", scope: data.get("scope"), name: data.get("name"), description: data.get("description"), developerInstructions: data.get("instructions"), tags: String(data.get("tags") || "").split(",").map((tag) => tag.trim()).filter(Boolean) });
    event.currentTarget.reset();
  };
  const saveSettings = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void request({ action: "settings", settings: { discoveryMode: data.get("discoveryMode"), collisionPolicy: data.get("collisionPolicy") } });
  };
  return <section className="agent-catalog" aria-labelledby="agentCatalogTitle">
    <div className="activity-head"><div><p className="kicker">Your Codex agents</p><h2 id="agentCatalogTitle">Agent catalog</h2></div><span>{agents.length} discovered</span><button type="button" onClick={() => void request({ action: "scan" })} disabled={busy}>Refresh agents</button></div>
    <p className="catalog-copy">LanternWatch only lists your Codex definitions. Global and workspace agents stay separate and show their source path.</p>
    {error && <p className="catalog-error" role="alert">{error}</p>}
    <details className="catalog-settings"><summary>Catalog settings</summary><form onSubmit={saveSettings} className="catalog-settings-form"><label>Discovery<select name="discoveryMode" defaultValue={settings.discoveryMode}><option value="manual">Manual scan</option><option value="automatic">Automatic refresh</option><option value="watcher">Filesystem watcher</option></select></label><label>Same-name default<select name="collisionPolicy" defaultValue={settings.collisionPolicy}><option value="rename">Rename — recommended</option><option value="tag">Keep names; distinguish with tags</option><option value="disable">Disable one source</option></select></label><button type="submit" disabled={busy}>Save settings</button></form></details>
    <form className="catalog-create" onSubmit={submitCreate}><strong>Create agent</strong><label>Name<input name="name" required pattern="[a-z][a-z0-9_-]{0,63}" placeholder="release-helper" /></label><label>Description<input name="description" required maxLength={500} /></label><label>Developer instructions<textarea name="instructions" required rows={3} /></label><label>Custom tags<input name="tags" placeholder="release, trusted" /></label><label>Destination<select name="scope"><option value="global">Global Codex agents</option><option value="workspace">This workspace</option></select></label><button className="primary-btn" type="submit" disabled={busy}>Create agent</button></form>
    <div className="catalog-list" role="list">{agents.length ? agents.map((agent) => <article className={`catalog-agent${agent.collision ? " collision" : ""}`} role="listitem" key={agent.sourcePath}><div className="catalog-agent-title"><div><strong>{agent.name}</strong><AgentTags presentation={{ scope: agent.scope, tags: agent.tags, unresolved: false }} /></div><span>{agent.enabled ? "On" : "Off"}</span></div><p>{agent.description}</p><code title={agent.sourcePath}>{agent.sourcePath}</code>{agent.collision && <p className="collision-copy"><strong>Same-name definitions found.</strong> Rename is recommended: it gives Codex and activity tracking an unambiguous identity. Tags keep names unchanged but cannot prove activity source; disabling one removes ambiguity but makes it unavailable in Codex.</p>}<div className="catalog-actions"><button type="button" disabled={busy} onClick={() => void request({ action: "toggle", sourcePath: agent.sourcePath, enabled: !agent.enabled })}>{agent.enabled ? "Turn off" : "Turn on"}</button><details><summary>Rename or tag</summary><form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void request({ action: "rename", sourcePath: agent.sourcePath, name: data.get("name") }); }}><label>Rename<input name="name" defaultValue={agent.name} required pattern="[a-z][a-z0-9_-]{0,63}" /></label><button type="submit" disabled={busy}>Rename</button></form><form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void request({ action: "tags", sourcePath: agent.sourcePath, tags: String(data.get("tags") || "").split(",").map((tag) => tag.trim()).filter(Boolean) }); }}><label>Tags<input name="tags" defaultValue={agent.tags.join(", ")} /></label><button type="submit" disabled={busy}>Save tags</button></form></details></div></article>) : <p className="catalog-empty">No user-owned Codex agents were found yet. Create one here or add a TOML file to your global or workspace agent folder.</p>}</div>
  </section>;
}

// A live run running longer than this project's historical average is still
// "in progress" — its estimated bar should never claim to be complete.
const LIVE_ESTIMATE_CAP_PERCENT = 97;

type ProgressInfo = {
  percent: number;
  headline: string;
  detail: string;
  isEstimate: boolean;
};

// Demo mode has a fixed, known step count and known step durations, so its
// percentage and ETA are exact. Live mode tracks real runs with no fixed
// step count, so its percentage/ETA can only ever be an estimate against
// this project's historical average run duration — and must say so.
function computeProgressInfo(
  mode: DataMode,
  state: GuildState,
  averageDurationSeconds: number,
  fallbackStatusText: string,
  scopeLabel: string,
): ProgressInfo {
  const elapsedText = formatElapsed(state.elapsed);

  if (state.delivered) {
    return { percent: 100, headline: "100%", detail: `Completed in ${elapsedText}`, isEstimate: false };
  }

  if (state.running && mode === "demo") {
    const fraction = state.currentStep < 0 ? 0 : (state.currentStep + 1) / STEPS.length;
    const percent = Math.round(fraction * 100);
    const remaining = Math.max(0, DEMO_TOTAL_DURATION_SECONDS - state.elapsed);
    // The step count can reach 100% fractionally just before the final step
    // finishes wrapping up (delivery + a short pause remain) — once that
    // happens, drop the redundant countdown rather than show "100% · ETA 00:02".
    const etaSuffix = percent >= 100 ? "" : ` · ETA ${formatElapsed(remaining)}`;
    return {
      percent,
      headline: `${percent}%`,
      detail: `Elapsed ${elapsedText}${etaSuffix}${state.paused ? " · Paused" : ""}`,
      isEstimate: false,
    };
  }

  if (state.running && mode === "live") {
    if (!averageDurationSeconds) {
      return {
        percent: 0,
        headline: "—",
        detail: `Elapsed ${elapsedText} · no estimate yet (no completed runs in ${scopeLabel})`,
        isEstimate: true,
      };
    }
    if (state.elapsed >= averageDurationSeconds) {
      return {
        percent: LIVE_ESTIMATE_CAP_PERCENT,
        headline: "~est.",
        detail: `Elapsed ${elapsedText} · running longer than the ${formatElapsed(averageDurationSeconds)} ${scopeLabel} average`,
        isEstimate: true,
      };
    }
    const percent = Math.min(LIVE_ESTIMATE_CAP_PERCENT, Math.round((state.elapsed / averageDurationSeconds) * 100));
    const remaining = Math.max(0, averageDurationSeconds - state.elapsed);
    return {
      percent,
      headline: `~${percent}%`,
      detail: `Elapsed ${elapsedText} · ~ETA ${formatElapsed(remaining)} (estimated)`,
      isEstimate: true,
    };
  }

  // Idle, or a terminal run that never reached delivery (interrupted/stalled).
  // Real runs have no fixed step count, so this deliberately doesn't guess a
  // percentage here — it just reports what's already known and shown
  // elsewhere in the live-status pill.
  return {
    percent: 0,
    headline: state.elapsed > 0 ? "Ended" : "0%",
    detail: state.elapsed > 0 ? `${fallbackStatusText} · Elapsed ${elapsedText}` : fallbackStatusText,
    isEstimate: false,
  };
}

function OperationalDiagnostic({
  dashboardConnected,
  healthApiConnected,
  health,
}: {
  dashboardConnected: boolean;
  healthApiConnected: boolean;
  health: GuildStorageHealth | null;
}) {
  const hookUnavailable = healthApiConnected && health?.hookLogStatus !== "ok";
  const hookDiagnostic = describeHookDiagnostic(healthApiConnected, health, formatAge);

  return (
    <section className="operational-diagnostic" aria-labelledby="operationalDiagnosticTitle">
      <h3 id="operationalDiagnosticTitle">Live connection</h3>
      <div className="diagnostic-items" role="list">
        <div className={dashboardConnected ? "ok" : "warning"} role="listitem"><i aria-hidden="true" /><span>Dashboard API {dashboardConnected ? "online" : "unavailable"}</span></div>
        <div className={healthApiConnected && health?.ok ? "ok" : "unknown"} role="listitem"><i aria-hidden="true" /><span>{healthApiConnected && health?.ok ? "Storage ready" : "Storage health unavailable"}</span></div>
        <div className="neutral" role="listitem"><i aria-hidden="true" /><span>{!health ? "Stored event age unavailable" : health.latestEventAgeSeconds === null ? "No stored events yet" : `Last stored event ${formatAge(health.latestEventAgeSeconds)}`}</span></div>
        <div className={hookUnavailable ? "warning" : healthApiConnected ? "ok" : "unknown"} role="listitem"><i aria-hidden="true" /><span>{hookDiagnostic.label}</span></div>
      </div>
      {hookDiagnostic.warning && <p className="hook-warning" role="status">{hookDiagnostic.warning}</p>}
    </section>
  );
}

function AgentRunList({
  mode,
  state,
  activities,
  agentRunCounts,
  catalogAgents,
  agentMetrics,
}: {
  mode: DataMode;
  state: GuildState;
  activities: GuildAgentActivity[];
  agentRunCounts: Record<string, number>;
  catalogAgents: CatalogAgent[];
  agentMetrics: Record<string, import("@/lib/guild-contract").AgentMetric>;
}) {
  if (mode === "live") {
    const { sections, unresolvedActivities } = associateTeamStatusActivities(partitionRosterDefinitions(catalogAgents, agentMetrics), catalogAgents, activities);
    const renderDefinition = (definition: (typeof sections)[number]["definitions"][number]) => {
      const { agent, metric, activities: definitionActivities } = definition;
      // A catalog id is a case-insensitive path hash, so it is not a unique
      // definition identity on Windows. Use the source path for both React's
      // key and this heading association, matching activity attribution.
      const definitionKey = agent.sourcePath;
      // An IDREF cannot contain whitespace: source paths can, so encode the
      // same stable identity before using it in the DOM.
      const titleId = `agentGroup-${encodeURIComponent(definitionKey)}`;
      return (
        <section className={`agent-instance-group${definitionActivities.length ? " is-active" : " is-idle"}`} key={definitionKey} aria-labelledby={titleId}>
          <div className="agent-instance-heading">
            <div><h4 id={titleId}>{agent.name}</h4><AgentTags presentation={{ scope: agent.scope, tags: agent.tags, unresolved: false }} /></div>
            <span>{definitionActivities.length ? `${definitionActivities.length} active` : "Idle"}</span>
          </div>
          <div role="list">
            {definitionActivities.length ? definitionActivities.map((activity) => (
              <div className={`agent-instance-row ${activity.status}`} role="listitem" key={activity.id}>
                <div className="agent-instance-main">
                  <div className="agent-instance-project">
                    <strong>{activity.projectName}</strong>
                    <span>{titleCase(activity.status)}{activity.status === "working" && <span className="loading-dots" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span>}<AgentTags presentation={activity.presentation} /></span>
                  </div>
                  <p>{activity.message}</p>
                </div>
                <time dateTime={`PT${activity.durationSeconds}S`}>{formatElapsed(activity.durationSeconds)}</time>
              </div>
            )) : (
              <div className="agent-idle-row" role="listitem">
                <span>{agent.description}</span>
                <small>Used in {metric.runCount} run{metric.runCount === 1 ? "" : "s"}</small>
              </div>
            )}
          </div>
        </section>
      );
    };

    return (
      <div className="agent-instance-sections" aria-label="Codex agent status, project, activity, and runtime">
        {sections.map((section) => {
          const title = section.workspacePath ? rosterSectionTitle(section) : AGENT_COPY.catalog.group[section.key];
          const titleId = `agentStatusSection-${section.id}`;
          return <section className="agent-instance-section" key={section.id} aria-labelledby={titleId}>
            <div className="agent-instance-section-head"><h3 id={titleId}>{title}</h3><span>{section.definitions.length}</span></div>
            <div className="agent-instance-grid" role="list">{section.definitions.map(renderDefinition)}</div>
          </section>;
        })}
        {unresolvedActivities.length > 0 && <section className="agent-instance-section agent-instance-unresolved" aria-labelledby="unresolvedAgentStatusTitle">
          <div className="agent-instance-section-head"><h3 id="unresolvedAgentStatusTitle">Source unresolved</h3><span>{unresolvedActivities.length}</span></div>
          <div className="agent-instance-grid" role="list">{unresolvedActivities.map((activity) => <section className={`agent-instance-group is-active`} key={activity.id} aria-labelledby={`unresolvedAgent-${activity.id}`}>
            <div className="agent-instance-heading"><div><h4 id={`unresolvedAgent-${activity.id}`}>{activity.agent}</h4><AgentTags presentation={{ ...(activity.presentation ?? { tags: [] }), unresolved: true }} /></div><span>Active</span></div>
            <div role="list"><div className={`agent-instance-row ${activity.status}`} role="listitem"><div className="agent-instance-main"><div className="agent-instance-project"><strong>{activity.projectName}</strong><span>{titleCase(activity.status)}{activity.status === "working" && <span className="loading-dots" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span>}</span></div><p>{activity.message}</p></div><time dateTime={`PT${activity.durationSeconds}S`}>{formatElapsed(activity.durationSeconds)}</time></div></div>
          </section>)}</div>
        </section>}
      </div>
    );
  }

  const renderDemoAgent = (agent: (typeof orderedAgents)[number]) => {
    const status = state.roomStatuses[agent.id];
    const isWorking = status === "working";
    return (
      <div className={`agent-run-row ${status}`} role="listitem" key={agent.id}>
        <div className="agent-run-copy">
          <div className="agent-run-line">
            <strong>{agent.name}</strong>
            <span aria-live={isWorking ? "polite" : undefined}>
              {isWorking ? "Working" : titleCase(status)}
              {isWorking && <span className="loading-dots" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span>}
            </span>
          </div>
          <div className="agent-run-meta">
            <small>Local demo · {agent.specialty}</small>
            <span className="agent-use-count">Used in {agentRunCounts[agent.id]} run{agentRunCounts[agent.id] === 1 ? "" : "s"}</span>
          </div>
        </div>
        <time className="agent-runtime" dateTime={`PT${runtimeFor(state, agent.id)}S`}>{formatElapsed(runtimeFor(state, agent.id))}</time>
      </div>
    );
  };
  const liveAgents = orderedAgents.filter((agent) => ["working", "queued"].includes(state.roomStatuses[agent.id]));
  const usedAgents = orderedAgents.filter((agent) => !["waiting", "working", "queued"].includes(state.roomStatuses[agent.id]));
  const otherAgents = orderedAgents.filter((agent) => state.roomStatuses[agent.id] === "waiting");
  const hasDemoRun = state.quest.length > 0;

  return (
    <div className="agent-run-list" aria-label="Local demo team role status and runtime">
      <section className="agent-run-group live-group" aria-labelledby="liveAgentsTitle">
        <div className="agent-group-heading"><div><span className="group-live-dot" aria-hidden="true" /><h3 id="liveAgentsTitle">Active roles</h3></div><strong>{liveAgents.length}</strong></div>
        <div role="list">{liveAgents.length ? liveAgents.map(renderDemoAgent) : <p className="agent-group-empty">No team roles are active right now.</p>}</div>
      </section>
      {usedAgents.length > 0 && <section className="agent-run-group used-group" aria-labelledby="usedAgentsTitle">
        <div className="agent-group-heading"><div><h3 id="usedAgentsTitle">Used in this run</h3></div><strong>{usedAgents.length}</strong></div>
        <div role="list">{usedAgents.map(renderDemoAgent)}</div>
      </section>}
      <section className="agent-run-group other-group" aria-labelledby="otherAgentsTitle">
        <div className="agent-group-heading"><div><h3 id="otherAgentsTitle">{hasDemoRun ? "Other roles" : "Available roles"}</h3><small>{hasDemoRun ? "Not used in this demo" : "Ready for the next demo"}</small></div><strong>{otherAgents.length}</strong></div>
        <div role="list">{otherAgents.length ? otherAgents.map(renderDemoAgent) : <p className="agent-group-empty">Every role has participated in this run.</p>}</div>
      </section>
    </div>
  );
}

function activityInstanceLabel(activity: GuildAgentActivity) {
  const suffix = activity.agentInstanceId.split(/[/:]/).filter(Boolean).at(-1) ?? activity.agentInstanceId;
  return `Instance ${suffix.length > 14 ? `${suffix.slice(0, 12)}…` : suffix}`;
}

function LiveWorkflowActivity({ activity }: { activity: GuildAgentActivity }) {
  const instanceLabel = activityInstanceLabel(activity);
  return (
    <div className={`workflow-activity-row ${activity.status}`} role="listitem">
      <div className="workflow-activity-title">
        <strong>{titleCase(activity.agent)}</strong>
        <span>{titleCase(activity.status)}</span>
      </div>
      <p>{activity.message}</p>
      <div className="workflow-activity-meta">
        <code title={activity.agentInstanceId}>{instanceLabel}</code>
        <AgentTags presentation={activity.presentation} />
        <span><time dateTime={`PT${activity.durationSeconds}S`}>{formatElapsed(activity.durationSeconds)}</time> {activity.status === "working" ? "active" : "queued"} · updated <time dateTime={activity.updatedAt}>{formatMoment(activity.updatedAt)}</time></span>
      </div>
    </div>
  );
}

function WorkflowBoard({
  mode,
  hydrated,
  storageConnected,
  selectedRunId,
  currentRun,
  focusedProjectName,
  activities,
  state,
}: {
  mode: DataMode;
  hydrated: boolean;
  storageConnected: boolean;
  selectedRunId: string;
  currentRun: GuildRun | null;
  focusedProjectName: string;
  activities: GuildAgentActivity[];
  state: GuildState;
}) {
  const focused = getFocusedWorkflowActivities(
    activities,
    currentRun?.id ?? null,
    mode !== "live" || (hydrated && storageConnected),
  );
  const demoStep = state.currentStep >= 0 ? STEPS[state.currentStep] : null;
  const demoWorkingAgents = demoStep?.agents.filter((agent) => state.roomStatuses[agent] === "working") ?? [];
  const demoNextStepIndex = getDemoNextStepIndex(state.currentStep, STEPS.length, state.running, state.delivered);
  const demoNextStep = demoNextStepIndex === null ? null : STEPS[demoNextStepIndex];
  const terminalStatus = currentRun && currentRun.status !== "working" ? titleCase(currentRun.status) : null;

  let doingNowEmpty = "No working activities reported for this run.";
  if (!hydrated) doingNowEmpty = "Loading current work…";
  else if (mode === "live" && !storageConnected) doingNowEmpty = "Live activity is unavailable while the dashboard API is offline.";
  else if (mode === "live" && !currentRun) doingNowEmpty = "No active or selected run to show.";
  else if (mode === "live" && terminalStatus) doingNowEmpty = `This run is ${terminalStatus.toLowerCase()}; no agents are working.`;
  else if (mode === "demo" && state.paused) doingNowEmpty = "The local demo is paused.";
  else if (mode === "demo") doingNowEmpty = "No demo roles are working right now.";

  const liveUpNextEmpty = !hydrated
    ? "Loading reported work…"
    : !storageConnected
      ? "Upcoming work is unavailable while the dashboard API is offline."
      : "No upcoming work reported.";

  return (
    <aside className="workboard" aria-labelledby="workflowBoardTitle">
      <div className="panel-head">
        <div className="panel-title"><div><h2 id="workflowBoardTitle">Now &amp; next</h2><p>{focusedProjectName} · {selectedRunId ? "selected run" : mode === "demo" ? "local demonstration" : "focused run"}</p></div></div>
        <span className="step-counter">{formatElapsed(state.elapsed)}</span>
      </div>
      <div className="workflow-focus"><span>{mode === "demo" ? "Demo task" : "Current task"}</span><p>{state.quest || "No project task has started."}</p></div>
      <div className="workflow-sections">
        <section className="workflow-section" aria-labelledby="doingNowTitle">
          <div className="workflow-section-head"><h3 id="doingNowTitle">Doing now</h3><span>{mode === "demo" ? demoWorkingAgents.length : focused.doingNow.length}</span></div>
          <div className="workflow-activity-list" role="list" aria-live="polite">
            {mode === "live" ? focused.doingNow.length
              ? focused.doingNow.map((activity) => <LiveWorkflowActivity activity={activity} key={activity.id} />)
              : <p className="workflow-empty" role="listitem"><span role={hydrated && !storageConnected ? "alert" : "status"}>{doingNowEmpty}</span></p>
              : demoWorkingAgents.length
                ? demoWorkingAgents.map((agentId) => {
                    const agent = AGENTS.find((candidate) => candidate.id === agentId)!;
                    return <div className="workflow-activity-row demo working" role="listitem" key={agentId}><div className="workflow-activity-title"><strong>{agent.name}</strong><span>{state.paused ? "Paused" : "Working"}</span></div><p>{demoStep?.detail}</p><div className="workflow-activity-meta"><code>Local demo</code><span><time dateTime={`PT${runtimeFor(state, agentId)}S`}>{formatElapsed(runtimeFor(state, agentId))}</time> active</span></div></div>;
                  })
                : <p className="workflow-empty" role="listitem"><span role="status">{doingNowEmpty}</span></p>}
          </div>
        </section>
        <section className="workflow-section" aria-labelledby="upNextTitle">
          <div className="workflow-section-head"><h3 id="upNextTitle">Up next</h3><span>{mode === "demo" ? (demoNextStep ? 1 : 0) : focused.upNext.length}</span></div>
          <div className="workflow-activity-list" role="list">
            {mode === "live" ? focused.upNext.length
              ? focused.upNext.map((activity) => <LiveWorkflowActivity activity={activity} key={activity.id} />)
              : <p className="workflow-empty" role="listitem"><span role={!hydrated || !storageConnected ? "status" : undefined}>{liveUpNextEmpty}</span></p>
              : demoNextStep
                ? <div className="workflow-activity-row demo queued" role="listitem"><div className="workflow-activity-title"><strong>{demoNextStep.label}</strong><span>Demo preview</span></div><p>{demoNextStep.agentLabel}</p><div className="workflow-activity-meta"><code>Local demo only</code><span>Static example, not a live plan</span></div></div>
                : <p className="workflow-empty" role="listitem">No upcoming work reported.</p>}
          </div>
        </section>
      </div>
    </aside>
  );
}

function RoleActivity({ mode, state, activities, catalogAgents }: { mode: DataMode; state: GuildState; activities: GuildAgentActivity[]; catalogAgents: CatalogAgent[] }) {
  const liveRoleStatuses = new Map<string, "queued" | "working">();
  for (const activity of activities) {
    if (activity.status === "working" || !liveRoleStatuses.has(activity.agent)) {
      liveRoleStatuses.set(activity.agent, activity.status);
    }
  }
  const activeOrUsedRoleCount = mode === "live"
    ? liveRoleStatuses.size
    : orderedAgents.filter((agent) => state.roomStatuses[agent.id] !== "waiting").length;
  const summary = mode === "live"
    ? `${activities.length} active across ${activeOrUsedRoleCount} role${activeOrUsedRoleCount === 1 ? "" : "s"}`
    : `${activeOrUsedRoleCount}/${orderedAgents.length} active/used · Local demo`;

  return (
    <section className="contribution-card role-activity-strip" aria-labelledby="roleActivityTitle">
      <div className="contribution-heading">
        <h2 id="roleActivityTitle">Role activity</h2>
        <span>{summary}</span>
      </div>
      <div className="contribution-grid" role="list" aria-label="Activity by Codex agent">
        {(mode === "live" ? catalogAgents : orderedAgents).map((agent) => {
          const status = mode === "live"
            ? liveRoleStatuses.get(agent.name) ?? "waiting"
            : state.roomStatuses[(agent as (typeof orderedAgents)[number]).id];
          const instanceCount = mode === "live" ? activities.filter((activity) => activity.agent === agent.name).length : 0;
          const description = mode === "live" && instanceCount
            ? `${agent.name}: ${instanceCount} active instance${instanceCount === 1 ? "" : "s"}`
            : `${agent.name}: ${titleCase(status)}`;
          const contributionKey = mode === "live" ? (agent as CatalogAgent).sourcePath : agent.id;
          // A catalog id is a case-insensitive path hash, so two preserved
          // path spellings can share it on Windows. The source path is the
          // definition identity used by the live roster and remains stable
          // across status updates.
          return <span key={contributionKey} className={`contribution-cell ${status}`} role="listitem" aria-label={description} title={description} />;
        })}
      </div>
      <div className="contribution-legend" aria-hidden="true">
        <span data-short="W"><i />Wait</span>
        <span data-short="Q"><i className="queued" />Queue</span>
        <span data-short="L"><i className="working" />Live</span>
        <span data-short="D"><i className="complete" />Done</span>
        <span data-short="X"><i className="interrupted" />Stop</span>
        <span data-short="S"><i className="stalled" />Stall</span>
      </div>
    </section>
  );
}

function GlobalEventRow({ event, projects }: { event: StoredGuildEvent; projects: GuildProject[] }) {
  const projectName = projects.find((project) => project.id === event.projectId)?.name ?? "Unknown project";
  return (
    <div className="log-line global-log-line">
      <time dateTime={event.occurredAt}>{formatMoment(event.occurredAt)}</time>
      <strong>{titleCase(event.agent)} <AgentTags presentation={event.presentation} /></strong>
      <b title={projectName}>{projectName}</b>
      <span>{event.message}</span>
    </div>
  );
}

export function LiveView() {
  const {
    hydrated,
    mode,
    draft,
    setDraft,
    projects,
    selectedProjectId,
    selectedRunId,
    followLive,
    currentRun,
    currentEvents,
    recentEvents,
    agentActivities,
    agentRunCounts,
    agentMetrics,
    agentCatalog,
    storageConnected,
    healthApiConnected,
    storageHealth,
    state,
    startCommission,
    handlePause,
    statistics,
    liveStatus,
  } = useGuildData();
  const [isAgentStatusCollapsed, setIsAgentStatusCollapsed] = useState(false);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    startCommission(draft);
  };

  const selectedProject = projects.find((project) => project.id === selectedProjectId);
  const scopeName = selectedProject?.name ?? "All projects";
  const focusedProjectName = mode === "demo"
    ? "Local demo"
    : projects.find((project) => project.id === currentRun?.projectId)?.name ?? scopeName;
  const progressInfo = computeProgressInfo(mode, state, statistics.averageDurationSeconds, liveStatus.text, scopeName);
  const delegationWarning = mode === "live" && needsDelegationWarning(currentRun, currentEvents);
  const stageSummary = mode === "demo"
    ? state.delivered
      ? "Local demo · final answer ready"
      : state.currentStep >= 0 ? `Local demo · ${STEPS[state.currentStep].label}` : "Local demo · all roles are waiting"
    : currentRun
      ? `${focusedProjectName} · ${selectedRunId ? "saved run" : `${titleCase(currentRun.status)} run focus`}`
      : `${scopeName} · no run selected`;

  return (
    <>
      {!hydrated && <p className="loading-banner" role="status">Loading local activity…</p>}
      <header className="hero">
        <div><p className="kicker">Overview</p><h1>Your Codex agents, at a glance</h1><p className="hero-copy">LanternWatch detects your own global and workspace agents, then shows their real lifecycle activity with scope and custom tags.</p></div>
        <div className="commission-box"><div className="commission-context"><span>Local catalog</span><span className={`storage-state ${storageConnected ? "connected" : ""}`}>{storageConnected ? "SQLite connected" : "Waiting for local API"}</span></div><p className="hint">Manage agents, tags, and collision settings on the Agents page. Codex needs a fresh session after agent-file changes.</p></div>
      </header>

      <RoleActivity mode={mode} state={state} activities={agentActivities} catalogAgents={agentCatalog} />

      <section className="workspace" aria-label="Live team work status">
        <article className={`hall-card${isAgentStatusCollapsed ? " is-collapsed" : ""}`}>
          <div className="panel-head">
            <div className="panel-title"><div><h2>Team status</h2><p>{stageSummary}</p></div></div>
            <div className="controls">
              {selectedRunId && <button className="follow-live-btn" type="button" onClick={followLive}>Follow live</button>}
              <span className={`step-counter${selectedRunId ? " history" : ""}`}>{selectedRunId ? "HISTORY" : mode === "live" ? "LIVE" : `${state.currentStep + 1} / ${STEPS.length}`}</span>
              <button className="icon-btn" type="button" onClick={handlePause} disabled={hydrated && mode === "live"} aria-label={state.paused ? "Resume demo" : "Pause demo"} title={state.paused ? "Resume demo" : "Pause demo"}>
                {state.paused ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7V5Z" /></svg> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14m8-14v14" /></svg>}
              </button>
              <button className="icon-btn" type="button" onClick={() => startCommission(state.quest || draft)} aria-label="Replay demo" title="Replay demo"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" /></svg></button>
              <button className="icon-btn collapse-btn" type="button" onClick={() => setIsAgentStatusCollapsed((collapsed) => !collapsed)} aria-expanded={!isAgentStatusCollapsed} aria-controls="agentStatusContent" aria-label={`${isAgentStatusCollapsed ? "Expand" : "Collapse"} team status`} title={`${isAgentStatusCollapsed ? "Expand" : "Collapse"} team status`}><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={isAgentStatusCollapsed ? "m6 9 6 6 6-6" : "m18 15-6-6-6 6"} /></svg></button>
            </div>
          </div>
          <div id="agentStatusContent" className="agent-status-content">
            <div className="progress-meta">
              <span className={`progress-percent${progressInfo.isEstimate ? " is-estimate" : ""}`}>{progressInfo.headline}</span>
              <span
                className={`progress-detail${progressInfo.isEstimate ? " is-estimate" : ""}`}
                title={progressInfo.isEstimate ? `Estimated from the average run duration in ${scopeName}, not an exact countdown.` : undefined}
              >
                {progressInfo.detail}
              </span>
            </div>
            <div
              className="progress-rail"
              role="progressbar"
              aria-label="Project task progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progressInfo.percent}
              aria-valuetext={`${progressInfo.headline} — ${progressInfo.detail}`}
            >
              <div className={`progress-bar${progressInfo.isEstimate ? " is-estimate" : ""}`} style={{ width: `${progressInfo.percent}%` }} />
            </div>
            <OperationalDiagnostic dashboardConnected={storageConnected} healthApiConnected={healthApiConnected} health={storageHealth} />
            {delegationWarning && <p className="delegation-warning" role="status"><strong>No delegated specialist recorded.</strong> This terminal run has no recorded lifecycle event from an agent other than Program Manager. LanternWatch cannot tell whether a specialist worked without a recorded specialist event.</p>}
            <AgentRunList mode={mode} state={state} activities={agentActivities} agentRunCounts={agentRunCounts} catalogAgents={agentCatalog} agentMetrics={agentMetrics} />
          </div>
        </article>

        <WorkflowBoard
          mode={mode}
          hydrated={hydrated}
          storageConnected={storageConnected}
          selectedRunId={selectedRunId}
          currentRun={currentRun}
          focusedProjectName={focusedProjectName}
          activities={agentActivities}
          state={state}
        />
      </section>

      <section className="activity" aria-label="Team activity and state legend">
        <article className="activity-card">
          <div className="activity-head"><h2>Activity log</h2><span>{mode === "demo" ? "Local demo" : scopeName} · {mode === "demo" ? state.logs.length : recentEvents.length} event{(mode === "demo" ? state.logs.length : recentEvents.length) === 1 ? "" : "s"}</span></div>
          <div className="log">{mode === "demo"
            ? state.logs.length === 0
              ? <div className="log-empty">No demo activity yet. Start a project task to begin.</div>
              : state.logs.map((entry) => <div className="log-line demo-log-line" key={entry.id}><time>{formatElapsed(entry.time)}</time><strong>{entry.agent}</strong><b>Local demo</b><span>{entry.message}</span></div>)
            : recentEvents.length === 0
              ? <div className="log-empty">No saved activity in {scopeName} yet.</div>
              : recentEvents.map((entry) => <GlobalEventRow event={entry} projects={projects} key={`${entry.projectId}:${entry.eventId}`} />)
          }</div>
        </article>
        <aside className="legend-card"><h2>Status guide</h2><div className="legend-list"><div className="legend-item"><i /><span><strong>Waiting</strong> — ready, but not needed yet.</span></div><div className="legend-item"><i /><span><strong>Working</strong> — animated dots and a live timer.</span></div><div className="legend-item"><i /><span><strong>Complete</strong> — persisted in SQLite and exported to Obsidian.</span></div><div className="legend-item"><i /><span><strong>Interrupted / stalled</strong> — the session ended early or stopped reporting.</span></div></div><p className="api-note">Local API: <code>/api/guild/events</code>. {statistics.totalRuns} saved run{statistics.totalRuns === 1 ? "" : "s"} in {scopeName}.</p></aside>
      </section>
    </>
  );
}
