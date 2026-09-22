"use client";

import { useEffect, useState } from "react";
import { AGENTS } from "@/lib/guild-data";
import type { AgentPresentation, GuildProject, GuildRun, GuildStatistics, HistoryPayload, HistoryRunSummary, StoredGuildEvent, TokenUsageSummary } from "@/lib/guild-contract";
import { formatElapsed, formatMoment, titleCase } from "@/lib/guild-format";
import { useGuildData } from "@/components/guild/GuildDataContext";
import { needsDelegationWarning } from "@/components/guild/delegation-warning";

const HISTORY_PAGE_SIZE = 25;
const TOKEN_CALLOUT_STORAGE_KEY = "lanternwatch-dismissed-token-hook-callout";
type HistoryStatus = "" | "active" | "completed" | "interrupted" | "stalled";
type HistoryCursor = HistoryPayload["nextCursor"] | undefined;

function formatTokens(value: number | null | undefined) {
  return value === null || value === undefined ? "Not reported" : new Intl.NumberFormat().format(value);
}

function tokenCoverage(usage: TokenUsageSummary | undefined) {
  if (!usage || usage.reportedAgentInstances === 0) return "Not reported";
  const total = usage.reportedAgentInstances + usage.unreportedAgentInstances;
  return usage.unreportedAgentInstances > 0 ? `Partial: ${usage.reportedAgentInstances} of ${total} agent instances reported` : `${usage.reportedAgentInstances} agent instance${usage.reportedAgentInstances === 1 ? "" : "s"} reported`;
}

function ActivityTags({ presentation }: { presentation?: AgentPresentation }) {
  if (!presentation) return null;
  if (presentation.unresolved) return <span className="agent-tags unresolved" title="More than one enabled definition has this name.">Source unresolved</span>;
  return <span className="agent-tags">{presentation.scope && <i>{presentation.scope}</i>}{presentation.tags.map((tag) => <i key={tag}>{tag}</i>)}</span>;
}

function StatisticsOverview({ statistics, scopeName }: { statistics: GuildStatistics; scopeName: string }) {
  const favorite = statistics.mostUsedAgent ? AGENTS.find((agent) => agent.id === statistics.mostUsedAgent)?.name ?? titleCase(statistics.mostUsedAgent) : "No activity";
  const usage = statistics.tokenUsage;
  return <section className="statistics-overview" aria-labelledby="statisticsTitle">
    <div className="section-heading"><div><p className="kicker">History</p><h1 id="statisticsTitle">Run activity</h1></div><span>{scopeName === "All projects" ? "All saved runs across every project" : `Saved runs in ${scopeName}`}</span></div>
    <div className="stat-grid">
      <article className="stat-card"><span>Total runs</span><strong>{statistics.totalRuns}</strong><small>{statistics.activeRuns} active · {statistics.stalledRuns} stalled</small></article>
      <article className="stat-card"><span>Completion rate</span><strong>{statistics.completionRate}%</strong><small>{statistics.completedRuns} completed · {statistics.interruptedRuns} interrupted</small></article>
      <article className="stat-card"><span>Average runtime</span><strong>{formatElapsed(statistics.averageDurationSeconds)}</strong><small>{formatElapsed(statistics.totalRuntimeSeconds)} recorded total</small></article>
      <article className="stat-card"><span>Most active agent</span><strong className="stat-name">{favorite}</strong><small>{statistics.mostUsedAgentRuns} run{statistics.mostUsedAgentRuns === 1 ? "" : "s"}</small></article>
      <article className="stat-card token-stat"><span>Tokens</span><strong>{formatTokens(usage?.totalTokens)}</strong><small>{tokenCoverage(usage)}</small></article>
    </div>
  </section>;
}

function TokenHookCallout({ show }: { show: boolean }) {
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => {
    try { setDismissed(window.localStorage.getItem(TOKEN_CALLOUT_STORAGE_KEY) === "true"); }
    catch { setDismissed(false); }
  }, []);
  if (!show || dismissed) return null;
  const dismiss = () => { setDismissed(true); try { window.localStorage.setItem(TOKEN_CALLOUT_STORAGE_KEY, "true"); } catch { /* The current session may still dismiss it. */ } };
  return <aside className="token-hook-callout" role="status"><div><strong>Codex token reporting unavailable through hooks.</strong><span>Token values will remain Not reported until a host receipt is stored.</span></div><button type="button" onClick={dismiss} aria-label="Dismiss token reporting notice">Dismiss</button></aside>;
}

function HistoryRunRow({ item, selected, onSelect }: { item: HistoryRunSummary; selected: boolean; onSelect: (runId: string) => void }) {
  return <button className={`history-run-row${selected ? " selected" : ""}`} type="button" role="listitem" onClick={() => onSelect(item.id)} aria-pressed={selected}>
    <span><strong>{item.quest || "Codex task"}</strong><small><b>{item.projectName}</b> · {formatMoment(item.startedAt)}</small></span><span className={`run-status ${item.status}`}>{titleCase(item.status)}</span>
    <small>{formatElapsed(item.durationSeconds)} · {item.participants.length} role{item.participants.length === 1 ? "" : "s"} · {item.eventCount} event{item.eventCount === 1 ? "" : "s"}</small>
    <small title={item.participants.map(titleCase).join(", ")}>{item.participants.length ? item.participants.map(titleCase).join(", ") : "No recorded participants"}</small>
  </button>;
}

function HistoryExplorer({ projectId, selectedRunId, onSelectRun }: { projectId: string; selectedRunId: string; onSelectRun: (runId: string) => void }) {
  const [search, setSearch] = useState(""); const [debouncedSearch, setDebouncedSearch] = useState(""); const [status, setStatus] = useState<HistoryStatus>(""); const [agent, setAgent] = useState(""); const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [page, setPage] = useState(0); const [cursors, setCursors] = useState<HistoryCursor[]>([undefined]); const [payload, setPayload] = useState<HistoryPayload | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  useEffect(() => { const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300); return () => window.clearTimeout(timer); }, [search]);
  useEffect(() => { setPage(0); setCursors([undefined]); }, [projectId, debouncedSearch, status, agent, from, to]);
  useEffect(() => {
    const controller = new AbortController(); const params = new URLSearchParams({ limit: String(HISTORY_PAGE_SIZE) });
    if (projectId) params.set("projectId", projectId); if (debouncedSearch) params.set("q", debouncedSearch); if (status) params.set("status", status); if (agent) params.set("agent", agent); if (from) params.set("from", from); if (to) params.set("to", to);
    const cursor = cursors[page]; if (cursor) params.set("cursor", btoa(JSON.stringify(cursor)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, ""));
    setLoading(true); setError("");
    void fetch(`/api/guild/history?${params.toString()}`, { cache: "no-store", signal: controller.signal }).then(async (response) => { const next = await response.json() as HistoryPayload & { error?: string }; if (!response.ok) throw new Error(next.error || "History could not be loaded."); setPayload(next); }).catch((reason: unknown) => { if (!(reason instanceof DOMException && reason.name === "AbortError")) setError(reason instanceof Error ? reason.message : "History could not be loaded."); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [projectId, debouncedSearch, status, agent, from, to, page, cursors]);
  const filtersActive = Boolean(search || status || agent || from || to);
  const clearFilters = () => { setSearch(""); setStatus(""); setAgent(""); setFrom(""); setTo(""); };
  const next = () => { if (!payload?.nextCursor) return; setCursors((current) => current.length > page + 1 ? current : [...current, payload.nextCursor]); setPage((current) => current + 1); };
  return <section className="history-explorer" aria-labelledby="historyExplorerTitle">
    <div className="history-explorer-head"><div><h2 id="historyExplorerTitle">Explore recorded runs</h2><p>Searches all recorded runs in the selected project scope.</p></div><span aria-live="polite">{loading ? "Loading runs…" : `${payload?.totalMatches ?? 0} matching run${payload?.totalMatches === 1 ? "" : "s"}`}</span></div>
    <div className="history-filters"><label className="history-search">Search recorded work<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Task, project, run ID, or event" type="search" /></label><label>Status<select value={status} onChange={(event) => setStatus(event.target.value as HistoryStatus)}><option value="">All statuses</option><option value="active">Active</option><option value="completed">Completed</option><option value="interrupted">Interrupted</option><option value="stalled">Stalled</option></select></label><label>Agent<select value={agent} onChange={(event) => setAgent(event.target.value)}><option value="">All agents</option>{AGENTS.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>From<input value={from} onChange={(event) => setFrom(event.target.value)} type="date" /></label><label>To<input value={to} onChange={(event) => setTo(event.target.value)} type="date" /></label>{filtersActive && <button className="history-clear" type="button" onClick={clearFilters}>Clear filters</button>}</div>
    {error ? <p className="history-state history-error" role="alert">{error}</p> : loading && !payload ? <p className="history-state" role="status">Loading recorded history…</p> : payload?.items.length ? <><div className="history-results" role="list" aria-label="Recorded runs">{payload.items.map((item) => <HistoryRunRow item={item} selected={selectedRunId === item.id} onSelect={onSelectRun} key={item.id} />)}</div><nav className="history-pagination" aria-label="History pages"><button type="button" onClick={() => setPage((current) => current - 1)} disabled={page === 0 || loading}>Previous</button><span>Page {page + 1}</span><button type="button" onClick={next} disabled={!payload.nextCursor || loading}>Next</button></nav></> : <p className="history-state">{filtersActive ? "No recorded runs match these filters. Clear filters to see the full history." : "No recorded runs yet. Start a project task from Overview; its lifecycle receipts will appear here."}</p>}
  </section>;
}

function RunDetailsPanel({ run, events, projects, selectedRunId, onSelectRun }: { run: GuildRun | null; events: StoredGuildEvent[]; projects: GuildProject[]; selectedRunId: string; onSelectRun: (runId: string) => void }) {
  const participants = [...new Set(events.map((event) => event.agent))]; const delegationWarning = needsDelegationWarning(run, events); const projectNameFor = (projectId: string) => projects.find((project) => project.id === projectId)?.name ?? "Unknown project"; const runProjectName = run ? projectNameFor(run.projectId) : null; const usage = run?.tokenUsage;
  return <section className="run-details" aria-labelledby="runDetailsTitle"><article className="run-detail-card"><div className="section-heading"><div><p className="kicker">Selected project task</p><h2 id="runDetailsTitle">Run details</h2></div>{run && <span className={`run-status ${run.status}`}>{titleCase(run.status)}</span>}</div>{!run ? <p className="empty-copy">Select a recorded run to inspect its events.</p> : <><div className="run-project-label"><span>Project</span><strong>{runProjectName}</strong></div><h3 className="run-quest">{run.quest || "Codex task"}</h3><div className="run-facts"><div><span>Started</span><strong>{formatMoment(run.startedAt)}</strong></div><div><span>Finished</span><strong>{formatMoment(run.completedAt)}</strong></div><div><span>Runtime</span><strong>{formatElapsed(run.durationSeconds)}</strong></div><div><span>Activity</span><strong>{events.length} events · {participants.length} roles</strong></div></div><div className="run-token-summary"><span>Tokens</span><strong>{formatTokens(usage?.totalTokens)}</strong><small>{tokenCoverage(usage)}</small></div><div className="run-identity"><span>Run ID</span><code>{run.id}</code></div>{delegationWarning && <p className="delegation-warning" role="status"><strong>No delegated specialist recorded.</strong> This terminal run has no recorded lifecycle event from an agent other than Program Manager. LanternWatch cannot tell whether a specialist worked without a recorded specialist event.</p>}<div className="event-trail" role="list" aria-label="Selected run event trail">{events.map((event) => <div className={`event-row ${event.status}`} role="listitem" key={event.eventId}><time>{formatElapsed(event.elapsedSeconds)}</time><strong>{AGENTS.find((agent) => agent.id === event.agent)?.name ?? titleCase(event.agent)} <ActivityTags presentation={event.presentation} /></strong><span>{event.message}</span><i>{titleCase(event.status)}</i></div>)}</div></>}</article><aside className="recent-runs-card"><div className="recent-runs-head"><div><h2>Selected run</h2></div>{selectedRunId && <button type="button" onClick={() => onSelectRun("")}>Follow live</button>}</div><p className="recent-empty">Choose a row above to load its recorded event trail.</p></aside></section>;
}

export function HistoryView() {
  const { statistics, currentRun, currentEvents, projects, selectedProjectId, selectedRunId, selectRun } = useGuildData(); const scopeName = projects.find((project) => project.id === selectedProjectId)?.name ?? "All projects"; const tokenUnavailable = (statistics.tokenUsage?.reportedAgentInstances ?? 0) === 0;
  return <><StatisticsOverview statistics={statistics} scopeName={scopeName} /><TokenHookCallout show={tokenUnavailable} /><HistoryExplorer projectId={selectedProjectId} selectedRunId={selectedRunId} onSelectRun={selectRun} /><RunDetailsPanel run={currentRun} events={currentEvents} projects={projects} selectedRunId={selectedRunId} onSelectRun={selectRun} /></>;
}
