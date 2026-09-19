export type ProjectFilterMode = "live" | "demo";

export type ProjectFilterState = {
  disabled: boolean;
  descriptionId: string | undefined;
  showDemoNote: boolean;
};

export function getProjectFilterState(
  hydrated: boolean,
  mode: ProjectFilterMode,
  projectCount: number,
): ProjectFilterState {
  const demo = mode === "demo";

  return {
    disabled: !hydrated || demo || projectCount === 0,
    descriptionId: demo ? "demoScopeNote" : undefined,
    showDemoNote: demo,
  };
}
