export const AGENT_IDS = Object.freeze([
  "herald",
  "guildmaster",
  "steward",
  "pathfinder",
  "courier",
  "archivist",
  "genealogist",
  "hookwright",
  "interface-weaver",
  "ledgerkeeper",
  "prover",
  "chronicler",
  "counselor",
  "assayer",
]);

export const AGENT_ID_SET = new Set(AGENT_IDS);

// Claude Code's built-in subagent types are a known, enumerable set (unlike
// arbitrary custom/unclassified strings) but none of them textually contain a
// guild role id, so they would otherwise fall through the substring loop
// below and silently collapse to the "archivist" default. Map each one
// explicitly instead:
//   - "general-purpose": open-ended multi-step research/task agent -> the
//     Archivist's "reads the codebase/records as they are now" charter is the
//     closest fit for an unscoped investigative catch-all.
//   - "explore": read-only search/investigation agent (locate files, grep
//     symbols, trace references) -> Archivist, whose whole charter is reading
//     what's actually there, current-behavior only, no writes.
//   - "plan": architecture/implementation-planning agent (designs the
//     approach, decides critical files) -> Guildmaster, whose role is
//     deciding who does what and writing the scoped plan, not doing the work.
//   - "claude-code-guide": answers questions about Claude Code itself from
//     its own docs -> Pathfinder, the documented/technical-fact specialist.
//   - "statusline-setup": configures a UI/interface element -> Interface
//     Weaver, who owns interface and presentation work.
const CLAUDE_CODE_BUILTIN_ROLES = Object.freeze({
  "general-purpose": "archivist",
  explore: "archivist",
  plan: "guildmaster",
  "claude-code-guide": "pathfinder",
  "statusline-setup": "interface-weaver",
});

// Resolves an agent_type string to a role plus whether the match was a
// deliberate rule (a Claude Code builtin, a role-id substring, or a
// research/news keyword) or the unconditional "archivist" default at the
// bottom, which is a low-confidence guess rather than a real identification.
// Callers that need to tell those apart (e.g. deciding whether to auto-report
// to the dashboard) should use this instead of re-deriving the distinction.
export function resolveAgentRole(type) {
  const value = String(type || "").toLowerCase().replace(/[_\s]+/g, "-");
  if (Object.prototype.hasOwnProperty.call(CLAUDE_CODE_BUILTIN_ROLES, value)) {
    return { role: CLAUDE_CODE_BUILTIN_ROLES[value], matched: true };
  }
  for (const role of AGENT_IDS) {
    if (value.includes(role)) return { role, matched: true };
  }
  if (value.includes("research") || value.includes("technical")) return { role: "pathfinder", matched: true };
  if (value.includes("news")) return { role: "courier", matched: true };
  return { role: "archivist", matched: false };
}

// Ambiguous means resolveAgentRole() had to fall all the way through to its
// unconditional default rather than matching a deliberate rule.
export function isAmbiguousAgentType(type) {
  return !resolveAgentRole(type).matched;
}

export function roleForAgentType(type) {
  return resolveAgentRole(type).role;
}

