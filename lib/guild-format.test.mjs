import assert from "node:assert/strict";
import test from "node:test";
import { formatElapsed } from "./guild-format.ts";

test("formatElapsed stays MM:SS under an hour", () => {
  assert.equal(formatElapsed(0), "00:00");
  assert.equal(formatElapsed(59), "00:59");
  assert.equal(formatElapsed(60), "01:00");
  assert.equal(formatElapsed(3599), "59:59");
});

test("formatElapsed switches to H:MM:SS at an hour and beyond", () => {
  assert.equal(formatElapsed(3600), "1:00:00");
  assert.equal(formatElapsed(3601), "1:00:01");
  assert.equal(formatElapsed(36000), "10:00:00");
  assert.equal(formatElapsed(7325), "2:02:05");
});

test("formatElapsed guards against negative, NaN, and non-finite input", () => {
  assert.equal(formatElapsed(-5), "00:00");
  assert.equal(formatElapsed(Number.NaN), "00:00");
  assert.equal(formatElapsed(Number.POSITIVE_INFINITY), "00:00");
  assert.equal(formatElapsed(12.9), "00:12");
});
