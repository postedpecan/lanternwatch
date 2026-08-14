import type { GuildStorageHealth } from "@/lib/guild-contract";

type HookHealthSnapshot = Pick<
  GuildStorageHealth,
  "hookLogPath" | "hookLogStatus" | "lastHookReceiptAgeSeconds" | "lastHookSource"
>;

export type HookDiagnostic = {
  label: string;
  warning: string | null;
};

export function describeHookDiagnostic(
  healthApiConnected: boolean,
  health: HookHealthSnapshot | null,
  formatAge: (seconds: number | null) => string,
): HookDiagnostic {
  if (!healthApiConnected) {
    return {
      label: "Hook status unavailable",
      warning: "Lifecycle signal cannot be checked until the health API responds.",
    };
  }

  if (!health) {
    return {
      label: "Hook status unavailable",
      warning: "Hook health data is unavailable.",
    };
  }

  switch (health.hookLogStatus) {
    case "ok":
      const hostLabel = health.lastHookSource === "claude"
        ? "Claude Code hook"
        : health.lastHookSource === "codex"
          ? "Codex hook"
          : "Hook";
      return {
        label: health.lastHookReceiptAgeSeconds === null
          ? `${hostLabel} log readable; receipt time unavailable`
          : `${hostLabel} received ${formatAge(health.lastHookReceiptAgeSeconds)}`,
        warning: null,
      };
    case "missing":
      return {
        label: "Hook log missing",
        warning: "No lifecycle receipt has been observed. Fully exit Codex or Claude Code and start a fresh chat. For Codex hook trust, run /hooks inside the Codex CLI.",
      };
    case "empty":
      return {
        label: "Hook log empty",
        warning: "No lifecycle receipt has been observed. Fully exit Codex or Claude Code and start a fresh chat. For Codex hook trust, run /hooks inside the Codex CLI.",
      };
    case "malformed":
      return {
        label: "Hook log malformed",
        warning: "The hook log contains invalid lifecycle data.",
      };
    case "unreadable":
      return {
        label: "Hook log unreadable",
        warning: `Hook log ${health.hookLogPath} is inaccessible.`,
      };
  }
}
