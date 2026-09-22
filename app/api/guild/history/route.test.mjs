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

test("history route validates filters and keeps an unknown project closed", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "lanternwatch-history-route-"));
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
  const recorded = recordGuildEvent({
    eventId: "history-route", projectPath: "C:/fixtures/history-route", projectName: "History Route", runId: "route-run",
    agent: "frontend-engineer", status: "complete", runComplete: true, message: "Find filter", quest: "Filter history",
    occurredAt: new Date().toISOString(),
  });
  const valid = await GET(new Request("http://localhost/api/guild/history?q=filter&limit=1")).json();
  assert.equal(valid.totalMatches, 1);
  assert.equal(valid.items[0].id, recorded.runId);
  const missing = await GET(new Request("http://localhost/api/guild/history?projectId=missing"));
  assert.equal(missing.status, 404);
  const invalid = await GET(new Request("http://localhost/api/guild/history?status=nope"));
  assert.equal(invalid.status, 400);
  const malformedCursor = await GET(new Request("http://localhost/api/guild/history?cursor=not-a-cursor"));
  assert.equal(malformedCursor.status, 400);
});
