import assert from "node:assert/strict";
import test from "node:test";
import { describeHookDiagnostic } from "./hook-diagnostic.ts";

const health = (hookLogStatus, overrides = {}) => ({
  hookLogPath: String.raw`C:\LanternwatchTest\logs\hook.jsonl`,
  hookLogStatus,
  lastHookReceiptAgeSeconds: null,
  ...overrides,
});

const formatAge = (seconds) => `${seconds}s ago`;

test("missing and empty hook logs explain that no receipt was observed", () => {
  for (const status of ["missing", "empty"]) {
    const diagnostic = describeHookDiagnostic(true, health(status), formatAge);
    assert.match(diagnostic.warning, /No lifecycle receipt has been observed/);
    assert.match(diagnostic.warning, /Fully exit Codex and start a fresh chat/);
    assert.match(diagnostic.warning, /run \/hooks inside the Codex CLI/);
  }
});

test("malformed hook data is identified without trust guidance", () => {
  const diagnostic = describeHookDiagnostic(true, health("malformed"), formatAge);
  assert.equal(diagnostic.label, "Hook log malformed");
  assert.equal(diagnostic.warning, "The hook log contains invalid lifecycle data.");
});

test("unreadable hook data names the inaccessible health path", () => {
  const diagnostic = describeHookDiagnostic(true, health("unreadable"), formatAge);
  assert.equal(diagnostic.label, "Hook log unreadable");
  assert.equal(
    diagnostic.warning,
    String.raw`Hook log C:\LanternwatchTest\logs\hook.jsonl is inaccessible.`,
  );
});

test("healthy hook data has no warning", () => {
  assert.deepEqual(
    describeHookDiagnostic(
      true,
      health("ok", { lastHookReceiptAgeSeconds: 8 }),
      formatAge,
    ),
    { label: "Hook received 8s ago", warning: null },
  );
});

test("a disconnected health API keeps its distinct diagnostic", () => {
  assert.deepEqual(describeHookDiagnostic(false, null, formatAge), {
    label: "Hook status unavailable",
    warning: "Lifecycle signal cannot be checked until the health API responds.",
  });
});
