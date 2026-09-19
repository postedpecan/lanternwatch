import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { mergeLanternwatchHooks } from "./merge-hooks.mjs";

const hooksPath = String.raw`C:\Users\Test\.codex\hooks.json`;
const scriptPath = String.raw`C:\Project\scripts\guild-lifecycle-hook.mjs`;
const nodePath = String.raw`C:\Tools\node.exe`;
const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const lifecycleScript = path.join(projectRoot, "scripts", "guild-lifecycle-hook.mjs");
const reinstallerScript = path.join(projectRoot, "scripts", "reinstall-lanternwatch-hooks.ps1");

function stateName(eventName) {
  return eventName.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

function trustConfiguration(fixtureHooksPath) {
  const lines = [
    'model = "test"',
    'notify = [ "unrelated.exe" ]',
    "",
    "[hooks.state]",
    "",
  ];
  for (const eventName of ["UserPromptSubmit", "Stop", "SubagentStart", "SubagentStop", "SessionEnd"]) {
    lines.push(
      `[hooks.state.'${fixtureHooksPath}:${stateName(eventName)}:0:0']`,
      `trusted_hash = "sha256:${stateName(eventName)}"`,
      "",
    );
  }
  lines.push(
    "[hooks.state.'unrelated-handler']",
    'trusted_hash = "sha256:keep-me"',
    "",
  );
  return lines.join("\n");
}

function runReinstaller({ unchanged }) {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "lanternwatch-rehook-"));
  const codexRoot = path.join(fixtureRoot, "Codex Root With Spaces");
  const fixtureHooksPath = path.join(codexRoot, "hooks.json");
  const configPath = path.join(codexRoot, "config.toml");
  mkdirSync(codexRoot, { recursive: true });
  const initialHooks = unchanged
    ? mergeLanternwatchHooks({ hooks: {} }, fixtureHooksPath, lifecycleScript, process.execPath).configuration
    : { description: "Codex hooks", hooks: {} };
  writeFileSync(fixtureHooksPath, `${JSON.stringify(initialHooks, null, 2)}\n`, "utf8");
  writeFileSync(configPath, trustConfiguration(fixtureHooksPath), "utf8");

  try {
    const result = spawnSync("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", reinstallerScript,
      "-CodexRoot", codexRoot,
      "-NodeExecutable", process.execPath,
    ], { cwd: projectRoot, encoding: "utf8" });
    const installedHooks = JSON.parse(readFileSync(fixtureHooksPath, "utf8"));
    const commandWindows = installedHooks.hooks.UserPromptSubmit[0].hooks[0].commandWindows;
    const probeRoot = path.join(fixtureRoot, "probe-storage");
    const probe = spawnSync(process.env.ComSpec, ["/C", `"${commandWindows}"`], {
      cwd: projectRoot,
      encoding: "utf8",
      input: JSON.stringify({ hook_event_name: "Unsupported", session_id: "launcher-probe" }),
      windowsVerbatimArguments: true,
      env: {
        ...process.env,
        LANTERNWATCH_STORAGE_ROOT: probeRoot,
        LANTERNWATCH_DB_PATH: path.join(probeRoot, "guild.db"),
        LANTERNWATCH_DISABLE_HEARTBEAT: "1",
      },
    });
    return {
      result,
      config: readFileSync(configPath, "utf8"),
      commandWindows,
      probe,
      receiptCreated: existsSync(path.join(probeRoot, "logs", "hook.jsonl")),
    };
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

test("reinstalls five Lanternwatch hooks while preserving unrelated hooks and positions", () => {
  const unrelated = { type: "command", command: "node unrelated.mjs" };
  const oldLanternwatch = { type: "command", command: "node old/guild-lifecycle-hook.mjs" };
  const input = {
    description: "Existing hooks",
    hooks: {
      UserPromptSubmit: [{ hooks: [unrelated] }, { hooks: [oldLanternwatch] }],
      Stop: [{ hooks: [oldLanternwatch, unrelated] }],
      CustomEvent: [{ hooks: [unrelated] }],
    },
  };

  const { configuration, trustKeys, trustKeysToReset } = mergeLanternwatchHooks(input, hooksPath, scriptPath, nodePath);

  assert.equal(configuration.hooks.UserPromptSubmit.length, 2);
  assert.deepEqual(configuration.hooks.UserPromptSubmit[0].hooks, [unrelated]);
  assert.equal(
    configuration.hooks.UserPromptSubmit[1].hooks[0].commandWindows,
    String.raw`C:\Tools\node.exe C:\Project\scripts\guild-lifecycle-hook.mjs`,
  );
  assert.deepEqual(configuration.hooks.Stop[0].hooks[1], unrelated);
  assert.deepEqual(configuration.hooks.CustomEvent, [{ hooks: [unrelated] }]);
  assert.equal(configuration.hooks.UserPromptSubmit[1].hooks[0].async, true);
  assert.equal(configuration.hooks.UserPromptSubmit[1].hooks[0].timeout, 43_260);
  assert.equal(configuration.hooks.Stop[0].hooks[0].async, undefined);
  assert.equal(configuration.hooks.SessionEnd[0].hooks[0].timeout, 3);
  assert.equal(configuration.hooks.SubagentStart[0].hooks[0].timeout, 5);
  assert.equal(configuration.hooks.SubagentStop[0].hooks[0].timeout, 5);
  assert.ok(trustKeys.includes(`${hooksPath}:user_prompt_submit:1:0`));
  assert.ok(trustKeys.includes(`${hooksPath}:stop:0:0`));
  assert.ok(trustKeys.includes(`${hooksPath}:session_end:0:0`));
  assert.deepEqual(trustKeysToReset, trustKeys);
});

test("preserves trust when reinstalling an unchanged Lanternwatch configuration", () => {
  const first = mergeLanternwatchHooks({ hooks: {} }, hooksPath, scriptPath, nodePath);
  const second = mergeLanternwatchHooks(
    structuredClone(first.configuration),
    hooksPath,
    scriptPath,
    nodePath,
  );

  assert.equal(second.trustKeys.length, 5);
  assert.deepEqual(second.trustKeysToReset, []);
});

test("uses a single launcher path when Windows paths require quoting", () => {
  const configuration = mergeLanternwatchHooks(
    { hooks: {} },
    hooksPath,
    String.raw`C:\Project With Spaces\scripts\guild-lifecycle-hook.mjs`,
    String.raw`C:\Program Files\nodejs\node.exe`,
  ).configuration;

  assert.equal(
    configuration.hooks.UserPromptSubmit[0].hooks[0].commandWindows,
    String.raw`"C:\Users\Test\.codex\LanternWatch\guild-lifecycle-hook.cmd"`,
  );
});

test("replaces the Codex-incompatible two-quoted-path command and resets its trust", () => {
  const oldHandler = {
    type: "command",
    command: `node "${scriptPath}"`,
    commandWindows: `"${nodePath}" "${scriptPath}"`,
    timeout: 5,
  };
  const result = mergeLanternwatchHooks({
    hooks: { UserPromptSubmit: [{ hooks: [oldHandler] }] },
  }, hooksPath, scriptPath, nodePath);

  assert.equal(
    result.configuration.hooks.UserPromptSubmit[0].hooks[0].commandWindows,
    String.raw`C:\Tools\node.exe C:\Project\scripts\guild-lifecycle-hook.mjs`,
  );
  assert.ok(result.trustKeysToReset.includes(`${hooksPath}:user_prompt_submit:0:0`));
});

test("reinstaller resets changed hook trust while preserving unrelated config", { skip: process.platform !== "win32" }, () => {
  const { result, config, commandWindows, probe, receiptCreated } = runReinstaller({ unchanged: false });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Trust records reset: 5/);
  assert.doesNotMatch(config, /user_prompt_submit:0:0/);
  assert.doesNotMatch(config, /session_end:0:0/);
  assert.match(config, /notify = \[ "unrelated\.exe" \]/);
  assert.match(config, /unrelated-handler/);
  assert.match(config, /sha256:keep-me/);
  assert.equal(commandWindows, `${process.execPath} ${lifecycleScript}`);
  assert.doesNotMatch(commandWindows, /"/);
  assert.equal(probe.status, 0, probe.stderr || probe.stdout);
  assert.equal(probe.stdout.trim(), "{}");
  assert.equal(receiptCreated, true);
});

test("reinstaller preserves valid trust for unchanged hook definitions", { skip: process.platform !== "win32" }, () => {
  const { result, config, probe, receiptCreated } = runReinstaller({ unchanged: true });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Trust records reset: 0/);
  assert.match(config, /user_prompt_submit:0:0/);
  assert.match(config, /session_end:0:0/);
  assert.match(config, /notify = \[ "unrelated\.exe" \]/);
  assert.match(config, /unrelated-handler/);
  assert.match(config, /sha256:keep-me/);
  assert.equal(probe.status, 0, probe.stderr || probe.stdout);
  assert.equal(receiptCreated, true);
});

test("deduplicates Lanternwatch handlers without removing another handler in the same group", () => {
  const unrelated = { type: "command", command: "node unrelated.mjs" };
  const input = {
    hooks: {
      Stop: [{ hooks: [
        { type: "command", command: "node one/guild-lifecycle-hook.mjs" },
        unrelated,
        { type: "command", commandWindows: "node two/guild-lifecycle-hook.mjs" },
      ] }],
    },
  };

  const { configuration } = mergeLanternwatchHooks(input, hooksPath, scriptPath, nodePath);
  assert.equal(configuration.hooks.Stop[0].hooks.length, 2);
  assert.equal(configuration.hooks.Stop[0].hooks[1], unrelated);
});

test("does not report a stale trust key for a duplicate handler removed during dedup", () => {
  const unrelated = { type: "command", command: "node unrelated.mjs" };
  const input = {
    hooks: {
      Stop: [{ hooks: [
        { type: "command", command: "node one/guild-lifecycle-hook.mjs" },
        unrelated,
        { type: "command", commandWindows: "node two/guild-lifecycle-hook.mjs" },
      ] }],
    },
  };

  const { configuration, trustKeys } = mergeLanternwatchHooks(input, hooksPath, scriptPath, nodePath);
  const stopKeys = trustKeys.filter((key) => key.startsWith(`${hooksPath}:stop:`));

  // Only one Lanternwatch handler survives dedup, at index 0; every reported
  // trust key must point at a real Lanternwatch handler in the final config.
  assert.deepEqual(stopKeys, [`${hooksPath}:stop:0:0`]);
  for (const key of stopKeys) {
    const parts = key.split(":");
    const [hookIndex, groupIndex] = [parts.pop(), parts.pop()];
    const hook = configuration.hooks.Stop[Number(groupIndex)]?.hooks[Number(hookIndex)];
    assert.ok(hook && (String(hook.command || "").includes("guild-lifecycle-hook.mjs") || String(hook.commandWindows || "").includes("guild-lifecycle-hook.mjs")));
  }
});
