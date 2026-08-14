import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { cliEvent, normalizeEventAgentIds, notifyEvent } from "./guild-report.mjs";
import { reporterFallbackCommand, safeNotifyPayload } from "./guild-notify.mjs";
import { DEFAULT_STORAGE_ROOT, lifecycleStoragePaths } from "./guild-paths.mjs";
import { AGENT_IDS, COMPANY_ROLE_ALIASES, COMPANY_ROLE_TITLES, canonicalAgentId, companyTitleForAgent, isAmbiguousAgentType, resolveAgentRole, roleForAgentType } from "./guild-roles.mjs";
import { ageSeconds, parseLatestHookLog } from "../lib/guild-health.ts";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readProjectFile = (relativePath) => readFileSync(path.join(projectRoot, relativePath), "utf8");

const dossiers = {
  herald: "clarifier-agent.md",
  guildmaster: "dispatcher-agent.md",
  steward: "tracker-agent.md",
  pathfinder: "technical-research-agent.md",
  courier: "news-research-agent.md",
  archivist: "codebase-logic-agent.md",
  genealogist: "codebase-history-agent.md",
  hookwright: "hookwright-agent.md",
  "interface-weaver": "interface-weaver-agent.md",
  ledgerkeeper: "ledgerkeeper-agent.md",
  prover: "prover-agent.md",
  chronicler: "chronicle-writer-agent.md",
  counselor: "memo-writer-agent.md",
  assayer: "auditor-agent.md",
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

test("lifecycle agent identity handles task-name aliases", () => {
  assert.equal(roleForAgentType("/root/hookwright_hooks"), "hookwright");
  assert.equal(roleForAgentType("/root/interface_weaver_dashboard"), "interface-weaver");
  assert.equal(roleForAgentType("ledgerkeeper migration"), "ledgerkeeper");
  assert.equal(roleForAgentType("prover_build"), "prover");
  assert.equal(roleForAgentType("technical-research"), "pathfinder");
  assert.equal(roleForAgentType("unclassified-specialist"), "archivist");
});

test("company titles and task-name slugs normalize to canonical legacy IDs", () => {
  const companyTitles = {
    "Business Analyst": "herald",
    "Program Manager": "guildmaster",
    "Operations Coordinator": "steward",
    "Technical Researcher": "pathfinder",
    "Market Intelligence Analyst": "courier",
    "Systems Analyst": "archivist",
    "Change Management Analyst": "genealogist",
    "Platform Engineer": "hookwright",
    "Frontend Engineer": "interface-weaver",
    "Data Engineer": "ledgerkeeper",
    "QA Engineer": "prover",
    "Technical Writer": "chronicler",
    "Strategy Consultant": "counselor",
    "Compliance Reviewer": "assayer",
  };

  assert.equal(Object.keys(COMPANY_ROLE_ALIASES).length, AGENT_IDS.length);
  assert.equal(Object.keys(COMPANY_ROLE_TITLES).length, AGENT_IDS.length);
  for (const [title, canonicalId] of Object.entries(companyTitles)) {
    const slug = title.toLowerCase().replace(/\s+/g, "-");
    const taskName = `/root/${slug.replaceAll("-", "_")}_task`;
    assert.equal(canonicalAgentId(title), canonicalId, `${title} title`);
    assert.equal(canonicalAgentId(slug), canonicalId, `${slug} slug`);
    assert.equal(canonicalAgentId(taskName), canonicalId, `${taskName} task name`);
    assert.deepEqual(resolveAgentRole(title), { role: canonicalId, matched: true });
    assert.equal(roleForAgentType(taskName), canonicalId);
    assert.equal(canonicalAgentId(canonicalId), canonicalId, `${canonicalId} legacy ID`);
    assert.equal(companyTitleForAgent(canonicalId), title, `${canonicalId} public title`);
  }
});

test("reporter normalization keeps company aliases out of stored and API identities", () => {
  assert.deepEqual(normalizeEventAgentIds({
    agent: "Frontend Engineer",
    from: "/root/program_manager_dispatch",
  }), {
    agent: "interface-weaver",
    from: "guildmaster",
  });
  assert.deepEqual(normalizeEventAgentIds({ agent: "unknown", from: "unknown" }), {
    agent: "guildmaster",
    from: undefined,
  });
});

test("manual reporting accepts company titles while emitting canonical IDs", () => {
  const event = cliEvent([
    "--agent", "Business Analyst",
    "--from", "/root/program_manager_dispatch",
    "--status", "working",
    "--project", projectRoot,
  ]);
  assert.equal(event.agent, "herald");
  assert.equal(event.from, "guildmaster");
  assert.equal(event.message, "Business Analyst changed state to working.");
});

test("Claude Code built-in subagent types get an explicit role, not the archivist fallback by accident", () => {
  // These are Claude Code's known, enumerable built-in subagent type strings.
  // None of them textually contain a guild role id, so before the explicit
  // CLAUDE_CODE_BUILTIN_ROLES mapping existed they all silently collapsed to
  // the "archivist" default. Each must now resolve via a deliberate, named
  // mapping (see the comment above CLAUDE_CODE_BUILTIN_ROLES in guild-roles.mjs).
  assert.equal(roleForAgentType("general-purpose"), "archivist");
  assert.equal(roleForAgentType("Explore"), "archivist");
  assert.equal(roleForAgentType("Plan"), "guildmaster");
  assert.equal(roleForAgentType("claude-code-guide"), "pathfinder");
  assert.equal(roleForAgentType("statusline-setup"), "interface-weaver");
  // Case/casing and separator variants must resolve the same way.
  assert.equal(roleForAgentType("General_Purpose"), "archivist");
  assert.equal(roleForAgentType("STATUSLINE SETUP"), "interface-weaver");
  // A genuinely unclassified custom type must still fall back to archivist.
  assert.equal(roleForAgentType("unclassified-specialist"), "archivist");
});

test("resolveAgentRole/isAmbiguousAgentType distinguish confident matches from the low-confidence archivist default", () => {
  // Confident matches: all five Claude Code builtin roles.
  assert.deepEqual(resolveAgentRole("general-purpose"), { role: "archivist", matched: true });
  assert.deepEqual(resolveAgentRole("explore"), { role: "archivist", matched: true });
  assert.deepEqual(resolveAgentRole("plan"), { role: "guildmaster", matched: true });
  assert.deepEqual(resolveAgentRole("claude-code-guide"), { role: "pathfinder", matched: true });
  assert.deepEqual(resolveAgentRole("statusline-setup"), { role: "interface-weaver", matched: true });
  for (const type of ["general-purpose", "explore", "plan", "claude-code-guide", "statusline-setup"]) {
    assert.equal(isAmbiguousAgentType(type), false, `${type} should not be ambiguous`);
  }
  // Confident match: a role-id substring.
  assert.deepEqual(resolveAgentRole("prover_build"), { role: "prover", matched: true });
  assert.equal(isAmbiguousAgentType("prover_build"), false);
  // Confident match: a research/technical/news keyword.
  assert.deepEqual(resolveAgentRole("technical-research"), { role: "pathfinder", matched: true });
  assert.equal(isAmbiguousAgentType("technical-research"), false);
  assert.deepEqual(resolveAgentRole("breaking-news-scan"), { role: "courier", matched: true });
  assert.equal(isAmbiguousAgentType("breaking-news-scan"), false);
  // Ambiguous: the generic "claude" catch-all, an unrecognized custom type,
  // and empty/undefined input all fall through to the unconditional default.
  assert.deepEqual(resolveAgentRole("claude"), { role: "archivist", matched: false });
  assert.deepEqual(resolveAgentRole("unknown-thing"), { role: "archivist", matched: false });
  assert.deepEqual(resolveAgentRole(""), { role: "archivist", matched: false });
  assert.deepEqual(resolveAgentRole(undefined), { role: "archivist", matched: false });
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
  assert.deepEqual(lifecycleStoragePaths(), {
    root: DEFAULT_STORAGE_ROOT,
    stateDirectory: path.join(DEFAULT_STORAGE_ROOT, "sessions"),
    logDirectory: path.join(DEFAULT_STORAGE_ROOT, "logs"),
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
