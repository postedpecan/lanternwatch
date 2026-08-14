"use client";

import { useGuildData } from "@/components/guild/GuildDataContext";

export function AboutDetails() {
  const {
    currentRun,
    projects,
    selectedProjectId,
    storageConnected,
    statistics,
    state,
    liveStatus,
  } = useGuildData();
  const project = projects.find((item) => item.id === selectedProjectId);

  return (
    <details className="about-details">
      <summary aria-label="About Lanternwatch" title="About Lanternwatch">
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-10h.01" /></svg>
        <span>About</span>
      </summary>
      <div className="about-panel">
        <div className="about-heading">
          <div>
            <strong>Lanternwatch</strong>
            <span>agent-runtime</span>
          </div>
          <span className={`about-live-state${liveStatus.live ? " is-live" : ""}`} role="status">
            <i aria-hidden="true" />{liveStatus.text}
          </span>
        </div>
        <p>A local-first dashboard for watching an AI project team collaborate, hand off tasks, and preserve a durable run history.</p>
        <dl className="about-facts">
          <div><dt>Scope</dt><dd>{project?.name ?? "All projects"}</dd></div>
          <div><dt>Saved runs</dt><dd>{statistics.totalRuns}</dd></div>
          <div><dt>Storage</dt><dd>{storageConnected ? "SQLite + Obsidian" : "Local API offline"}</dd></div>
          <div><dt>Current run</dt><dd>{currentRun ? currentRun.status : state.running ? "working" : "none"}</dd></div>
        </dl>
        <div className="about-tags" aria-label="Project technologies">
          <span>Next.js</span><span>SQLite</span><span>Obsidian</span>
        </div>
      </div>
    </details>
  );
}
