import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { registerHooks } from "node:module";
import test from "node:test";

const workspace = path.resolve(import.meta.dirname, "../../../..");
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: "data:text/javascript,export%20{}", shortCircuit: true };
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    if (specifier.startsWith("@/")) {
      const target = path.join(workspace, specifier.slice(2));
      return { url: pathToFileURL(existsSync(target) ? target : `${target}.ts`).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

test("dashboard route exposes global scope by default and applies only valid project filters", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "lanternwatch-route-"));
  process.env.LANTERNWATCH_DB_PATH = path.join(directory, "route.db");
  t.after(async () => {
    if (globalThis.lanternwatchDatabase) {
      globalThis.lanternwatchDatabase.database.close();
      delete globalThis.lanternwatchDatabase;
    }
    await rm(directory, { recursive: true, force: true });
  });
  const { recordGuildEvent } = await import("../../../../lib/server/guild-store.ts");
  const { GET } = await import("./route.ts");
  const base = {
    runId: "shared",
    agent: "archivist",
    status: "working",
    message: "API fixture",
    quest: "API fixture",
    occurredAt: new Date().toISOString(),
  };
  recordGuildEvent({ ...base, eventId: "route-a", projectPath: "C:/fixtures/route-a", projectName: "Route A", agentInstanceId: "a" });
  recordGuildEvent({ ...base, eventId: "route-b", projectPath: "C:/fixtures/route-b", projectName: "Route B", agentInstanceId: "b" });

  const global = await GET(new Request("http://localhost/api/guild/dashboard")).json();
  assert.equal(global.selectedProjectId, null);
  assert.equal(global.statistics.totalRuns, 2);
  assert.equal(global.agentActivities.length, 2);

  const project = global.projects.find((candidate) => candidate.name === "Route A");
  const filtered = await GET(new Request(`http://localhost/api/guild/dashboard?projectId=${project.id}`)).json();
  assert.equal(filtered.selectedProjectId, project.id);
  assert.equal(filtered.statistics.totalRuns, 1);
  assert.ok(filtered.recentEvents.every((event) => event.projectId === project.id));

  const invalid = await GET(new Request("http://localhost/api/guild/dashboard?projectId=missing")).json();
  assert.equal(invalid.selectedProjectId, null);
  assert.equal(invalid.statistics.totalRuns, 2);
});
