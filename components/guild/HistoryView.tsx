"use client";

import { AGENTS } from "@/lib/guild-data";
import type { GuildRun, GuildStatistics, StoredGuildEvent } from "@/lib/guild-contract";
import { formatElapsed, formatMoment, titleCase } from "@/lib/guild-format";
import { useGuildData } from "@/components/guild/GuildDataContext";

function StatisticsOverview({ statistics }: { statistics: GuildStatistics }) {
  const favorite = statistics.mostUsedAgent
    ? AGENTS.find((agent) => agent.id === statistics.mostUsedAgent)?.name ?? titleCase(statistics.mostUsedAgent)
    : "No activity";
  return (
    <section className="statistics-overview" aria-labelledby="statisticsTitle">
      <div className="section-heading"><div><p className="kicker">Guild ledger</p><h2 id="statisticsTitle">Statistics overview</h2></div><span>All saved runs in this project</span></div>
      <div className="stat-grid">
        <article className="stat-card"><span>Total runs</span><strong>{statistics.totalRuns}</strong><small>{statistics.activeRuns} active · {statistics.stalledRuns} stalled</small></article>
        <article className="stat-card"><span>Completion rate</span><strong>{statistics.completionRate}%</strong><small>{statistics.completedRuns} completed · {statistics.interruptedRuns} interrupted</small></article>
        <article className="stat-card"><span>Average runtime</span><strong>{formatElapsed(statistics.averageDurationSeconds)}</strong><small>{formatElapsed(statistics.totalRuntimeSeconds)} recorded total</small></article>
        <article className="stat-card"><span>Most used agent</span><strong className="stat-name">{favorite}</strong><small>{statistics.mostUsedAgentRuns} run{statistics.mostUsedAgentRuns === 1 ? "" : "s"}</small></article>
      </div>
    </section>
  );
}

function RunDetailsPanel({ run, events, runs, selectedRunId, onSelectRun }: {
  run: GuildRun | null;
  events: StoredGuildEvent[];
  runs: GuildRun[];
  selectedRunId: string;
  onSelectRun: (runId: string) => void;
}) {
  const participants = [...new Set(events.map((event) => event.agent))];
  return (
    <section className="run-details" aria-labelledby="runDetailsTitle">
      <article className="run-detail-card">
        <div className="section-heading">
          <div><p className="kicker">Selected commission</p><h2 id="runDetailsTitle">Run details</h2></div>
          {run && <span className={`run-status ${run.status}`}>{titleCase(run.status)}</span>}
        </div>
        {!run ? <p className="empty-copy">No saved run is available yet.</p> : <>
          <h3 className="run-quest">{run.quest || "Codex task"}</h3>
          <div className="run-facts">
            <div><span>Started</span><strong>{formatMoment(run.startedAt)}</strong></div>
            <div><span>Finished</span><strong>{formatMoment(run.completedAt)}</strong></div>
            <div><span>Runtime</span><strong>{formatElapsed(run.durationSeconds)}</strong></div>
            <div><span>Activity</span><strong>{events.length} events · {participants.length} agents</strong></div>
          </div>
          <div className="run-identity"><span>Run ID</span><code>{run.id}</code></div>
          <div className="event-trail" role="list" aria-label="Selected run event trail">
            {events.map((event) => <div className={`event-row ${event.status}`} role="listitem" key={event.eventId}><time>{formatElapsed(event.elapsedSeconds)}</time><strong>{AGENTS.find((agent) => agent.id === event.agent)?.name ?? titleCase(event.agent)}</strong><span>{event.message}</span><i>{titleCase(event.status)}</i></div>)}
          </div>
        </>}
      </article>
      <aside className="recent-runs-card">
        <div className="recent-runs-head"><div><p className="kicker">History</p><h2>Recent runs</h2></div>{selectedRunId && <button type="button" onClick={() => onSelectRun("")}>Follow live</button>}</div>
        <div className="recent-runs-list">
          {runs.map((item) => <button className={run?.id === item.id ? "selected" : ""} type="button" key={item.id} onClick={() => onSelectRun(item.id)} aria-pressed={run?.id === item.id}><span><strong>{item.quest || "Codex task"}</strong><small>{formatMoment(item.startedAt)}</small></span><span className={`run-status ${item.status}`}>{titleCase(item.status)}</span><time>{formatElapsed(item.durationSeconds)}</time></button>)}
        </div>
      </aside>
    </section>
  );
}

export function HistoryView() {
  const { statistics, currentRun, currentEvents, savedRuns, selectedRunId, selectRun } = useGuildData();

  return (
    <>
      <StatisticsOverview statistics={statistics} />
      <RunDetailsPanel
        run={currentRun}
        events={currentEvents}
        runs={savedRuns}
        selectedRunId={selectedRunId}
        onSelectRun={selectRun}
      />
    </>
  );
}
