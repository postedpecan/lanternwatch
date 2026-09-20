import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { cliEvent, normalizeEventAgentIds, notifyEvent } from "./guild-report.mjs";
import { reporterFallbackCommand, safeNotifyPayload } from "./guild-notify.mjs";
import { lifecycleStoragePaths } from "./guild-paths.mjs";
import { AGENT_IDS, COMPANY_ROLE_ALIASES, COMPANY_ROLE_TITLES, LEGACY_AGENT_ID_ALIASES, canonicalAgentId, companyTitleForAgent, isAmbiguousAgentType, resolveAgentRole, roleForAgentType } from "./guild-roles.mjs";
import { ageSeconds, parseLatestHookLog } from "../lib/guild-health.ts";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readProjectFile = (relativePath) => readFileSync(path.join(projectRoot, relativePath), "utf8");
const workspaceAgentName = (role) => `${role}-lanternwatch`;

const dossiers = {
  "business-analyst": "clarifier-agent.md",
  "program-manager": "dispatcher-agent.md",
  "operations-coordinator": "tracker-agent.md",
  "technical-researcher": "technical-research-agent.md",
  "market-intelligence-analyst": "news-research-agent.md",
  "systems-analyst": "codebase-logic-agent.md",
  "change-management-analyst": "codebase-history-agent.md",
  "platform-engineer": "hookwright-agent.md",
  "frontend-engineer": "interface-weaver-agent.md",
  "data-engineer": "ledgerkeeper-agent.md",
  "qa-engineer": "prover-agent.md",
  "technical-writer": "chronicle-writer-agent.md",
  "strategy-consultant": "memo-writer-agent.md",
  "compliance-reviewer": "auditor-agent.md",
};

test("server and browser agent registries match", () => {
  const source = readProjectFile("lib/guild-data.ts");
  const match = source.match(/export const AGENT_IDS = (\[[\s\S]*?\]) as const;/);
  assert.ok(match, "lib/guild-data.ts must export a literal AGENT_IDS array");
  const browserAgentIds = [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
  assert.deepEqual(browserAgentIds, AGENT_IDS);
});

test("every registered role has a dossier and workflow references", () => {
  const workflow = readProjectFile("AGENTS.md").toLowerCase();
  const roster = readProjectFile("Agents/README.md").toLowerCase();
  for (const agent of AGENT_IDS) {
    assert.ok(existsSync(path.join(projectRoot, "Agents", dossiers[agent])), `${agent} dossier is missing`);
    assert.match(workflow, new RegExp(agent.replace("-", "[- ]")), `${agent} is missing from AGENTS.md`);
    assert.match(roster, new RegExp(agent.replace("-", "[- ]")), `${agent} is missing from the roster`);
  }
});

test("every registered role has selective capability policy and a Codex custom-agent binding", () => {
  const capabilities = readProjectFile("Agents/capabilities.md");
  for (const agent of AGENT_IDS) {
    const heading = `## \`${agent}\``;
    const start = capabilities.indexOf(heading);
    assert.notEqual(start, -1, `${agent} capability section is missing`);
    const next = capabilities.indexOf("\n## ", start + heading.length);
    const section = capabilities.slice(start, next === -1 ? undefined : next);
    assert.match(section, /Availability check:/, `${agent} needs an availability check`);
    assert.match(section, /Fallback:/, `${agent} needs a fallback`);
    assert.match(section, /Do not:/, `${agent} needs an explicit capability boundary`);

    const name = workspaceAgentName(agent);
    const configPath = path.join(projectRoot, ".codex", "agents", `${name}.toml`);
    assert.ok(existsSync(configPath), `${agent} custom-agent config is missing`);
    const config = readFileSync(configPath, "utf8");
    assert.match(config, new RegExp(`^name = "${name}"$`, "m"));
    assert.match(config, /^developer_instructions = (?:"""|")/m);
    assert.ok(config.includes(`Agents/${dossiers[agent]}`), `${agent} config must route to its dossier`);
    assert.ok(config.includes("Agents/capabilities.md"), `${agent} config must route to capability policy`);
    assert.doesNotMatch(config, /^sandbox_mode\s*=/m, `${agent} must inherit the parent's permission mode`);
  }
});

test("role dossiers point to the current company-title preference headings", () => {
  const preferenceHeadings = {
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
  };

  const preferences = readProjectFile("Agents/preferences.md");
  for (const agent of AGENT_IDS) {
    const title = preferenceHeadings[agent];
    assert.ok(preferences.includes(`## ${title}`), `${title} preference heading is missing`);
    assert.ok(readProjectFile(path.join("Agents", dossiers[agent])).includes(`read the "${title}" section`), `${agent} dossier references a stale preference heading`);
  }
});

test("lifecycle agent identity handles current and legacy task-name aliases", () => {
  assert.equal(roleForAgentType("/root/platform_engineer_hooks"), "platform-engineer");
  assert.equal(roleForAgentType("/root/hookwright_hooks"), "platform-engineer");
  assert.equal(roleForAgentType("/root/frontend_engineer_dashboard"), "frontend-engineer");
  assert.equal(roleForAgentType("/root/interface_weaver_dashboard"), "frontend-engineer");
  assert.equal(roleForAgentType("ledgerkeeper migration"), "data-engineer");
  assert.equal(roleForAgentType("prover_build"), "qa-engineer");
  assert.equal(roleForAgentType("technical-research"), "technical-researcher");
  assert.equal(roleForAgentType("technical-researcher-lanternwatch"), "technical-researcher");
  assert.equal(roleForAgentType("frontend-engineer-lanternwatch"), "frontend-engineer");
  assert.equal(roleForAgentType("unclassified-specialist"), "systems-analyst");
});

test("company titles and task-name slugs normalize to matching canonical IDs", () => {
  const companyTitles = {
    "Business Analyst": "business-analyst",
    "Program Manager": "program-manager",
    "Operations Coordinator": "operations-coordinator",
    "Technical Researcher": "technical-researcher",
    "Market Intelligence Analyst": "market-intelligence-analyst",
    "Systems Analyst": "systems-analyst",
    "Change Management Analyst": "change-management-analyst",
    "Platform Engineer": "platform-engineer",
    "Frontend Engineer": "frontend-engineer",
    "Data Engineer": "data-engineer",
    "QA Engineer": "qa-engineer",
    "Technical Writer": "technical-writer",
    "Strategy Consultant": "strategy-consultant",
    "Compliance Reviewer": "compliance-reviewer",
  };

  assert.equal(Object.keys(COMPANY_ROLE_ALIASES).length, AGENT_IDS.length);
  assert.equal(Object.keys(COMPANY_ROLE_TITLES).length, AGENT_IDS.length);
  assert.equal(Object.keys(LEGACY_AGENT_ID_ALIASES).length, AGENT_IDS.length);
  for (const [title, canonicalId] of Object.entries(companyTitles)) {
    const slug = title.toLowerCase().replace(/\s+/g, "-");
    const taskName = `/root/${slug.replaceAll("-", "_")}_task`;
    assert.equal(canonicalAgentId(title), canonicalId, `${title} title`);
    assert.equal(canonicalAgentId(slug), canonicalId, `${slug} slug`);
    assert.equal(canonicalAgentId(taskName), canonicalId, `${taskName} task name`);
    assert.equal(canonicalAgentId(`${canonicalId}-lanternwatch`), canonicalId, `${canonicalId} workspace custom agent`);
    assert.deepEqual(resolveAgentRole(title), { role: canonicalId, matched: true });
    assert.equal(roleForAgentType(taskName), canonicalId);
    assert.equal(canonicalAgentId(canonicalId), canonicalId, `${canonicalId} canonical ID`);
    assert.equal(companyTitleForAgent(canonicalId), title, `${canonicalId} company title`);
  }
  for (const [legacyId, canonicalId] of Object.entries(LEGACY_AGENT_ID_ALIASES)) {
    assert.equal(canonicalAgentId(legacyId), canonicalId, `${legacyId} legacy ID`);
    assert.equal(canonicalAgentId(`/root/${legacyId.replaceAll("-", "_")}_task`), canonicalId, `${legacyId} legacy task name`);
  }
});

test("reporter normalization preserves raw custom-agent identity alongside canonical roles", () => {
  assert.deepEqual(normalizeEventAgentIds({
    agent: "Frontend Engineer",
    from: "/root/program_manager_dispatch",
  }), {
    agent: "frontend-engineer",
    agentType: "frontend-engineer",
    from: "program-manager",
  });
  assert.deepEqual(normalizeEventAgentIds({
    agent: "frontend-engineer-lanternwatch",
    agentType: "frontend-engineer-lanternwatch",
    from: "/root/program_manager_dispatch",
  }), {
    agent: "frontend-engineer",
    agentType: "frontend-engineer-lanternwatch",
    from: "program-manager",
  });
  assert.deepEqual(normalizeEventAgentIds({ agent: "unknown", from: "unknown" }), {
    agent: "unknown",
    agentType: "unknown",
    from: "unknown",
  });
});

test("manual reporting accepts company titles while emitting canonical IDs", () => {
  const event = cliEvent([
    "--agent", "Business Analyst",
    "--from", "/root/program_manager_dispatch",
    "--status", "working",
    "--project", projectRoot,
  ]);
  assert.equal(event.agent, "business-analyst");
  assert.equal(event.from, "program-manager");
  assert.equal(event.message, "Business Analyst changed state to working.");
});

test("Claude Code built-in subagent types get an explicit role, not the Systems Analyst fallback by accident", () => {
  // These are Claude Code's known, enumerable built-in subagent type strings.
  // None of them textually contain a guild role id, so before the explicit
  // CLAUDE_CODE_BUILTIN_ROLES mapping existed they all silently collapsed to
  // the "systems-analyst" default. Each must resolve via a deliberate, named
  // mapping (see the comment above CLAUDE_CODE_BUILTIN_ROLES in guild-roles.mjs).
  assert.equal(roleForAgentType("general-purpose"), "systems-analyst");
  assert.equal(roleForAgentType("Explore"), "systems-analyst");
  assert.equal(roleForAgentType("Plan"), "program-manager");
  assert.equal(roleForAgentType("claude-code-guide"), "technical-researcher");
  assert.equal(roleForAgentType("statusline-setup"), "frontend-engineer");
  // Case/casing and separator variants must resolve the same way.
  assert.equal(roleForAgentType("General_Purpose"), "systems-analyst");
  assert.equal(roleForAgentType("STATUSLINE SETUP"), "frontend-engineer");
  // A genuinely unclassified custom type still falls back to Systems Analyst.
  assert.equal(roleForAgentType("unclassified-specialist"), "systems-analyst");
});

test("resolveAgentRole/isAmbiguousAgentType distinguish confident matches from the low-confidence Systems Analyst default", () => {
  // Confident matches: all five Claude Code builtin roles.
  assert.deepEqual(resolveAgentRole("general-purpose"), { role: "systems-analyst", matched: true });
  assert.deepEqual(resolveAgentRole("explore"), { role: "systems-analyst", matched: true });
  assert.deepEqual(resolveAgentRole("plan"), { role: "program-manager", matched: true });
  assert.deepEqual(resolveAgentRole("claude-code-guide"), { role: "technical-researcher", matched: true });
  assert.deepEqual(resolveAgentRole("statusline-setup"), { role: "frontend-engineer", matched: true });
  for (const type of ["general-purpose", "explore", "plan", "claude-code-guide", "statusline-setup"]) {
    assert.equal(isAmbiguousAgentType(type), false, `${type} should not be ambiguous`);
  }
  // Confident match: a role-id substring.
  assert.deepEqual(resolveAgentRole("prover_build"), { role: "qa-engineer", matched: true });
  assert.equal(isAmbiguousAgentType("prover_build"), false);
  // Confident match: a research/technical/news keyword.
  assert.deepEqual(resolveAgentRole("technical-research"), { role: "technical-researcher", matched: true });
  assert.equal(isAmbiguousAgentType("technical-research"), false);
  assert.deepEqual(resolveAgentRole("breaking-news-scan"), { role: "market-intelligence-analyst", matched: true });
  assert.equal(isAmbiguousAgentType("breaking-news-scan"), false);
  // Ambiguous: the generic "claude" catch-all, an unrecognized custom type,
  // and empty/undefined input all fall through to the unconditional default.
  assert.deepEqual(resolveAgentRole("claude"), { role: "systems-analyst", matched: false });
  assert.deepEqual(resolveAgentRole("unknown-thing"), { role: "systems-analyst", matched: false });
  assert.deepEqual(resolveAgentRole(""), { role: "systems-analyst", matched: false });
  assert.deepEqual(resolveAgentRole(undefined), { role: "systems-analyst", matched: false });
  for (const type of ["claude", "unknown-thing", "", undefined]) {
    assert.equal(isAmbiguousAgentType(type), true, `${String(type)} should be ambiguous`);
  }
  // roleForAgentType's existing behavior/signature must be unchanged: it
  // still always returns just the role string for every case above.
  for (const type of ["general-purpose", "plan", "claude-code-guide", "statusline-setup", "prover_build", "technical-research", "breaking-news-scan", "claude", "unknown-thing", "", undefined]) {
    assert.equal(roleForAgentType(type), resolveAgentRole(type).role);
  }
});

test("lifecycle storage paths honor an isolated root and preserve the production default", () => {
  const portableHome = path.join(projectRoot, ".tmp", "portable-home");
  const portableDefault = path.join(portableHome, ".lanternwatch");
  assert.deepEqual(lifecycleStoragePaths(undefined, undefined, { USERPROFILE: portableHome }), {
    root: portableDefault,
    stateDirectory: path.join(portableDefault, "sessions"),
    logDirectory: path.join(portableDefault, "logs"),
  });
  const isolatedRoot = path.join(projectRoot, ".tmp", "lifecycle-storage");
  assert.deepEqual(lifecycleStoragePaths(isolatedRoot), {
    root: isolatedRoot,
    stateDirectory: path.join(isolatedRoot, "sessions"),
    logDirectory: path.join(isolatedRoot, "logs"),
  });
});

test("hook diagnostics parse the latest valid receipt without throwing", () => {
  const parsed = parseLatestHookLog([
    JSON.stringify({ at: "2026-08-09T08:00:00.000Z", event: "UserPromptSubmit", stage: "received", source: "codex" }),
    "not json",
    JSON.stringify({ receivedAt: "2026-08-09T08:01:00.000Z", hook_event_name: "SubagentStart", stage: "handled", source: "claude" }),
  ].join("\n"));

  assert.deepEqual(parsed, {
    status: "malformed",
    receiptAt: "2026-08-09T08:01:00.000Z",
    event: "SubagentStart",
    stage: "handled",
    source: "claude",
  });
  assert.equal(ageSeconds(parsed.receiptAt, Date.parse("2026-08-09T08:01:05.900Z")), 5);
});

test("hook diagnostics distinguish empty and malformed logs", () => {
  assert.deepEqual(parseLatestHookLog("\n"), {
    status: "empty", receiptAt: null, event: null, stage: null, source: null,
  });
  assert.deepEqual(parseLatestHookLog("{broken"), {
    status: "malformed", receiptAt: null, event: null, stage: null, source: null,
  });
});

test("hook diagnostics preserve backward compatibility and reject untrusted source labels", () => {
  assert.equal(parseLatestHookLog(JSON.stringify({ at: "2026-08-09T08:00:00.000Z" })).source, null);
  assert.equal(parseLatestHookLog(JSON.stringify({ at: "2026-08-09T08:00:00.000Z", source: "other" })).source, null);
});

test("notify fallback uses stable run and event identity", () => {
  const payload = {
    cwd: projectRoot,
    "thread-id": "thread-42",
    "turn-id": "turn-7",
  };
  const first = notifyEvent(payload);
  const second = notifyEvent({ ...payload });
  assert.equal(first.runId, "codex-thread-42-turn-7");
  assert.equal(first.eventId, "hook-stop-thread-42-turn-7");
  assert.equal(first.source, "codex");
  assert.equal(second.runId, first.runId);
  assert.equal(second.eventId, first.eventId);
  assert.equal(first.runComplete, true);
});

test("notifier fallback passes only allowlisted metadata without a shell", () => {
  const raw = JSON.stringify({
    cwd: projectRoot,
    "thread-id": "thread-42",
    "turn-id": "turn-7",
    prompt: "private prompt",
    command: "private command",
    "last-assistant-message": "private response",
  });
  assert.deepEqual(safeNotifyPayload(raw), {
    cwd: projectRoot,
    "thread-id": "thread-42",
    "turn-id": "turn-7",
  });
  const fallback = reporterFallbackCommand(raw, "node-test", "report-test.mjs");
  assert.equal(fallback.command, "node-test");
  assert.deepEqual(fallback.args.slice(0, 2), ["report-test.mjs", "--notify"]);
  assert.deepEqual(JSON.parse(fallback.args[2]), safeNotifyPayload(raw));
  assert.equal(fallback.args[3], "--quiet");
  assert.equal(fallback.options.detached, true);
  assert.equal(fallback.options.stdio, "ignore");
  assert.equal(fallback.options.shell, false);
  assert.doesNotMatch(fallback.args.join(" "), /private prompt|private command|private response/);
  assert.deepEqual(safeNotifyPayload("null"), {});
  assert.deepEqual(safeNotifyPayload("not-json"), {});
});
