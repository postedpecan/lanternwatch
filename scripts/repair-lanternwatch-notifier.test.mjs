import assert from "node:assert/strict";
import test from "node:test";
import { removeLanternwatchNotifier } from "./repair-lanternwatch-notifier.mjs";

test("removes only a nested Lanternwatch previous notifier", () => {
  const previous = JSON.stringify(["node", String.raw`C:\Project\scripts\guild-notify.mjs`]);
  const input = [
    'model = "gpt"',
    `notify = [ "sky.exe", "turn-ended", "--previous-notify", ${JSON.stringify(previous)} ]`,
    "[features]",
    "hooks = true",
    "",
  ].join("\n");
  const result = removeLanternwatchNotifier(input);
  assert.equal(result.changed, true);
  assert.equal(result.action, "removed-nested-lanternwatch");
  assert.match(result.configText, /^notify = \[ "sky.exe", "turn-ended" \]$/m);
  assert.match(result.configText, /\[features\]\nhooks = true/);
});

test("preserves an unrelated notifier unchanged", () => {
  const input = 'notify = [ "other.exe", "done" ]\n';
  const result = removeLanternwatchNotifier(input);
  assert.equal(result.changed, false);
  assert.equal(result.configText, input);
});

test("restores a saved unrelated notifier when Lanternwatch owns the direct command", () => {
  const input = 'notify = [ "node", "C:\\\\Project\\\\scripts\\\\guild-notify.mjs" ]\n';
  const result = removeLanternwatchNotifier(input, { command: "other.exe", args: ["done"] });
  assert.equal(result.changed, true);
  assert.equal(result.action, "restored-previous-notifier");
  assert.equal(result.configText, 'notify = [ "other.exe", "done" ]\n');
});
