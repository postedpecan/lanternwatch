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
  { id: "pathfinder", name: "Pathfinder", specialty: "Technical truth", sigil: "P", tool: "Compass", cloak: "#2f6f68" },
  { id: "courier", name: "Courier", specialty: "Current events", sigil: "C", tool: "Satchel", cloak: "#8a4b45" },
  { id: "archivist", name: "Archivist", specialty: "Current code", sigil: "A", tool: "Book", cloak: "#45567b" },
  { id: "genealogist", name: "Genealogist", specialty: "Project history", sigil: "G", tool: "Scroll", cloak: "#5f586f" },
  { id: "hookwright", name: "Hookwright", specialty: "Hooks & lifecycle", sigil: "H", tool: "Hook key", cloak: "#6b5b32" },
  { id: "interface-weaver", name: "Interface Weaver", specialty: "Interface & access", sigil: "I", tool: "Shuttle", cloak: "#3f6870" },
  { id: "ledgerkeeper", name: "Ledgerkeeper", specialty: "Data & exports", sigil: "L", tool: "Ledger", cloak: "#59683f" },
  { id: "prover", name: "Prover", specialty: "Tests & builds", sigil: "P", tool: "Gauge", cloak: "#7a4e3d" },
  { id: "chronicler", name: "Chronicler", specialty: "Full record", sigil: "C", tool: "Quill", cloak: "#744d6f" },
  { id: "herald", name: "Herald", specialty: "Intent & clarity", sigil: "H", tool: "Bell", cloak: "#6e493b" },
  { id: "guildmaster", name: "Guildmaster", specialty: "Plans & dispatches", sigil: "G", tool: "Seal", cloak: "#84632f" },
  { id: "steward", name: "Steward", specialty: "Progress & dependencies", sigil: "S", tool: "Ledger", cloak: "#4b6652" },
  { id: "counselor", name: "Counselor", specialty: "Decision memo", sigil: "C", tool: "Counsel", cloak: "#3f6671" },
  { id: "assayer", name: "Assayer", specialty: "Quality & evidence", sigil: "A", tool: "Loupe", cloak: "#755234" },
];

export const STEPS: GuildStep[] = [
  {
    id: "clarify",
    label: "Read the commission",
    agentLabel: "Herald",
    agents: ["herald"],
    detail: "Checks the request for missing intent and confirms what the guild is being asked to deliver.",
  },
  {
    id: "dispatch",
    label: "Plan the quest",
    agentLabel: "Guildmaster",
    agents: ["guildmaster"],
    from: ["herald"],
    detail: "Breaks the request into precise writs and calls only the specialists the work actually needs.",
  },
  {
    id: "track",
    label: "Open the workboard",
    agentLabel: "Steward",
    agents: ["steward"],
    from: ["guildmaster"],
    detail: "Pins the writs to the board, tracks their dependencies, and watches for a stall.",
  },
  {
    id: "research",
    label: "Research in parallel",
    agentLabel: "Pathfinder + Courier + Archivist + Genealogist",
    agents: ["pathfinder", "courier", "archivist", "genealogist"],
    from: ["guildmaster", "steward", "guildmaster", "steward"],
    parallel: true,
    detail: "Technical facts, current events, current code, and project history are checked in parallel by the right specialists.",
  },
  {
    id: "implement",
    label: "Build in parallel",
    agentLabel: "Hookwright + Interface Weaver + Ledgerkeeper",
    agents: ["hookwright", "interface-weaver", "ledgerkeeper"],
    from: ["archivist", "archivist", "archivist"],
    parallel: true,
    detail: "Lifecycle infrastructure, interface work, and persistence changes are implemented by their owning specialists.",
  },
  {
    id: "prove",
    label: "Prove the implementation",
    agentLabel: "Prover",
    agents: ["prover"],
    from: ["hookwright", "interface-weaver", "ledgerkeeper"],
    detail: "Runs automated tests, lifecycle simulations, regression checks, builds, and live interface verification.",
  },
  {
    id: "synthesize",
    label: "Shape the findings",
    agentLabel: "Chronicler + Counselor",
    agents: ["chronicler", "counselor"],
    from: ["pathfinder", "archivist"],
    parallel: true,
    detail: "The Chronicler preserves the full record while the Counselor shapes an action-ready recommendation.",
  },
  {
    id: "verify",
    label: "Assay and deliver",
    agentLabel: "Assayer",
    agents: ["assayer"],
    from: ["chronicler", "counselor"],
    detail: "Checks completeness and evidence, applies the final seal, and releases the answer to the patron.",
  },
];

export const DEFAULT_QUEST =
  "Research our current AI workflow, inspect the project, and recommend the clearest redesign.";
