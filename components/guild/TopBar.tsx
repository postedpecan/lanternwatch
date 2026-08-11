"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useGuildData } from "@/components/guild/GuildDataContext";

export function TopBar() {
  const { theme, toggleTheme, liveStatus } = useGuildData();
  const pathname = usePathname();

  return (
    <nav className="topbar" aria-label="Guild status">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true" />
        <span><strong>Lanternwatch</strong><small>Agent runtime</small></span>
      </div>
      <div className="topbar-actions">
        <div className="nav-links" aria-label="Dashboard sections">
          <Link
            href="/"
            className={`nav-link${pathname === "/" ? " active" : ""}`}
            aria-current={pathname === "/" ? "page" : undefined}
          >
            Live
          </Link>
          <Link
            href="/history"
            className={`nav-link${pathname === "/history" ? " active" : ""}`}
            aria-current={pathname === "/history" ? "page" : undefined}
          >
            History
          </Link>
        </div>
        <div className={`live-pill ${liveStatus.live ? "" : "idle"}`}>
          <span className="live-dot" />
          <span className="live-label">{liveStatus.text}</span>
        </div>
        <button
          className={`theme-switch ${theme}`}
          type="button"
          onClick={toggleTheme}
          aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
          aria-pressed={theme === "dark"}
          title={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
        >
          <span className="theme-switch-thumb" aria-hidden="true">
            {theme === "light" ? (
              <svg className="theme-icon" viewBox="0 0 24 24" focusable="false">
                <circle cx="12" cy="12" r="3.5" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42" />
              </svg>
            ) : (
              <svg className="theme-icon" viewBox="0 0 24 24" focusable="false">
                <path d="M20 15.2A8.4 8.4 0 0 1 8.8 4a8.5 8.5 0 1 0 11.2 11.2Z" />
              </svg>
            )}
          </span>
        </button>
      </div>
    </nav>
  );
}
