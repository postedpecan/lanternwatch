"use client";

import { useState, type FormEvent } from "react";
import { AGENTS, AGENT_IDS, STEPS, type AgentId } from "@/lib/guild-data";
import type { GuildAgentActivity, GuildProject, GuildStorageHealth, StoredGuildEvent } from "@/lib/guild-contract";
import { formatAge, formatElapsed, formatMoment, titleCase } from "@/lib/guild-format";
import { describeHookDiagnostic } from "@/components/guild/hook-diagnostic";
import {
  DEMO_TOTAL_DURATION_SECONDS,
  runtimeFor,
  useGuildData,
  type DataMode,
  type GuildState,
} from "@/components/guild/GuildDataContext";

const orderedAgents = AGENT_IDS.map((id) => AGENTS.find((agent) => agent.id === id)!);

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
}: {
  mode: DataMode;
  state: GuildState;
  activities: GuildAgentActivity[];
  agentRunCounts: Record<AgentId, number>;
}) {
  if (mode === "live") {
    const activitiesByRole = new Map<AgentId, GuildAgentActivity[]>();
    for (const activity of activities) {
      const roleActivities = activitiesByRole.get(activity.agent) ?? [];
      roleActivities.push(activity);
      activitiesByRole.set(activity.agent, roleActivities);
    }

    return (
      <div className="agent-instance-grid" aria-label="Team role status, project, activity, and runtime">
        {orderedAgents.map((agent) => {
          const roleActivities = activitiesByRole.get(agent.id) ?? [];
          return (
            <section className={`agent-instance-group${roleActivities.length ? " is-active" : " is-idle"}`} key={agent.id} aria-labelledby={`agentGroup-${agent.id}`}>
              <div className="agent-instance-heading">
                <h3 id={`agentGroup-${agent.id}`}>{agent.name}</h3>
                <span>{roleActivities.length ? `${roleActivities.length} active` : "Idle"}</span>
              </div>
              <div role="list">
                {roleActivities.length ? roleActivities.map((activity) => (
                  <div className={`agent-instance-row ${activity.status}`} role="listitem" key={activity.id}>
                    <div className="agent-instance-main">
                      <div className="agent-instance-project">
                        <strong>{activity.projectName}</strong>
                        <span>{titleCase(activity.status)}{activity.status === "working" && <span className="loading-dots" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span>}</span>
                      </div>
                      <p>{activity.message}</p>
                    </div>
                    <time dateTime={`PT${activity.durationSeconds}S`}>{formatElapsed(activity.durationSeconds)}</time>
                  </div>
                )) : (
                  <div className="agent-idle-row" role="listitem">
                    <span>{agent.specialty}</span>
                    <small>Used in {agentRunCounts[agent.id]} run{agentRunCounts[agent.id] === 1 ? "" : "s"}</small>
                  </div>
                )}
              </div>
            </section>
          );
        })}
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

function Timeline({ state }: { state: GuildState }) {
  return (
    <div className="timeline">
      {STEPS.map((step, index) => (
        <div className={`timeline-row ${state.timelineStatuses[index]}`} key={step.id}>
          <span className="timeline-node">{String(index + 1).padStart(2, "0")}</span>
          <div className="timeline-copy"><strong>{step.label}</strong><span>{step.agentLabel}</span></div>
          <time>{state.timelineTimes[index] === null ? "—" : formatElapsed(state.timelineTimes[index]!)}</time>
        </div>
      ))}
    </div>
  );
}

function RoleActivity({ mode, state, activities }: { mode: DataMode; state: GuildState; activities: GuildAgentActivity[] }) {
  const liveRoleStatuses = new Map<AgentId, "queued" | "working">();
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
      <div className="contribution-grid" role="list" aria-label="Activity by company role">
        {orderedAgents.map((agent) => {
          const status = mode === "live" ? liveRoleStatuses.get(agent.id) ?? "waiting" : state.roomStatuses[agent.id];
          const instanceCount = mode === "live" ? activities.filter((activity) => activity.agent === agent.id).length : 0;
          const description = mode === "live" && instanceCount
            ? `${agent.name}: ${instanceCount} active instance${instanceCount === 1 ? "" : "s"}`
            : `${agent.name}: ${titleCase(status)}`;
          return <span key={agent.id} className={`contribution-cell ${status}`} role="listitem" aria-label={description} title={description} />;
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
  const agentName = AGENTS.find((agent) => agent.id === event.agent)?.name ?? titleCase(event.agent);
  return (
    <div className="log-line global-log-line">
      <time dateTime={event.occurredAt}>{formatMoment(event.occurredAt)}</time>
      <strong>{agentName}</strong>
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
    recentEvents,
    agentActivities,
    agentRunCounts,
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
        <div><p className="kicker">Overview</p><h2>Team activity, at a glance</h2><p className="hero-copy">See which company roles are working, which have finished, and how long each has been active.</p></div>
        <form className="commission-box" onSubmit={handleSubmit}>
          <div className="commission-context">
            <span>Demo workspace</span>
            <span className={`storage-state ${storageConnected ? "connected" : ""}`}>
              {storageConnected ? "SQLite + Obsidian connected" : "Waiting for local API"}
            </span>
          </div>
          <label htmlFor="commissionInput">Project task</label>
          <textarea id="commissionInput" maxLength={260} value={draft} onChange={(event) => setDraft(event.target.value)} />
          <div className="commission-actions"><span className="hint">Live runs sync automatically; this button starts a local demo.</span><button className="primary-btn" type="submit" disabled={mode === "demo" && state.running}>{mode === "demo" && state.running ? "Demo running…" : "Run demo"}</button></div>
        </form>
      </header>

      <RoleActivity mode={mode} state={state} activities={agentActivities} />

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
            <AgentRunList mode={mode} state={state} activities={agentActivities} agentRunCounts={agentRunCounts} />
          </div>
        </article>

        <aside className="workboard" aria-label="Project task workflow">
          <div className="panel-head"><div className="panel-title"><div><h2>Workflow</h2><p>{focusedProjectName} · focused dependencies and handoffs</p></div></div><span className="step-counter">{formatElapsed(state.elapsed)}</span></div>
          <div className="quest-mini"><span>{selectedRunId ? "Selected project task" : "Focused project task"} · {focusedProjectName}</span><p>{state.quest || "No project task has started."}</p></div>
          <Timeline state={state} />
          <div className="active-detail" aria-live="polite"><div className="detail-top"><h3>{state.detail.title}</h3><span className="working-tag">{state.detail.tag}</span></div><p>{state.detail.text}</p></div>
        </aside>
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
