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
    agent: "program-manager",
    status: "working",
    message: "Lifecycle heartbeat",
    quest: `${hostLabel} task`,
    occurredAt,
    heartbeat: true,
  };
}

export function startHeartbeatScheduler(stateFile, expectedRunId) {
  const started = Date.now();
  let lastReport = started;
  let checking = false;
  async function poll() {
    const checkedAt = Date.now();
    if (checkedAt - started > 12 * 60 * 60 * 1000) return false;
    let state;
    try { state = JSON.parse(readFileSync(stateFile, "utf8")); } catch { return false; }
    if (!state.open || state.runId !== expectedRunId) return false;
    if (checkedAt - lastReport < reportIntervalMs) return true;
    lastReport = checkedAt;
    try {
      await reportEvent(heartbeatEvent(state, expectedRunId));
    } catch {}
    return true;
  }

  const configuredReportInterval = Number(process.env.LANTERNWATCH_HEARTBEAT_INTERVAL_MS);
  const reportIntervalMs = Number.isFinite(configuredReportInterval) && configuredReportInterval >= 50 && configuredReportInterval <= 60_000
    ? configuredReportInterval
    : 60_000;
  const configuredPollInterval = Number(process.env.LANTERNWATCH_HEARTBEAT_POLL_MS);
  const pollIntervalMs = Number.isFinite(configuredPollInterval) && configuredPollInterval >= 25 && configuredPollInterval <= 1_000
    ? configuredPollInterval
    : 1_000;
  const timer = setInterval(async () => {
    if (checking) return;
    checking = true;
    try {
      const keepRunning = await poll();
      if (!keepRunning || process.env.LANTERNWATCH_HEARTBEAT_ONCE === "1") {
        clearInterval(timer);
      }
    } finally {
      checking = false;
    }
  }, pollIntervalMs);
  return timer;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [stateFile, expectedRunId] = process.argv.slice(2);
  startHeartbeatScheduler(stateFile, expectedRunId);
}
