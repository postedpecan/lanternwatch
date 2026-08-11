"use client";

import { useState, type FormEvent } from "react";
import { AGENTS, AGENT_IDS, STEPS, type AgentId } from "@/lib/guild-data";
import type { GuildStorageHealth } from "@/lib/guild-contract";
import { formatAge, formatElapsed, titleCase } from "@/lib/guild-format";
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
        detail: `Elapsed ${elapsedText} · no estimate yet (no completed runs for this project)`,
        isEstimate: true,
      };
    }
    if (state.elapsed >= averageDurationSeconds) {
      return {
        percent: LIVE_ESTIMATE_CAP_PERCENT,
        headline: "~est.",
        detail: `Elapsed ${elapsedText} · running longer than the ${formatElapsed(averageDurationSeconds)} average`,
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
  state,
  agentRunCounts,
  hasRun,
}: {
  state: GuildState;
  agentRunCounts: Record<AgentId, number>;
  hasRun: boolean;
}) {
  const renderAgent = (agent: (typeof orderedAgents)[number]) => {
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
            <small>{agent.specialty}</small>
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

  return (
    <div className="agent-run-list" aria-label="Agent status and runtime">
      <section className="agent-run-group live-group" aria-labelledby="liveAgentsTitle">
        <div className="agent-group-heading"><div><span className="group-live-dot" aria-hidden="true" /><h3 id="liveAgentsTitle">Live agents</h3></div><strong>{liveAgents.length}</strong></div>
        <div role="list">{liveAgents.length ? liveAgents.map(renderAgent) : <p className="agent-group-empty">No agents are working right now.</p>}</div>
      </section>
      {usedAgents.length > 0 && <section className="agent-run-group used-group" aria-labelledby="usedAgentsTitle">
        <div className="agent-group-heading"><div><h3 id="usedAgentsTitle">Used in this run</h3></div><strong>{usedAgents.length}</strong></div>
        <div role="list">{usedAgents.map(renderAgent)}</div>
      </section>}
      <section className="agent-run-group other-group" aria-labelledby="otherAgentsTitle">
        <div className="agent-group-heading"><div><h3 id="otherAgentsTitle">{hasRun ? "Other agents" : "Available agents"}</h3><small>{hasRun ? "Not used in this run" : "Ready for the next run"}</small></div><strong>{otherAgents.length}</strong></div>
        <div role="list">{otherAgents.length ? otherAgents.map(renderAgent) : <p className="agent-group-empty">Every agent has participated in this run.</p>}</div>
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

export function LiveView() {
  const {
    hydrated,
    mode,
    draft,
    setDraft,
    projects,
    selectedProjectId,
    selectProject,
    selectedRunId,
    followLive,
    currentRun,
    agentRunCounts,
    storageConnected,
    healthApiConnected,
    storageHealth,
    state,
    startCommission,
    handlePause,
    savedRuns,
    statistics,
    liveStatus,
  } = useGuildData();
  const [isAgentStatusCollapsed, setIsAgentStatusCollapsed] = useState(false);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    startCommission(draft);
  };

  const progressInfo = computeProgressInfo(mode, state, statistics.averageDurationSeconds, liveStatus.text);
  const stageSummary = state.delivered
    ? "Commission complete — final answer ready"
    : state.currentStep >= 0 ? STEPS[state.currentStep].label : "All agents are waiting";

  return (
    <>
      <header className="hero">
        <div><p className="kicker">Agent runtime</p><h1>Watch each agent work.</h1><p className="hero-copy">A clear text view shows who is working, who has finished, and exactly how long each role has been active.</p></div>
        <form className="commission-box" onSubmit={handleSubmit}>
          <div className="project-picker">
            <label htmlFor="projectSelect">Live project</label>
            <select
              id="projectSelect"
              value={selectedProjectId}
              onChange={(event) => selectProject(event.target.value)}
              disabled={hydrated && projects.length === 0}
            >
              {projects.length === 0 ? <option value="">No saved projects yet</option> : projects.map((project) => (
                <option value={project.id} key={project.id}>{project.name}</option>
              ))}
            </select>
            <span className={`storage-state ${storageConnected ? "connected" : ""}`}>
              {storageConnected ? "SQLite + Obsidian connected" : "Waiting for local API"}
            </span>
          </div>
          <label htmlFor="commissionInput">Your commission</label>
          <textarea id="commissionInput" maxLength={260} value={draft} onChange={(event) => setDraft(event.target.value)} />
          <div className="commission-actions"><span className="hint">Live runs sync automatically; this button starts a local demo.</span><button className="primary-btn" type="submit" disabled={mode === "demo" && state.running}>{mode === "demo" && state.running ? "Demo running…" : "Run demo"}</button></div>
        </form>
      </header>

      <section className="workspace" aria-label="Live agent work status">
        <article className={`hall-card${isAgentStatusCollapsed ? " is-collapsed" : ""}`}>
          <div className="panel-head">
            <div className="panel-title"><div><h2>Agent status</h2><p>{stageSummary}</p></div></div>
            <div className="controls">{selectedRunId && <button className="follow-live-btn" type="button" onClick={followLive}>Follow live</button>}<span className={`step-counter${selectedRunId ? " history" : ""}`}>{selectedRunId ? "HISTORY" : mode === "live" ? "LIVE" : `${state.currentStep + 1} / ${STEPS.length}`}</span><button className="icon-btn" type="button" onClick={handlePause} disabled={hydrated && mode === "live"} aria-label={state.paused ? "Resume demo" : "Pause demo"}>{state.paused ? "▶" : "Ⅱ"}</button><button className="icon-btn" type="button" onClick={() => startCommission(state.quest || draft)} aria-label="Replay demo">↻</button><button className="icon-btn collapse-btn" type="button" onClick={() => setIsAgentStatusCollapsed((collapsed) => !collapsed)} aria-expanded={!isAgentStatusCollapsed} aria-controls="agentStatusContent" aria-label={`${isAgentStatusCollapsed ? "Expand" : "Collapse"} agent status`} title={`${isAgentStatusCollapsed ? "Expand" : "Collapse"} agent status`}><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={isAgentStatusCollapsed ? "m6 9 6 6 6-6" : "m18 15-6-6-6 6"} /></svg></button></div>
          </div>
          <div id="agentStatusContent" className="agent-status-content">
            <div className="progress-meta">
              <span className={`progress-percent${progressInfo.isEstimate ? " is-estimate" : ""}`}>{progressInfo.headline}</span>
              <span
                className={`progress-detail${progressInfo.isEstimate ? " is-estimate" : ""}`}
                title={progressInfo.isEstimate ? "Estimated from this project's average run duration, not an exact countdown." : undefined}
              >
                {progressInfo.detail}
              </span>
            </div>
            <div
              className="progress-rail"
              role="progressbar"
              aria-label="Commission progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progressInfo.percent}
              aria-valuetext={`${progressInfo.headline} — ${progressInfo.detail}`}
            >
              <div className={`progress-bar${progressInfo.isEstimate ? " is-estimate" : ""}`} style={{ width: `${progressInfo.percent}%` }} />
            </div>
            <OperationalDiagnostic dashboardConnected={storageConnected} healthApiConnected={healthApiConnected} health={storageHealth} />
            <AgentRunList state={state} agentRunCounts={agentRunCounts} hasRun={currentRun !== null} />
          </div>
        </article>

        <aside className="workboard" aria-label="Commission workboard">
          <div className="panel-head"><div className="panel-title"><div><h2>Workflow</h2><p>Live dependencies and handoffs</p></div></div><span className="step-counter">{formatElapsed(state.elapsed)}</span></div>
          <div className="quest-mini"><span>Active commission</span><p>{state.quest || "No commission has started."}</p></div>
          <Timeline state={state} />
          <div className="active-detail" aria-live="polite"><div className="detail-top"><h3>{state.detail.title}</h3><span className="working-tag">{state.detail.tag}</span></div><p>{state.detail.text}</p></div>
        </aside>
      </section>

      <section className="activity" aria-label="Agent activity and state legend">
        <article className="activity-card">
          <div className="activity-head"><h2>Activity log</h2><span>{state.logs.length} event{state.logs.length === 1 ? "" : "s"}</span></div>
          <div className="log">{state.logs.length === 0 ? <div className="log-empty">No activity yet. Start a commission to begin.</div> : state.logs.map((entry) => <div className="log-line" key={entry.id}><time>{formatElapsed(entry.time)}</time><strong>{entry.agent}</strong><span>{entry.message}</span></div>)}</div>
        </article>
        <aside className="legend-card"><h2>Status guide</h2><div className="legend-list"><div className="legend-item"><i /><span><strong>Waiting</strong> — ready, but not needed yet.</span></div><div className="legend-item"><i /><span><strong>Working</strong> — animated dots and a live timer.</span></div><div className="legend-item"><i /><span><strong>Complete</strong> — persisted in SQLite and exported to Obsidian.</span></div><div className="legend-item"><i /><span><strong>Interrupted / stalled</strong> — the session ended early or stopped reporting.</span></div></div><p className="api-note">Local API: <code>/api/guild/events</code>. {savedRuns.length} saved run{savedRuns.length === 1 ? "" : "s"} for this project.</p></aside>
      </section>
    </>
  );
}
