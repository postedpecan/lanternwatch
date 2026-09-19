"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AboutDetails } from "@/components/guild/AboutDetails";
import { AppearanceDetails } from "@/components/guild/AppearanceDetails";
import { useGuildData } from "@/components/guild/GuildDataContext";
import { getProjectFilterState } from "@/components/guild/project-filter-state";

export function TopBar() {
  const {
    hydrated,
    mode,
    projects,
    selectedProjectId,
    selectProject,
    theme,
    toggleTheme,
    liveStatus,
  } = useGuildData();
  const pathname = usePathname();
  const projectFilterState = getProjectFilterState(hydrated, mode, projects.length);

  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link className="brand" href="/" aria-label="Lanternwatch overview">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false"><path d="M9 3h6M10 3v3m4-3v3m-6 5h8l1 9H7l1-9Zm2-5h4l2 5H8l2-5Z" /></svg>
          </span>
          <span><strong>Lanternwatch</strong><small>agent-runtime</small></span>
        </Link>
        <div className={`live-pill ${liveStatus.live ? "" : "idle"}`} role="status">
          <span className="live-dot" aria-hidden="true" />
          <span className="live-label">{liveStatus.text}</span>
        </div>
        <AboutDetails />
        <AppearanceDetails />
        <button
          className="theme-switch"
          type="button"
          onClick={toggleTheme}
          aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
          aria-pressed={theme === "dark"}
          title={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
        >
          {theme === "light" ? (
            <svg className="theme-icon" viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M21 12.8A8.5 8.5 0 1 1 11.2 3 6.5 6.5 0 0 0 21 12.8Z" /></svg>
          ) : (
            <svg className="theme-icon" viewBox="0 0 24 24" focusable="false" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
          )}
        </button>
      </div>
      <nav className="profile-tabs" aria-label="Profile sections">
        <div className="profile-tabs-inner">
          <Link
            href="/"
            className={`nav-link${pathname === "/" ? " active" : ""}`}
            aria-current={pathname === "/" ? "page" : undefined}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h6v6h-6v-6Z" /></svg>
            Overview
          </Link>
          <Link
            href="/history"
            className={`nav-link${pathname === "/history" ? " active" : ""}`}
            aria-current={pathname === "/history" ? "page" : undefined}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8m0-5v5h5m4-1v6l4 2" /></svg>
            History
          </Link>
          <Link
            href="/agents"
            className={`nav-link${pathname === "/agents" ? " active" : ""}`}
            aria-current={pathname === "/agents" ? "page" : undefined}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20v-1.5A4.5 4.5 0 0 1 8.5 14h7a4.5 4.5 0 0 1 4.5 4.5V20M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" /></svg>
            Agents
          </Link>
          <div className="scope-filter">
            <label htmlFor="sharedProjectFilter">Filter</label>
            <select
              id="sharedProjectFilter"
              value={selectedProjectId}
              onChange={(event) => selectProject(event.target.value)}
              disabled={projectFilterState.disabled}
              aria-label="Filter dashboard by project"
              aria-describedby={projectFilterState.descriptionId}
            >
              <option value="">All projects</option>
              {projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}
            </select>
            {projectFilterState.showDemoNote && <span id="demoScopeNote" className="scope-note">Local demo</span>}
          </div>
        </div>
      </nav>
    </header>
  );
}
