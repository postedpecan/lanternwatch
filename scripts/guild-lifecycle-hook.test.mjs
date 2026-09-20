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

function runHookThroughWindowsCommand(stdin, environment) {
  return new Promise((resolve, reject) => {
    const command = `${process.execPath} ${hookScript}`;
    const child = import("node:child_process").then(({ spawn }) => spawn(
      process.env.ComSpec || "cmd.exe",
      ["/D", "/S", "/C", `"${command}"`],
      {
        cwd: projectRoot,
        env: environment,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        windowsVerbatimArguments: true,
      },
    ));
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

async function waitFor(predicate, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`condition was not met within ${timeoutMs}ms`);
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
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.deepEqual(JSON.parse(result.stdout), {});
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

test("Stop closes the in-process heartbeat and the complete Windows command runner exits", { skip: process.platform !== "win32" }, async () => {
  const root = fixture("in-process-heartbeat-exit");
  const { server, bodies, url } = await startEventServer();
  const environment = isolatedEnvironment(root, url);
  environment.LANTERNWATCH_HEARTBEAT_INTERVAL_MS = "100";
  environment.LANTERNWATCH_HEARTBEAT_POLL_MS = "50";
  delete environment.LANTERNWATCH_HEARTBEAT_ONCE;
  delete environment.LANTERNWATCH_DISABLE_HEARTBEAT;
  try {
    const runner = runHookThroughWindowsCommand(JSON.stringify({
      hook_event_name: "UserPromptSubmit",
      session_id: "session-in-process-heartbeat",
      turn_id: "turn-in-process-heartbeat",
      cwd: projectRoot,
    }), environment);
    await waitFor(() => bodies.some((body) => body.heartbeat === true));

    const stopStarted = Date.now();
    const stop = await runHook(JSON.stringify({
      hook_event_name: "Stop",
      session_id: "session-in-process-heartbeat",
      turn_id: "turn-in-process-heartbeat",
      cwd: projectRoot,
    }), environment);
    const result = await runner;
    const stopToExitMs = Date.now() - stopStarted;

    assert.equal(stop.code, 0, stop.stderr || stop.stdout);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.deepEqual(JSON.parse(result.stdout), {});
    assert.ok(stopToExitMs < 1_000, `Windows command runner stayed alive ${stopToExitMs}ms after Stop`);
    assert.equal(bodies.filter((body) => body.heartbeat !== true).length, 2);
    assert.equal(existsSync(path.join(root, "logs", "hook.jsonl")), true);
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

test("SubagentStart/SubagentStop preserves an otherwise unknown Codex agent type", async () => {
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
    assert.deepEqual(JSON.parse(start.stdout), {});
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
    assert.deepEqual(JSON.parse(stop.stdout), {});
    assert.equal(stop.stderr, "");

    // A user-owned type must be reported as itself, not discarded or folded
    // into a LanternWatch company role.
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0].agent, "claude");
    assert.equal(bodies[1].agent, "claude");
    assert.equal(existsSync(path.join(root, "guild.db")), false);

    // The receipt retains the original type without an ambiguity guess.
    const receipts = readFileSync(path.join(root, "logs", "hook.jsonl"), "utf8").trim().split(/\r?\n/).map(JSON.parse);
    assert.equal(receipts.length, 2);
    for (const receipt of receipts) {
      assert.equal(receipt.agent, "claude");
      assert.equal(receipt.note, undefined);
    }
    assert.equal(receipts[0].event, "SubagentStart");
    assert.equal(receipts[1].event, "SubagentStop");
  } finally {
    await closeServer(server);
  }
});

test("SubagentStart/SubagentStop preserves a Codex agent type instead of assigning a company role", async () => {
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

    // "explore" may be a user-owned Codex agent name, so it remains intact.
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0].agent, "explore");
    assert.equal(bodies[0].status, "working");
    assert.equal(bodies[0].agentInstanceId, "agent-2");
    assert.equal(bodies[1].agent, "explore");
    assert.equal(bodies[1].status, "complete");

    const receipts = readFileSync(path.join(root, "logs", "hook.jsonl"), "utf8").trim().split(/\r?\n/).map(JSON.parse);
    assert.equal(receipts.length, 2);
    for (const receipt of receipts) {
      assert.equal(receipt.agent, "explore");
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
    assert.equal(bodies[0].agent, "frontend-engineer");
    assert.equal(bodies[0].agentInstanceId, "agent-company");
    assert.equal(bodies[0].message, "A Codex agent began assigned work.");

    const receipt = JSON.parse(readFileSync(path.join(root, "logs", "hook.jsonl"), "utf8").trim());
    assert.equal(receipt.agent, "frontend-engineer");
    assert.equal(receipt.agentInstanceId, "agent-company");
    assert.equal(receipt.note, undefined);
  } finally {
    await closeServer(server);
  }
});

test("workspace custom-agent identity remains available for catalog attribution", async () => {
  const root = fixture("workspace-custom-agent");
  const { server, bodies, url } = await startEventServer();
  try {
    const result = await runHook(JSON.stringify({
      hook_event_name: "SubagentStart",
      session_id: "session-workspace-agent",
      turn_id: "turn-workspace-agent",
      agent_id: "agent-workspace",
      agent_type: "frontend-engineer-lanternwatch",
      cwd: projectRoot,
    }), isolatedEnvironment(root, url));
    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.equal(bodies.length, 1);
    assert.equal(bodies[0].agent, "frontend-engineer");
    assert.equal(bodies[0].agentType, "frontend-engineer-lanternwatch");
    const receipt = JSON.parse(readFileSync(path.join(root, "logs", "hook.jsonl"), "utf8").trim());
    assert.equal(receipt.agent, "frontend-engineer");
    assert.equal(receipt.agentType, "frontend-engineer-lanternwatch");
  } finally {
    await closeServer(server);
  }
});

test("malformed hook stdin records a parse receipt and remains non-blocking", async () => {
  const root = fixture("malformed-receipt");
  const result = await runHook("{not-json", isolatedEnvironment(root, "http://127.0.0.1:1/api/guild/events"));
  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(result.stdout), {});
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
    assert.equal(bodies[0].agent, "platform-engineer");
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
      agentType: "platform-engineer-lanternwatch",
      status: "working",
      message: "Fixture API fallback.",
      quest: "Lifecycle test",
      occurredAt: new Date().toISOString(),
    });
    assert.equal(destination, "sqlite");
    const database = new DatabaseSync(databasePath, { readOnly: true });
    const row = database.prepare("SELECT source_event_id, agent, agent_type FROM events WHERE source_event_id = ?").get("api-fallback-event");
    database.close();
    assert.equal(row.source_event_id, "api-fallback-event");
    assert.equal(row.agent, "platform-engineer");
    assert.equal(row.agent_type, "platform-engineer-lanternwatch");
  } finally {
    if (previous.api === undefined) delete process.env.LANTERNWATCH_API_URL; else process.env.LANTERNWATCH_API_URL = previous.api;
    if (previous.database === undefined) delete process.env.LANTERNWATCH_DB_PATH; else process.env.LANTERNWATCH_DB_PATH = previous.database;
    if (previous.vault === undefined) delete process.env.LANTERNWATCH_VAULT_PATH; else process.env.LANTERNWATCH_VAULT_PATH = previous.vault;
  }
});

test("reporter keeps the committed fallback event when optional Markdown export fails", async () => {
  const root = fixture("export-failure-fallback");
  const databasePath = path.join(root, "guild.db");
  const blockedVault = path.join(root, "occupied-vault");
  mkdirSync(root, { recursive: true });
  writeFileSync(blockedVault, "occupied");
  const previous = {
    api: process.env.LANTERNWATCH_API_URL,
    database: process.env.LANTERNWATCH_DB_PATH,
    vault: process.env.LANTERNWATCH_VAULT_PATH,
  };
  process.env.LANTERNWATCH_API_URL = "http://127.0.0.1:1/api/guild/events";
  process.env.LANTERNWATCH_DB_PATH = databasePath;
  process.env.LANTERNWATCH_VAULT_PATH = blockedVault;
  try {
    const destination = await reportEvent({
      eventId: "export-failure-event",
      projectPath: projectRoot,
      projectName: "Lanternwatch",
      runId: "export-failure-run",
      agent: "hookwright",
      status: "complete",
      message: "Fixture export failure.",
      quest: "Lifecycle test",
      occurredAt: new Date().toISOString(),
      runComplete: true,
    });
    assert.equal(destination, "sqlite");
    const database = new DatabaseSync(databasePath, { readOnly: true });
    const row = database.prepare("SELECT source_event_id FROM events WHERE source_event_id = ?").get("export-failure-event");
    database.close();
    assert.equal(row.source_event_id, "export-failure-event");
    const diagnostics = readFileSync(path.join(root, "logs", "reporter.jsonl"), "utf8")
      .trim().split(/\r?\n/).map(JSON.parse);
    assert.ok(diagnostics.some((entry) => entry.stage === "export-failed"));
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
    assert.equal(row.agent, "compliance-reviewer");
    assert.equal(row.from_agent, "strategy-consultant");
  } finally {
    if (previous.api === undefined) delete process.env.LANTERNWATCH_API_URL; else process.env.LANTERNWATCH_API_URL = previous.api;
    if (previous.database === undefined) delete process.env.LANTERNWATCH_DB_PATH; else process.env.LANTERNWATCH_DB_PATH = previous.database;
    if (previous.vault === undefined) delete process.env.LANTERNWATCH_VAULT_PATH; else process.env.LANTERNWATCH_VAULT_PATH = previous.vault;
  }
});
