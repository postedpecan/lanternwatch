import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { reportEvent } from "./guild-report.mjs";

export function sourceForHeartbeat(state, expectedRunId) {
  if (state?.source === "claude" || state?.source === "codex") return state.source;
  return String(expectedRunId || "").startsWith("claude-") ? "claude" : "codex";
}

export function heartbeatEvent(state, expectedRunId, occurredAt = new Date().toISOString()) {
  const source = sourceForHeartbeat(state, expectedRunId);
  const hostLabel = source === "claude" ? "Claude Code" : "Codex";
  return {
    eventId: `heartbeat-${expectedRunId}`,
    source,
    projectPath: state.cwd,
    projectName: path.basename(state.cwd),
    runId: expectedRunId,
    agent: "guildmaster",
    status: "working",
    message: "Lifecycle heartbeat",
    quest: `${hostLabel} task`,
    occurredAt,
    heartbeat: true,
  };
}

export function startHeartbeatScheduler(stateFile, expectedRunId) {
  const started = Date.now();
  async function beat() {
    if (Date.now() - started > 12 * 60 * 60 * 1000) return false;
    let state;
    try { state = JSON.parse(readFileSync(stateFile, "utf8")); } catch { return false; }
    if (!state.open || state.runId !== expectedRunId) return false;
    try {
      await reportEvent(heartbeatEvent(state, expectedRunId));
    } catch {}
    return true;
  }

  const timer = setInterval(async () => {
    const keepRunning = await beat();
    if (!keepRunning || process.env.LANTERNWATCH_HEARTBEAT_ONCE === "1") {
      clearInterval(timer);
      process.exit(0);
    }
  }, 60_000);
  return timer;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [stateFile, expectedRunId] = process.argv.slice(2);
  startHeartbeatScheduler(stateFile, expectedRunId);
}
