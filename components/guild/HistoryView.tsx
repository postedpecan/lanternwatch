"use client";

import { AGENTS } from "@/lib/guild-data";
import type { AgentPresentation, GuildProject, GuildRun, GuildStatistics, StoredGuildEvent } from "@/lib/guild-contract";
import { formatElapsed, formatMoment, titleCase } from "@/lib/guild-format";
import { useGuildData } from "@/components/guild/GuildDataContext";
import { needsDelegationWarning } from "@/components/guild/delegation-warning";

function ActivityTags({ presentation }: { presentation?: AgentPresentation }) {
  if (!presentation) return null;
  if (presentation.unresolved) return <span className="agent-tags unresolved" title="More than one enabled definition has this name.">Source unresolved</span>;
  return <span className="agent-tags">{presentation.scope && <i>{presentation.scope}</i>}{presentation.tags.map((tag) => <i key={tag}>{tag}</i>)}</span>;
}

function StatisticsOverview({ statistics, scopeName }: { statistics: GuildStatistics; scopeName: string }) {
  const favorite = statistics.mostUsedAgent
    ? AGENTS.find((agent) => agent.id === statistics.mostUsedAgent)?.name ?? titleCase(statistics.mostUsedAgent)
    : "No activity";
  return (
    <section className="statistics-overview" aria-labelledby="statisticsTitle">
      <div className="section-heading"><div><p className="kicker">History</p><h2 id="statisticsTitle">Run activity</h2></div><span>{scopeName === "All projects" ? "All saved runs across every project" : `Saved runs in ${scopeName}`}</span></div>
      <div className="stat-grid">
        <article className="stat-card"><span>Total runs</span><strong>{statistics.totalRuns}</strong><small>{statistics.activeRuns} active · {statistics.stalledRuns} stalled</small></article>
        <article className="stat-card"><span>Completion rate</span><strong>{statistics.completionRate}%</strong><small>{statistics.completedRuns} completed · {statistics.interruptedRuns} interrupted</small></article>
        <article className="stat-card"><span>Average runtime</span><strong>{formatElapsed(statistics.averageDurationSeconds)}</strong><small>{formatElapsed(statistics.totalRuntimeSeconds)} recorded total</small></article>
        <article className="stat-card"><span>Most active agent</span><strong className="stat-name">{favorite}</strong><small>{statistics.mostUsedAgentRuns} run{statistics.mostUsedAgentRuns === 1 ? "" : "s"}</small></article>
      </div>
    </section>
  );
}

function RunDetailsPanel({ run, events, runs, projects, selectedRunId, onSelectRun }: {
  run: GuildRun | null;
  events: StoredGuildEvent[];
  runs: GuildRun[];
  projects: GuildProject[];
  selectedRunId: string;
  onSelectRun: (runId: string) => void;
}) {
  const participants = [...new Set(events.map((event) => event.agent))];
  const delegationWarning = needsDelegationWarning(run, events);
  const projectNameFor = (projectId: string) => projects.find((project) => project.id === projectId)?.name ?? "Unknown project";
  const runProjectName = run ? projectNameFor(run.projectId) : null;
  return (
    <section className="run-details" aria-labelledby="runDetailsTitle">
      <article className="run-detail-card">
        <div className="section-heading">
          <div><p className="kicker">Selected project task</p><h2 id="runDetailsTitle">Run details</h2></div>
          {run && <span className={`run-status ${run.status}`}>{titleCase(run.status)}</span>}
        </div>
        {!run ? <p className="empty-copy">No saved run is available yet.</p> : <>
          <div className="run-project-label"><span>Project</span><strong>{runProjectName}</strong></div>
          <h3 className="run-quest">{run.quest || "Codex task"}</h3>
          <div className="run-facts">
            <div><span>Started</span><strong>{formatMoment(run.startedAt)}</strong></div>
            <div><span>Finished</span><strong>{formatMoment(run.completedAt)}</strong></div>
            <div><span>Runtime</span><strong>{formatElapsed(run.durationSeconds)}</strong></div>
            <div><span>Activity</span><strong>{events.length} events · {participants.length} roles</strong></div>
          </div>
          <div className="run-identity"><span>Run ID</span><code>{run.id}</code></div>
          {delegationWarning && <p className="delegation-warning" role="status"><strong>No delegated specialist recorded.</strong> This terminal run has no recorded lifecycle event from an agent other than Program Manager. LanternWatch cannot tell whether a specialist worked without a recorded specialist event.</p>}
          <div className="event-trail" role="list" aria-label="Selected run event trail">
            {events.map((event) => <div className={`event-row ${event.status}`} role="listitem" key={event.eventId}><time>{formatElapsed(event.elapsedSeconds)}</time><strong>{AGENTS.find((agent) => agent.id === event.agent)?.name ?? titleCase(event.agent)} <ActivityTags presentation={event.presentation} /></strong><span>{event.message}</span><i>{titleCase(event.status)}</i></div>)}
          </div>
        </>}
      </article>
      <aside className="recent-runs-card">
        <div className="recent-runs-head"><div><p className="kicker">History</p><h2>Recent runs</h2></div>{selectedRunId && <button type="button" onClick={() => onSelectRun("")}>Follow live</button>}</div>
        <div className="recent-runs-list">
          {runs.length === 0
            ? <p className="empty-copy recent-empty">No saved runs yet. Start a project task from Overview to create one.</p>
            : runs.map((item) => <button className={run?.id === item.id ? "selected" : ""} type="button" key={item.id} onClick={() => onSelectRun(item.id)} aria-pressed={run?.id === item.id}><span><strong>{item.quest || "Codex task"}</strong><small><b>{projectNameFor(item.projectId)}</b> · {formatMoment(item.startedAt)}</small></span><span className={`run-status ${item.status}`}>{titleCase(item.status)}</span><time>{formatElapsed(item.durationSeconds)}</time></button>)}
        </div>
      </aside>
    </section>
  );
}

export function HistoryView() {
  const { statistics, currentRun, currentEvents, savedRuns, projects, selectedProjectId, selectedRunId, selectRun } = useGuildData();
  const scopeName = projects.find((project) => project.id === selectedProjectId)?.name ?? "All projects";

  return (
    <>
      <StatisticsOverview statistics={statistics} scopeName={scopeName} />
      <RunDetailsPanel
        run={currentRun}
        events={currentEvents}
        runs={savedRuns}
        projects={projects}
        selectedRunId={selectedRunId}
        onSelectRun={selectRun}
      />
    </>
  );
}
