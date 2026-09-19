export const AGENT_IDS = [
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
] as const;

export type AgentId = (typeof AGENT_IDS)[number];
export const LEGACY_AGENT_IDS = {
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
} as const satisfies Record<string, AgentId>;

export function canonicalAgentId(value: unknown): AgentId | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/[\s_]+/g, "-");
  if ((AGENT_IDS as readonly string[]).includes(normalized)) return normalized as AgentId;
  return LEGACY_AGENT_IDS[normalized as keyof typeof LEGACY_AGENT_IDS] ?? null;
}

export type RoomStatus = "waiting" | "queued" | "working" | "complete" | "interrupted" | "stalled";

export type Agent = {
  id: AgentId;
  name: string;
  specialty: string;
  sigil: string;
  tool: string;
  cloak: string;
};

export type GuildStep = {
  id: string;
  label: string;
  agentLabel: string;
  agents: AgentId[];
  from?: AgentId[];
  parallel?: boolean;
  detail: string;
};

export type GuildEvent = {
  agent: string;
  agentInstanceId?: string;
  status?: RoomStatus;
  message?: string;
  from?: string;
  quest?: string;
};

export const AGENTS: Agent[] = [
  { id: "technical-researcher", name: "Technical Researcher", specialty: "Technical evidence", sigil: "TR", tool: "Research brief", cloak: "#2f6f68" },
  { id: "market-intelligence-analyst", name: "Market Intelligence Analyst", specialty: "Markets & current events", sigil: "MI", tool: "Market brief", cloak: "#8a4b45" },
  { id: "systems-analyst", name: "Systems Analyst", specialty: "System behavior", sigil: "SA", tool: "System map", cloak: "#45567b" },
  { id: "change-management-analyst", name: "Change Management Analyst", specialty: "Change history", sigil: "CM", tool: "Change log", cloak: "#5f586f" },
  { id: "platform-engineer", name: "Platform Engineer", specialty: "Hooks & lifecycle", sigil: "PE", tool: "Pipeline", cloak: "#6b5b32" },
  { id: "frontend-engineer", name: "Frontend Engineer", specialty: "Interface & accessibility", sigil: "FE", tool: "Component library", cloak: "#3f6870" },
  { id: "data-engineer", name: "Data Engineer", specialty: "Data & exports", sigil: "DE", tool: "Database", cloak: "#59683f" },
  { id: "qa-engineer", name: "QA Engineer", specialty: "Tests & builds", sigil: "QA", tool: "Test suite", cloak: "#7a4e3d" },
  { id: "technical-writer", name: "Technical Writer", specialty: "Full report", sigil: "TW", tool: "Report", cloak: "#744d6f" },
  { id: "business-analyst", name: "Business Analyst", specialty: "Requirements & clarity", sigil: "BA", tool: "Project brief", cloak: "#6e493b" },
  { id: "program-manager", name: "Program Manager", specialty: "Planning & coordination", sigil: "PM", tool: "Roadmap", cloak: "#84632f" },
  { id: "operations-coordinator", name: "Operations Coordinator", specialty: "Progress & dependencies", sigil: "OC", tool: "Task board", cloak: "#4b6652" },
  { id: "strategy-consultant", name: "Strategy Consultant", specialty: "Decision guidance", sigil: "SC", tool: "Decision memo", cloak: "#3f6671" },
  { id: "compliance-reviewer", name: "Compliance Reviewer", specialty: "Quality & evidence", sigil: "CR", tool: "Review checklist", cloak: "#755234" },
];

export const STEPS: GuildStep[] = [
  {
    id: "clarify",
    label: "Review the request",
    agentLabel: "Business Analyst",
    agents: ["business-analyst"],
    detail: "Checks the request for missing requirements and confirms what the project needs to deliver.",
  },
  {
    id: "dispatch",
    label: "Plan the project",
    agentLabel: "Program Manager",
    agents: ["program-manager"],
    from: ["business-analyst"],
    detail: "Breaks the request into precise tasks and assigns only the specialists the project needs.",
  },
  {
    id: "track",
    label: "Open the task board",
    agentLabel: "Operations Coordinator",
    agents: ["operations-coordinator"],
    from: ["program-manager"],
    detail: "Adds tasks to the board, tracks their dependencies, and watches for a stall.",
  },
  {
    id: "research",
    label: "Research in parallel",
    agentLabel: "Technical Researcher + Market Intelligence Analyst + Systems Analyst + Change Management Analyst",
    agents: ["technical-researcher", "market-intelligence-analyst", "systems-analyst", "change-management-analyst"],
    from: ["program-manager", "operations-coordinator", "program-manager", "operations-coordinator"],
    parallel: true,
    detail: "Technical facts, current events, current code, and project history are checked in parallel by the right specialists.",
  },
  {
    id: "implement",
    label: "Build in parallel",
    agentLabel: "Platform Engineer + Frontend Engineer + Data Engineer",
    agents: ["platform-engineer", "frontend-engineer", "data-engineer"],
    from: ["systems-analyst", "systems-analyst", "systems-analyst"],
    parallel: true,
    detail: "Lifecycle infrastructure, interface work, and persistence changes are implemented by their owning specialists.",
  },
  {
    id: "prove",
    label: "Prove the implementation",
    agentLabel: "QA Engineer",
    agents: ["qa-engineer"],
    from: ["platform-engineer", "frontend-engineer", "data-engineer"],
    detail: "Runs automated tests, lifecycle simulations, regression checks, builds, and live interface verification.",
  },
  {
    id: "synthesize",
    label: "Shape the findings",
    agentLabel: "Technical Writer + Strategy Consultant",
    agents: ["technical-writer", "strategy-consultant"],
    from: ["technical-researcher", "systems-analyst"],
    parallel: true,
    detail: "The Technical Writer prepares the full report while the Strategy Consultant shapes an action-ready recommendation.",
  },
  {
    id: "verify",
    label: "Review and deliver",
    agentLabel: "Compliance Reviewer",
    agents: ["compliance-reviewer"],
    from: ["technical-writer", "strategy-consultant"],
    detail: "Reviews completeness and evidence, approves the final report, and releases it to the requester.",
  },
];

export const DEFAULT_QUEST =
  "Research our current AI workflow, inspect the project, and recommend the clearest redesign.";
