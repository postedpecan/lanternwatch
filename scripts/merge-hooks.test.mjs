import assert from "node:assert/strict";
import test from "node:test";
import { mergeLanternwatchHooks } from "./merge-hooks.mjs";

const hooksPath = String.raw`C:\Users\Test\.codex\hooks.json`;
const scriptPath = String.raw`C:\Project\scripts\guild-lifecycle-hook.mjs`;
const nodePath = String.raw`C:\Tools\node.exe`;

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

  const { configuration, trustKeys } = mergeLanternwatchHooks(input, hooksPath, scriptPath, nodePath);

  assert.equal(configuration.hooks.UserPromptSubmit.length, 2);
  assert.deepEqual(configuration.hooks.UserPromptSubmit[0].hooks, [unrelated]);
  assert.match(configuration.hooks.UserPromptSubmit[1].hooks[0].commandWindows, /C:\\Tools\\node\.exe/);
  assert.deepEqual(configuration.hooks.Stop[0].hooks[1], unrelated);
  assert.deepEqual(configuration.hooks.CustomEvent, [{ hooks: [unrelated] }]);
  assert.equal(configuration.hooks.SessionEnd[0].hooks[0].timeout, 3);
  assert.equal(configuration.hooks.SubagentStart[0].hooks[0].timeout, 5);
  assert.equal(configuration.hooks.SubagentStop[0].hooks[0].timeout, 5);
  assert.ok(trustKeys.includes(`${hooksPath}:user_prompt_submit:1:0`));
  assert.ok(trustKeys.includes(`${hooksPath}:stop:0:0`));
  assert.ok(trustKeys.includes(`${hooksPath}:session_end:0:0`));
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
