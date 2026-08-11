import assert from "node:assert/strict";
import test from "node:test";
import { mergeLanternwatchClaudeHooks } from "./merge-claude-hooks.mjs";

const scriptPath = String.raw`C:\Project\scripts\guild-lifecycle-hook.mjs`;
const nodePath = String.raw`C:\Tools\node.exe`;

test("installs all five Lanternwatch hooks while preserving unrelated hooks, settings, and positions", () => {
  const unrelated = { type: "command", command: "node unrelated.mjs" };
  const oldLanternwatch = { type: "command", command: nodePath, args: ["old/guild-lifecycle-hook.mjs", "claude"] };
  const input = {
    theme: "dark",
    hooks: {
      UserPromptSubmit: [{ hooks: [unrelated] }, { hooks: [oldLanternwatch] }],
      Stop: [{ hooks: [oldLanternwatch, unrelated] }],
      CustomEvent: [{ hooks: [unrelated] }],
    },
  };

  const configuration = mergeLanternwatchClaudeHooks(input, scriptPath, nodePath);

  assert.equal(configuration.theme, "dark");
  assert.equal(configuration.hooks.UserPromptSubmit.length, 2);
  assert.deepEqual(configuration.hooks.UserPromptSubmit[0].hooks, [unrelated]);
  assert.deepEqual(configuration.hooks.UserPromptSubmit[1].hooks[0], { type: "command", command: nodePath, args: [scriptPath, "claude"], timeout: 5 });
  assert.deepEqual(configuration.hooks.Stop[0].hooks[1], unrelated);
  assert.deepEqual(configuration.hooks.CustomEvent, [{ hooks: [unrelated] }]);
  assert.equal(configuration.hooks.SessionEnd[0].hooks[0].timeout, 3);
  assert.equal(configuration.hooks.SubagentStart[0].hooks[0].timeout, 5);
  assert.equal(configuration.hooks.SubagentStop[0].hooks[0].timeout, 5);
  assert.deepEqual(configuration.hooks.SubagentStart[0].hooks[0].args, [scriptPath, "claude"]);
});

test("deduplicates Lanternwatch handlers without removing another handler or a Windows-style commandWindows sibling", () => {
  const unrelated = { type: "command", command: "node unrelated.mjs" };
  const input = {
    hooks: {
      Stop: [{ hooks: [
        { type: "command", command: nodePath, args: ["one/guild-lifecycle-hook.mjs", "claude"] },
        unrelated,
        { type: "command", command: nodePath, args: ["two/guild-lifecycle-hook.mjs", "claude"] },
      ] }],
    },
  };

  const configuration = mergeLanternwatchClaudeHooks(input, scriptPath, nodePath);
  assert.equal(configuration.hooks.Stop[0].hooks.length, 2);
  assert.equal(configuration.hooks.Stop[0].hooks[1], unrelated);
});

test("never introduces a commandWindows key (Claude Code has no such field)", () => {
  const configuration = mergeLanternwatchClaudeHooks({}, scriptPath, nodePath);
  for (const eventName of Object.keys(configuration.hooks)) {
    for (const group of configuration.hooks[eventName]) {
      for (const hook of group.hooks) {
        assert.equal(hook.commandWindows, undefined);
        assert.equal(hook.command, nodePath);
        assert.deepEqual(hook.args, [scriptPath, "claude"]);
      }
    }
  }
});
