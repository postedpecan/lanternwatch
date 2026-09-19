import type { GuildRun, StoredGuildEvent } from "@/lib/guild-contract";

/** A terminal run needs a visible caveat when its focused event trail records only the dispatcher. */
export function needsDelegationWarning(run: GuildRun | null, events: StoredGuildEvent[]) {
  return Boolean(run && run.status !== "working" && !events.some((event) => event.agent !== "program-manager"));
}
