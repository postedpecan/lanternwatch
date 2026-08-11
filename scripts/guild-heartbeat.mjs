import { readFileSync } from "node:fs";
import path from "node:path";
import { reportEvent } from "./guild-report.mjs";

const [stateFile, expectedRunId] = process.argv.slice(2);
const started = Date.now();

async function beat() {
  if (Date.now() - started > 12 * 60 * 60 * 1000) return false;
  let state;
  try { state = JSON.parse(readFileSync(stateFile, "utf8")); } catch { return false; }
  if (!state.open || state.runId !== expectedRunId) return false;
  try {
    await reportEvent({
      eventId: `heartbeat-${expectedRunId}`,
      projectPath: state.cwd,
      projectName: path.basename(state.cwd),
      runId: expectedRunId,
      agent: "guildmaster",
      status: "working",
      message: "Lifecycle heartbeat",
      quest: "Codex task",
      occurredAt: new Date().toISOString(),
      heartbeat: true,
    });
  } catch {}
  return true;
}

const timer = setInterval(async () => { if (!await beat()) { clearInterval(timer); process.exit(0); } }, 60_000);
