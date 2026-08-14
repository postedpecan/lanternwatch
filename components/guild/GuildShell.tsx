"use client";

import type { ReactNode } from "react";
import { GuildDataProvider } from "@/components/guild/GuildDataContext";
import { TopBar } from "@/components/guild/TopBar";

// Mounted once from the root layout so it wraps every route. Because Next.js
// layouts persist across client-side navigation, the data provider's polling
// loop, reducer, and theme state survive moving between `/` and `/history`
// instead of being torn down and recreated.
export function GuildShell({ children }: { children: ReactNode }) {
  return (
    <GuildDataProvider>
      <div className="shell">
        <TopBar />
        <main className="profile-layout">
          <div className="profile-content">{children}</div>
        </main>
      </div>
    </GuildDataProvider>
  );
}
