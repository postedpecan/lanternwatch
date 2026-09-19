import assert from "node:assert/strict";
import test from "node:test";
import { needsDelegationWarning } from "./delegation-warning.ts";

const run = (status) => ({ id: "run-1", status });
const event = (agent) => ({ agent });

test("warns only for a terminal focused run without a delegated specialist event", () => {
  assert.equal(needsDelegationWarning(run("complete"), [event("program-manager")]), true);
  assert.equal(needsDelegationWarning(run("complete"), []), true);
  assert.equal(needsDelegationWarning(run("complete"), [event("program-manager"), event("frontend-engineer")]), false);
  assert.equal(needsDelegationWarning(run("working"), [event("program-manager")]), false);
  assert.equal(needsDelegationWarning(null, [event("program-manager")]), false);
});
