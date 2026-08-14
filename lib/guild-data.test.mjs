import assert from "node:assert/strict";
import test from "node:test";
import { AGENTS, AGENT_IDS } from "./guild-data.ts";

const COMPANY_ROLE_NAMES = {
  herald: "Business Analyst",
  guildmaster: "Program Manager",
  steward: "Operations Coordinator",
  pathfinder: "Technical Researcher",
  courier: "Market Intelligence Analyst",
  archivist: "Systems Analyst",
  genealogist: "Change Management Analyst",
  hookwright: "Platform Engineer",
  "interface-weaver": "Frontend Engineer",
  ledgerkeeper: "Data Engineer",
  prover: "QA Engineer",
  chronicler: "Technical Writer",
  counselor: "Strategy Consultant",
  assayer: "Compliance Reviewer",
};

test("company role titles map one-to-one to stable lifecycle agent IDs", () => {
  assert.equal(AGENTS.length, AGENT_IDS.length);
  assert.deepEqual(new Set(AGENTS.map((agent) => agent.id)), new Set(AGENT_IDS));
  assert.equal(new Set(AGENTS.map((agent) => agent.name)).size, AGENTS.length);
  assert.deepEqual(
    Object.fromEntries(AGENTS.map((agent) => [agent.id, agent.name])),
    COMPANY_ROLE_NAMES,
  );
});
