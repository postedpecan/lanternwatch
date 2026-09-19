import assert from "node:assert/strict";
import test from "node:test";
import { getDemoNextStepIndex, getFocusedWorkflowActivities } from "./workflow-activity.ts";

const activity = (overrides) => ({
  id: "project:run-a:instance-a",
  agentInstanceId: "instance-a",
  agent: "frontend-engineer",
  projectId: "project",
  projectName: "Lanternwatch",
  runId: "run-a",
  status: "working",
  message: "Building the focused interface.",
  startedAt: "2026-09-04T00:00:00.000Z",
  updatedAt: "2026-09-04T00:01:00.000Z",
  durationSeconds: 60,
  ...overrides,
});

test("scopes working and queued activities to the focused run", () => {
  const firstInstance = activity({});
  const sameRoleSecondInstance = activity({ id: "project:run-a:instance-b", agentInstanceId: "instance-b" });
  const queued = activity({ id: "project:run-a:qa", agentInstanceId: "qa", agent: "qa-engineer", status: "queued" });
  const otherRun = activity({ id: "project:run-b:instance-c", agentInstanceId: "instance-c", runId: "run-b" });

  const result = getFocusedWorkflowActivities([firstInstance, sameRoleSecondInstance, queued, otherRun], "run-a");

  assert.deepEqual(result.doingNow.map((item) => item.agentInstanceId), ["instance-a", "instance-b"]);
  assert.deepEqual(result.upNext.map((item) => item.agentInstanceId), ["qa"]);
});

test("returns no live work without a focused run", () => {
  assert.deepEqual(getFocusedWorkflowActivities([activity({})], null), { doingNow: [], upNext: [] });
});

test("hides cached live work while data is loading or offline", () => {
  const cached = [
    activity({}),
    activity({ id: "project:run-a:qa", agentInstanceId: "qa", agent: "qa-engineer", status: "queued" }),
  ];

  assert.deepEqual(getFocusedWorkflowActivities(cached, "run-a", false), { doingNow: [], upNext: [] });
});

test("offers only the next stage of an active local demo", () => {
  assert.equal(getDemoNextStepIndex(-1, 8, true, false), 0);
  assert.equal(getDemoNextStepIndex(3, 8, true, false), 4);
  assert.equal(getDemoNextStepIndex(7, 8, true, false), null);
  assert.equal(getDemoNextStepIndex(2, 8, false, false), null);
  assert.equal(getDemoNextStepIndex(2, 8, true, true), null);
});
