import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { lanternwatchRuntimePaths, lifecycleStoragePaths } from "./guild-paths.mjs";
import { existingNotifierCommand } from "./guild-notify.mjs";
import { heartbeatEvent } from "./guild-heartbeat.mjs";
import { reportEvent } from "./guild-report.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hookScript = path.join(projectRoot, "scripts", "guild-lifecycle-hook.mjs");
const fixtureRoot = mkdtempSync(path.join(tmpdir(), "lanternwatch-hooks-"));
after(() => rmSync(fixtureRoot, { recursive: true, force: true }));

function fixture(name) {
  return path.join(fixtureRoot, name);
}

function runHook(stdin, environment, source) {
  return new Promise((resolve, reject) => {
    const args = source ? [hookScript, source] : [hookScript];
    const child = import("node:child_process").then(({ spawn }) => spawn(process.execPath, args, {
      cwd: projectRoot,
      env: environment,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    }));
    child.then((process) => {
      let stdout = "";
      let stderr = "";
      process.stdout.setEncoding("utf8");
      process.stderr.setEncoding("utf8");
      process.stdout.on("data", (chunk) => { stdout += chunk; });
      process.stderr.on("data", (chunk) => { stderr += chunk; });
      process.once("error", reject);
      process.once("close", (code) => resolve({ code, stdout, stderr }));
      process.stdin.end(stdin);
    }, reject);
  });
}

function startEventServer() {
  const bodies = [];
  const server = createServer((request, response) => {
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { raw += chunk; });
    request.on("end", () => {
      bodies.push(JSON.parse(raw));
      response.writeHead(201, { "content-type": "application/json" });
      response.end("{}");
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, bodies, url: `http://127.0.0.1:${address.port}/api/guild/events` });
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function isolatedEnvironment(root, apiUrl) {
  const environment = {
    ...process.env,
    LANTERNWATCH_API_URL: apiUrl,
    LANTERNWATCH_DB_PATH: path.join(root, "guild.db"),
    LANTERNWATCH_VAULT_PATH: path.join(root, "vault"),
  };
  delete environment.LANTERNWATCH_STORAGE_ROOT;
  return environment;
}

test("storage root follows an explicit root, then the database directory, then the production default", () => {
  const explicitRoot = fixture("explicit-root");
  const database = fixture(path.join("database-root", "guild.db"));
  const portableHome = fixture("lifecycle-default-home");
  const portableRoot = path.join(portableHome, ".lanternwatch");
  assert.equal(lifecycleStoragePaths(explicitRoot, database).root, explicitRoot);
  assert.equal(lifecycleStoragePaths(undefined, database).root, path.dirname(database));
  assert.deepEqual(lifecycleStoragePaths(undefined, undefined, { USERPROFILE: portableHome }), {
    root: portableRoot,
    stateDirectory: path.join(portableRoot, "sessions"),
    logDirectory: path.join(portableRoot, "logs"),
  });
});

test("portable runtime paths use the user profile and honor config plus environment overrides", () => {
  const home = fixture("portable-home");
  const defaultPaths = lanternwatchRuntimePaths({ USERPROFILE: home });
  assert.equal(defaultPaths.storageRoot, path.join(home, ".lanternwatch"));
  assert.equal(defaultPaths.databasePath, path.join(home, ".lanternwatch", "guild.db"));
  assert.equal(defaultPaths.vaultPath, "");

  mkdirSync(path.join(home, ".lanternwatch"), { recursive: true });
  writeFileSync(path.join(home, ".lanternwatch", "config.json"), JSON.stringify({
    storageRoot: fixture("configured-storage"),
    databasePath: fixture("configured.db"),
    vaultPath: fixture("configured-vault"),
  }));
  assert.equal(lanternwatchRuntimePaths({ USERPROFILE: home }).databasePath, fixture("configured.db"));

  writeFileSync(path.join(home, ".lanternwatch", "config.json"), JSON.stringify({
    storageRoot: fixture("configured-storage"),
    vaultPath: fixture("configured-vault"),
  }));
  assert.equal(
    lanternwatchRuntimePaths({ USERPROFILE: home }).databasePath,
    fixture(path.join("configured-storage", "guild.db")),
  );

  const overridden = lanternwatchRuntimePaths({
    USERPROFILE: home,
    LANTERNWATCH_STORAGE_ROOT: fixture("environment-storage"),
  });
  assert.equal(overridden.databasePath, fixture(path.join("environment-storage", "guild.db")));
  assert.equal(overridden.vaultPath, fixture("configured-vault"));

  const fullyOverridden = lanternwatchRuntimePaths({
    USERPROFILE: home,
    LANTERNWATCH_DB_PATH: fixture("environment.db"),
    LANTERNWATCH_STORAGE_ROOT: fixture("environment-storage"),
    LANTERNWATCH_VAULT_PATH: fixture("environment-vault"),
  });
  assert.equal(fullyOverridden.databasePath, fixture("environment.db"));
  assert.equal(fullyOverridden.vaultPath, fixture("environment-vault"));
});

test("notifier chaining loads an installer-preserved command without using a shell", () => {
  const home = fixture("notifier-home");
  const codexRoot = path.join(home, ".codex");
  mkdirSync(codexRoot, { recursive: true });
  writeFileSync(path.join(codexRoot, "lanternwatch-notifier.json"), JSON.stringify({
    command: "existing-notifier",
    args: ["turn-ended"],
  }));
  const command = existingNotifierCommand('{"event":"done"}', { USERPROFILE: home });
  assert.equal(command.command, "existing-notifier");
  assert.deepEqual(command.args, ["turn-ended", '{"event":"done"}']);
  assert.equal(command.options.shell, false);
  assert.equal(command.options.detached, true);
});

test("valid hook stdin creates a receipt beside a DB-only override and reaches the API", async () => {
  const root = fixture("valid-receipt");
  const { server, bodies, url } = await startEventServer();
  try {
    const result = await runHook(JSON.stringify({
      hook_event_name: "Stop",
      session_id: "session-valid",
      turn_id: "turn-valid",
      cwd: projectRoot,
    }), isolatedEnvironment(root, url));
    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    const receipts = readFileSync(path.join(root, "logs", "hook.jsonl"), "utf8").trim().split(/\r?\n/).map(JSON.parse);
    assert.equal(receipts.at(-1).stage, "received");
    assert.equal(receipts.at(-1).event, "Stop");
    assert.equal(receipts.at(-1).source, "codex");
    assert.equal(bodies.length, 1);
    assert.equal(bodies[0].eventId, "hook-stop-session-valid-turn-valid");
    assert.equal(bodies[0].source, "codex");
  } finally {
    await closeServer(server);
  }
});

test("claude source reads prompt_id (not turn_id) and labels events as Claude Code", async () => {
  const root = fixture("claude-valid-receipt");
  const { server, bodies, url } = await startEventServer();
  try {
    const result = await runHook(JSON.stringify({
      hook_event_name: "Stop",
      session_id: "session-claude",
      prompt_id: "prompt-claude",
      turn_id: "should-be-ignored-for-claude",
      cwd: projectRoot,
    }), isolatedEnvironment(root, url), "claude");
    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.equal(bodies.length, 1);
    assert.equal(bodies[0].eventId, "hook-stop-session-claude-prompt-claude");
    assert.equal(bodies[0].runId, "claude-session-claude-prompt-claude");
    assert.equal(bodies[0].source, "claude");
    assert.match(bodies[0].message, /Claude Code/);
    assert.match(bodies[0].quest, /Claude Code/);
    const receipts = readFileSync(path.join(root, "logs", "hook.jsonl"), "utf8").trim().split(/\r?\n/).map(JSON.parse);
    assert.equal(receipts.at(-1).source, "claude");
  } finally {
    await closeServer(server);
  }
});

test("heartbeat source and quest follow the host while legacy state remains compatible", () => {
  const claude = heartbeatEvent({ cwd: projectRoot, source: "claude" }, "claude-session-prompt", "2026-08-12T00:00:00.000Z");
  assert.equal(claude.source, "claude");
  assert.equal(claude.quest, "Claude Code task");
  const legacyCodex = heartbeatEvent({ cwd: projectRoot }, "codex-session-turn", "2026-08-12T00:00:00.000Z");
  assert.equal(legacyCodex.source, "codex");
  assert.equal(legacyCodex.quest, "Codex task");
});

test("SubagentStart/SubagentStop with an ambiguous agent_type skip the automatic dashboard report but still log it", async () => {
  const root = fixture("ambiguous-subagent");
  const { server, bodies, url } = await startEventServer();
  try {
    const environment = isolatedEnvironment(root, url);
    const start = await runHook(JSON.stringify({
      hook_event_name: "SubagentStart",
      session_id: "session-ambiguous",
      turn_id: "turn-ambiguous",
      agent_id: "agent-1",
      agent_type: "claude",
      cwd: projectRoot,
    }), environment);
    assert.equal(start.code, 0);
    assert.equal(start.stderr, "");
    const stop = await runHook(JSON.stringify({
      hook_event_name: "SubagentStop",
      session_id: "session-ambiguous",
      turn_id: "turn-ambiguous",
      agent_id: "agent-1",
      agent_type: "claude",
      cwd: projectRoot,
    }), environment);
    assert.equal(stop.code, 0);
    assert.equal(stop.stderr, "");

    // The ambiguous "claude" catch-all must never reach the dashboard/API or
    // the SQLite fallback for these two events.
    assert.equal(bodies.length, 0);
    assert.equal(existsSync(path.join(root, "guild.db")), false);

    // But the hook.jsonl diagnostic receipt must still exist, noting the skip.
    const receipts = readFileSync(path.join(root, "logs", "hook.jsonl"), "utf8").trim().split(/\r?\n/).map(JSON.parse);
    assert.equal(receipts.length, 2);
    for (const receipt of receipts) {
      assert.equal(receipt.agent, "archivist");
      assert.equal(receipt.note, "ambiguous-agent-type-report-skipped");
    }
    assert.equal(receipts[0].event, "SubagentStart");
    assert.equal(receipts[1].event, "SubagentStop");
  } finally {
    await closeServer(server);
  }
});

test("SubagentStart/SubagentStop with a confidently-mapped agent_type still auto-report exactly as before", async () => {
  const root = fixture("confident-subagent");
  const { server, bodies, url } = await startEventServer();
  try {
    const environment = isolatedEnvironment(root, url);
    const start = await runHook(JSON.stringify({
      hook_event_name: "SubagentStart",
      session_id: "session-confident",
      turn_id: "turn-confident",
      agent_id: "agent-2",
      agent_type: "explore",
      cwd: projectRoot,
    }), environment);
    assert.equal(start.code, 0);
    assert.equal(start.stderr, "");
    const stop = await runHook(JSON.stringify({
      hook_event_name: "SubagentStop",
      session_id: "session-confident",
      turn_id: "turn-confident",
      agent_id: "agent-2",
      agent_type: "explore",
      cwd: projectRoot,
    }), environment);
    assert.equal(stop.code, 0);
    assert.equal(stop.stderr, "");

    // "explore" resolves confidently to archivist (via CLAUDE_CODE_BUILTIN_ROLES)
    // so both events must still be auto-reported, same as before this change.
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0].agent, "archivist");
    assert.equal(bodies[0].status, "working");
    assert.equal(bodies[0].agentInstanceId, "agent-2");
    assert.equal(bodies[1].agent, "archivist");
    assert.equal(bodies[1].status, "complete");

    const receipts = readFileSync(path.join(root, "logs", "hook.jsonl"), "utf8").trim().split(/\r?\n/).map(JSON.parse);
    assert.equal(receipts.length, 2);
    for (const receipt of receipts) {
      assert.equal(receipt.agent, "archivist");
      assert.equal(receipt.note, undefined);
    }
  } finally {
    await closeServer(server);
  }
});

test("company-title task aliases produce canonical receipt and API identities", async () => {
  const root = fixture("company-title-subagent");
  const { server, bodies, url } = await startEventServer();
  try {
    const result = await runHook(JSON.stringify({
      hook_event_name: "SubagentStart",
      session_id: "session-company",
      turn_id: "turn-company",
      agent_id: "agent-company",
      agent_type: "/root/frontend_engineer_dashboard",
      cwd: projectRoot,
    }), isolatedEnvironment(root, url));
    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.equal(bodies.length, 1);
    assert.equal(bodies[0].agent, "interface-weaver");
    assert.equal(bodies[0].agentInstanceId, "agent-company");
    assert.equal(bodies[0].message, "A team member began assigned work.");

    const receipt = JSON.parse(readFileSync(path.join(root, "logs", "hook.jsonl"), "utf8").trim());
    assert.equal(receipt.agent, "interface-weaver");
    assert.equal(receipt.agentInstanceId, "agent-company");
    assert.equal(receipt.note, undefined);
  } finally {
    await closeServer(server);
  }
});

test("malformed hook stdin records a parse receipt and remains non-blocking", async () => {
  const root = fixture("malformed-receipt");
  const result = await runHook("{not-json", isolatedEnvironment(root, "http://127.0.0.1:1/api/guild/events"));
  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
  const receipt = JSON.parse(readFileSync(path.join(root, "logs", "hook.jsonl"), "utf8").trim());
  assert.equal(receipt.stage, "parse");
  assert.equal(receipt.event, "invalid");
  assert.equal(receipt.source, "codex");
  assert.equal(receipt.name, "SyntaxError");
});

test("an inaccessible log path emits a sanitized diagnostic and still exits successfully", async () => {
  const root = fixture("unwritable-receipt");
  mkdirSync(root, { recursive: true });
  writeFileSync(path.join(root, "logs"), "occupied");
  const result = await runHook("{not-json", isolatedEnvironment(root, "http://127.0.0.1:1/api/guild/events"));
  assert.equal(result.code, 0);
  assert.match(result.stderr, /^Lanternwatch hook diagnostic write failed \([A-Za-z0-9._:-]+:[A-Za-z0-9._:-]+\)\.\r?\n$/);
  assert.equal(readFileSync(path.join(root, "logs"), "utf8"), "occupied");
});

test("reporter returns API on success and does not create the fallback database", async () => {
  const root = fixture("api-success");
  const { server, bodies, url } = await startEventServer();
  const previous = {
    api: process.env.LANTERNWATCH_API_URL,
    database: process.env.LANTERNWATCH_DB_PATH,
    vault: process.env.LANTERNWATCH_VAULT_PATH,
  };
  process.env.LANTERNWATCH_API_URL = url;
  process.env.LANTERNWATCH_DB_PATH = path.join(root, "guild.db");
  process.env.LANTERNWATCH_VAULT_PATH = path.join(root, "vault");
  try {
    const destination = await reportEvent({
      eventId: "api-success-event",
      projectPath: projectRoot,
      projectName: "Lanternwatch",
      runId: "api-success-run",
      agent: "hookwright",
      status: "working",
      message: "Fixture API success.",
      quest: "Lifecycle test",
      occurredAt: new Date().toISOString(),
    });
    assert.equal(destination, "api");
    assert.equal(bodies.length, 1);
    assert.equal(existsSync(path.join(root, "guild.db")), false);
  } finally {
    await closeServer(server);
    if (previous.api === undefined) delete process.env.LANTERNWATCH_API_URL; else process.env.LANTERNWATCH_API_URL = previous.api;
    if (previous.database === undefined) delete process.env.LANTERNWATCH_DB_PATH; else process.env.LANTERNWATCH_DB_PATH = previous.database;
    if (previous.vault === undefined) delete process.env.LANTERNWATCH_VAULT_PATH; else process.env.LANTERNWATCH_VAULT_PATH = previous.vault;
  }
});

test("reporter falls back to the isolated SQLite database after API failure", async () => {
  const root = fixture("api-fallback");
  const databasePath = path.join(root, "guild.db");
  const previous = {
    api: process.env.LANTERNWATCH_API_URL,
    database: process.env.LANTERNWATCH_DB_PATH,
    vault: process.env.LANTERNWATCH_VAULT_PATH,
  };
  process.env.LANTERNWATCH_API_URL = "http://127.0.0.1:1/api/guild/events";
  process.env.LANTERNWATCH_DB_PATH = databasePath;
  process.env.LANTERNWATCH_VAULT_PATH = path.join(root, "vault");
  try {
    const destination = await reportEvent({
      eventId: "api-fallback-event",
      projectPath: projectRoot,
      projectName: "Lanternwatch",
      runId: "api-fallback-run",
      agent: "hookwright",
      status: "working",
      message: "Fixture API fallback.",
      quest: "Lifecycle test",
      occurredAt: new Date().toISOString(),
    });
    assert.equal(destination, "sqlite");
    const database = new DatabaseSync(databasePath, { readOnly: true });
    const row = database.prepare("SELECT source_event_id FROM events WHERE source_event_id = ?").get("api-fallback-event");
    database.close();
    assert.equal(row.source_event_id, "api-fallback-event");
  } finally {
    if (previous.api === undefined) delete process.env.LANTERNWATCH_API_URL; else process.env.LANTERNWATCH_API_URL = previous.api;
    if (previous.database === undefined) delete process.env.LANTERNWATCH_DB_PATH; else process.env.LANTERNWATCH_DB_PATH = previous.database;
    if (previous.vault === undefined) delete process.env.LANTERNWATCH_VAULT_PATH; else process.env.LANTERNWATCH_VAULT_PATH = previous.vault;
  }
});

test("reporter persists only canonical IDs when given company-title aliases", async () => {
  const root = fixture("company-title-persistence");
  const databasePath = path.join(root, "guild.db");
  const previous = {
    api: process.env.LANTERNWATCH_API_URL,
    database: process.env.LANTERNWATCH_DB_PATH,
    vault: process.env.LANTERNWATCH_VAULT_PATH,
  };
  process.env.LANTERNWATCH_API_URL = "http://127.0.0.1:1/api/guild/events";
  process.env.LANTERNWATCH_DB_PATH = databasePath;
  process.env.LANTERNWATCH_VAULT_PATH = "";
  try {
    const destination = await reportEvent({
      eventId: "company-title-event",
      projectPath: projectRoot,
      projectName: "Lanternwatch",
      runId: "company-title-run",
      agent: "Compliance Reviewer",
      from: "/root/strategy_consultant_memo",
      status: "complete",
      message: "Company-title compatibility fixture.",
      quest: "Lifecycle test",
      occurredAt: new Date().toISOString(),
      runComplete: true,
    });
    assert.equal(destination, "sqlite");
    const database = new DatabaseSync(databasePath, { readOnly: true });
    const row = database.prepare("SELECT agent, from_agent FROM events WHERE source_event_id = ?").get("company-title-event");
    database.close();
    assert.equal(row.agent, "assayer");
    assert.equal(row.from_agent, "counselor");
  } finally {
    if (previous.api === undefined) delete process.env.LANTERNWATCH_API_URL; else process.env.LANTERNWATCH_API_URL = previous.api;
    if (previous.database === undefined) delete process.env.LANTERNWATCH_DB_PATH; else process.env.LANTERNWATCH_DB_PATH = previous.database;
    if (previous.vault === undefined) delete process.env.LANTERNWATCH_VAULT_PATH; else process.env.LANTERNWATCH_VAULT_PATH = previous.vault;
  }
});
