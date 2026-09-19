export const AGENT_IDS = Object.freeze([
  "business-analyst",
  "program-manager",
  "operations-coordinator",
  "technical-researcher",
  "market-intelligence-analyst",
  "systems-analyst",
  "change-management-analyst",
  "platform-engineer",
  "frontend-engineer",
  "data-engineer",
  "qa-engineer",
  "technical-writer",
  "strategy-consultant",
  "compliance-reviewer",
]);

export const AGENT_ID_SET = new Set(AGENT_IDS);

// Canonical lifecycle IDs are the normalized company-title slugs. Historical
// fantasy IDs remain accepted inputs through LEGACY_AGENT_ID_ALIASES below,
// but every resolver output uses one of these canonical IDs.
export const COMPANY_ROLE_TITLES = Object.freeze({
  "business-analyst": "Business Analyst",
  "program-manager": "Program Manager",
  "operations-coordinator": "Operations Coordinator",
  "technical-researcher": "Technical Researcher",
  "market-intelligence-analyst": "Market Intelligence Analyst",
  "systems-analyst": "Systems Analyst",
  "change-management-analyst": "Change Management Analyst",
  "platform-engineer": "Platform Engineer",
  "frontend-engineer": "Frontend Engineer",
  "data-engineer": "Data Engineer",
  "qa-engineer": "QA Engineer",
  "technical-writer": "Technical Writer",
  "strategy-consultant": "Strategy Consultant",
  "compliance-reviewer": "Compliance Reviewer",
});

export const COMPANY_ROLE_ALIASES = Object.freeze({
  "business-analyst": "business-analyst",
  "program-manager": "program-manager",
  "operations-coordinator": "operations-coordinator",
  "technical-researcher": "technical-researcher",
  "market-intelligence-analyst": "market-intelligence-analyst",
  "systems-analyst": "systems-analyst",
  "change-management-analyst": "change-management-analyst",
  "platform-engineer": "platform-engineer",
  "frontend-engineer": "frontend-engineer",
  "data-engineer": "data-engineer",
  "qa-engineer": "qa-engineer",
  "technical-writer": "technical-writer",
  "strategy-consultant": "strategy-consultant",
  "compliance-reviewer": "compliance-reviewer",
});

export const LEGACY_AGENT_ID_ALIASES = Object.freeze({
  herald: "business-analyst",
  guildmaster: "program-manager",
  steward: "operations-coordinator",
  pathfinder: "technical-researcher",
  courier: "market-intelligence-analyst",
  archivist: "systems-analyst",
  genealogist: "change-management-analyst",
  hookwright: "platform-engineer",
  "interface-weaver": "frontend-engineer",
  ledgerkeeper: "data-engineer",
  prover: "qa-engineer",
  chronicler: "technical-writer",
  counselor: "strategy-consultant",
  assayer: "compliance-reviewer",
});

// Claude Code's built-in subagent types are a known, enumerable set (unlike
// arbitrary custom/unclassified strings) but none of them textually contain a
// guild role id, so they would otherwise fall through the substring loop
// below and silently collapse to the Systems Analyst default. Map each one
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
  "general-purpose": "systems-analyst",
  explore: "systems-analyst",
  plan: "program-manager",
  "claude-code-guide": "technical-researcher",
  "statusline-setup": "frontend-engineer",
});

function normalizedRoleName(type) {
  return String(type || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Returns a canonical company-title ID for a current ID, legacy ID, or title
// alias. Substrings are intentional: hosts commonly prefix task names with a
// path such as /root/frontend_engineer_dashboard.
export function canonicalAgentId(type) {
  const value = normalizedRoleName(type);
  for (const role of AGENT_IDS) {
    if (value.includes(role)) return role;
  }
  for (const [alias, role] of Object.entries(LEGACY_AGENT_ID_ALIASES)) {
    if (value.includes(alias)) return role;
  }
  return undefined;
}

export function companyTitleForAgent(type) {
  const role = canonicalAgentId(type);
  return role ? COMPANY_ROLE_TITLES[role] : undefined;
}

// Resolves an agent_type string to a role plus whether the match was a
// deliberate rule (a Claude Code builtin, a role-id substring, or a
// research/news keyword) or the unconditional Systems Analyst default at the
// bottom, which is a low-confidence guess rather than a real identification.
// Callers that need to tell those apart (e.g. deciding whether to auto-report
// to the dashboard) should use this instead of re-deriving the distinction.
export function resolveAgentRole(type) {
  const value = normalizedRoleName(type);
  if (Object.prototype.hasOwnProperty.call(CLAUDE_CODE_BUILTIN_ROLES, value)) {
    return { role: CLAUDE_CODE_BUILTIN_ROLES[value], matched: true };
  }
  const canonicalRole = canonicalAgentId(value);
  if (canonicalRole) return { role: canonicalRole, matched: true };
  if (value.includes("research") || value.includes("technical")) return { role: "technical-researcher", matched: true };
  if (value.includes("news")) return { role: "market-intelligence-analyst", matched: true };
  return { role: "systems-analyst", matched: false };
}

// Ambiguous means resolveAgentRole() had to fall all the way through to its
// unconditional default rather than matching a deliberate rule.
export function isAmbiguousAgentType(type) {
  return !resolveAgentRole(type).matched;
}

export function roleForAgentType(type) {
  return resolveAgentRole(type).role;
}
