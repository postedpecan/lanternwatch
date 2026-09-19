import type { GuildAgentActivity } from "../../lib/guild-contract";

export type FocusedWorkflowActivities = {
  doingNow: GuildAgentActivity[];
  upNext: GuildAgentActivity[];
};

export function getFocusedWorkflowActivities(
  activities: GuildAgentActivity[],
  runId: string | null,
  dataAvailable = true,
): FocusedWorkflowActivities {
  if (!dataAvailable || !runId) return { doingNow: [], upNext: [] };

  const focusedActivities = activities.filter((activity) => activity.runId === runId);
  return {
    doingNow: focusedActivities.filter((activity) => activity.status === "working"),
    upNext: focusedActivities.filter((activity) => activity.status === "queued"),
  };
}

export function getDemoNextStepIndex(
  currentStep: number,
  stepCount: number,
  running: boolean,
  delivered: boolean,
) {
  if (!running || delivered || stepCount <= 0) return null;
  const nextStep = currentStep + 1;
  return nextStep >= 0 && nextStep < stepCount ? nextStep : null;
}
