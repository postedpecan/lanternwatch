import assert from "node:assert/strict";
import test from "node:test";
import { AGENTS, AGENT_IDS, canonicalAgentId } from "./guild-data.ts";

const COMPANY_ROLE_NAMES = {
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

test("company role titles map one-to-one to title-derived lifecycle agent IDs", () => {
  assert.equal(AGENTS.length, AGENT_IDS.length);
  assert.deepEqual(new Set(AGENTS.map((agent) => agent.id)), new Set(AGENT_IDS));
  assert.equal(new Set(AGENTS.map((agent) => agent.name)).size, AGENTS.length);
  assert.deepEqual(
    Object.fromEntries(AGENTS.map((agent) => [agent.id, agent.name])),
    COMPANY_ROLE_NAMES,
  );
});

test("legacy IDs and visible titles resolve to title-derived IDs", () => {
  assert.equal(canonicalAgentId("guildmaster"), "program-manager");
  assert.equal(canonicalAgentId("Program Manager"), "program-manager");
  assert.equal(canonicalAgentId("interface_weaver"), "frontend-engineer");
  assert.equal(canonicalAgentId("unknown"), null);
});
