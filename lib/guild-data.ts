export const AGENT_IDS = [
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
] as const;

export type AgentId = (typeof AGENT_IDS)[number];
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
  agent: AgentId;
  agentInstanceId?: string;
  status?: RoomStatus;
  message?: string;
  from?: AgentId;
  quest?: string;
};

export const AGENTS: Agent[] = [
  { id: "pathfinder", name: "Technical Researcher", specialty: "Technical evidence", sigil: "TR", tool: "Research brief", cloak: "#2f6f68" },
  { id: "courier", name: "Market Intelligence Analyst", specialty: "Markets & current events", sigil: "MI", tool: "Market brief", cloak: "#8a4b45" },
  { id: "archivist", name: "Systems Analyst", specialty: "System behavior", sigil: "SA", tool: "System map", cloak: "#45567b" },
  { id: "genealogist", name: "Change Management Analyst", specialty: "Change history", sigil: "CM", tool: "Change log", cloak: "#5f586f" },
  { id: "hookwright", name: "Platform Engineer", specialty: "Hooks & lifecycle", sigil: "PE", tool: "Pipeline", cloak: "#6b5b32" },
  { id: "interface-weaver", name: "Frontend Engineer", specialty: "Interface & accessibility", sigil: "FE", tool: "Component library", cloak: "#3f6870" },
  { id: "ledgerkeeper", name: "Data Engineer", specialty: "Data & exports", sigil: "DE", tool: "Database", cloak: "#59683f" },
  { id: "prover", name: "QA Engineer", specialty: "Tests & builds", sigil: "QA", tool: "Test suite", cloak: "#7a4e3d" },
  { id: "chronicler", name: "Technical Writer", specialty: "Full report", sigil: "TW", tool: "Report", cloak: "#744d6f" },
  { id: "herald", name: "Business Analyst", specialty: "Requirements & clarity", sigil: "BA", tool: "Project brief", cloak: "#6e493b" },
  { id: "guildmaster", name: "Program Manager", specialty: "Planning & coordination", sigil: "PM", tool: "Roadmap", cloak: "#84632f" },
  { id: "steward", name: "Operations Coordinator", specialty: "Progress & dependencies", sigil: "OC", tool: "Task board", cloak: "#4b6652" },
  { id: "counselor", name: "Strategy Consultant", specialty: "Decision guidance", sigil: "SC", tool: "Decision memo", cloak: "#3f6671" },
  { id: "assayer", name: "Compliance Reviewer", specialty: "Quality & evidence", sigil: "CR", tool: "Review checklist", cloak: "#755234" },
];

export const STEPS: GuildStep[] = [
  {
    id: "clarify",
    label: "Review the request",
    agentLabel: "Business Analyst",
    agents: ["herald"],
    detail: "Checks the request for missing requirements and confirms what the project needs to deliver.",
  },
  {
    id: "dispatch",
    label: "Plan the project",
    agentLabel: "Program Manager",
    agents: ["guildmaster"],
    from: ["herald"],
    detail: "Breaks the request into precise tasks and assigns only the specialists the project needs.",
  },
  {
    id: "track",
    label: "Open the task board",
    agentLabel: "Operations Coordinator",
    agents: ["steward"],
    from: ["guildmaster"],
    detail: "Adds tasks to the board, tracks their dependencies, and watches for a stall.",
  },
  {
    id: "research",
    label: "Research in parallel",
    agentLabel: "Technical Researcher + Market Intelligence Analyst + Systems Analyst + Change Management Analyst",
    agents: ["pathfinder", "courier", "archivist", "genealogist"],
    from: ["guildmaster", "steward", "guildmaster", "steward"],
    parallel: true,
    detail: "Technical facts, current events, current code, and project history are checked in parallel by the right specialists.",
  },
  {
    id: "implement",
    label: "Build in parallel",
    agentLabel: "Platform Engineer + Frontend Engineer + Data Engineer",
    agents: ["hookwright", "interface-weaver", "ledgerkeeper"],
    from: ["archivist", "archivist", "archivist"],
    parallel: true,
    detail: "Lifecycle infrastructure, interface work, and persistence changes are implemented by their owning specialists.",
  },
  {
    id: "prove",
    label: "Prove the implementation",
    agentLabel: "QA Engineer",
    agents: ["prover"],
    from: ["hookwright", "interface-weaver", "ledgerkeeper"],
    detail: "Runs automated tests, lifecycle simulations, regression checks, builds, and live interface verification.",
  },
  {
    id: "synthesize",
    label: "Shape the findings",
    agentLabel: "Technical Writer + Strategy Consultant",
    agents: ["chronicler", "counselor"],
    from: ["pathfinder", "archivist"],
    parallel: true,
    detail: "The Technical Writer prepares the full report while the Strategy Consultant shapes an action-ready recommendation.",
  },
  {
    id: "verify",
    label: "Review and deliver",
    agentLabel: "Compliance Reviewer",
    agents: ["assayer"],
    from: ["chronicler", "counselor"],
    detail: "Reviews completeness and evidence, approves the final report, and releases it to the requester.",
  },
];

export const DEFAULT_QUEST =
  "Research our current AI workflow, inspect the project, and recommend the clearest redesign.";
