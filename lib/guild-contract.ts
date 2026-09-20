import type { RoomStatus } from "@/lib/guild-data";
import type { HookLogStatus, HookSource } from "@/lib/guild-health";

export type GuildProject = {
  id: string;
  name: string;
  path: string;
  lastSeenAt: string;
};

export type GuildRun = {
  id: string;
  sourceRunId: string;
  projectId: string;
  quest: string;
  status: "working" | "complete" | "interrupted" | "stalled";
  startedAt: string;
  completedAt: string | null;
  updatedAt: string;
  durationSeconds: number;
};

export type StoredGuildEvent = {
  id: number;
  eventId: string;
  projectId: string;
  runId: string;
  agent: string;
  /** Raw host-selected custom-agent identity, retained for exact catalog attribution. */
  agentType: string;
  status: RoomStatus;
  message: string;
  quest: string | null;
  from: string | null;
  occurredAt: string;
  elapsedSeconds: number;
  agentInstanceId: string | null;
  presentation?: AgentPresentation;
};

export type GuildAgentActivity = {
  id: string;
  agentInstanceId: string;
  agent: string;
  /** Raw host-selected custom-agent identity, retained for exact catalog attribution. */
  agentType: string;
  projectId: string;
  projectName: string;
  runId: string;
  status: Extract<RoomStatus, "queued" | "working">;
  message: string;
  startedAt: string;
  updatedAt: string;
  durationSeconds: number;
  presentation?: AgentPresentation;
};

export type CatalogAgent = {
  id: string;
  name: string;
  description: string;
  scope: "global" | "workspace" | "external" | "lanternwatch";
  sourcePath: string;
  enabled: boolean;
  tags: string[];
  collision: boolean;
  readOnly: boolean;
  codexReady: boolean;
  /**
   * Where LanternWatch obtained this definition. `scope` remains the Codex
   * execution scope; origin is deliberately more precise for catalog grouping.
   */
  origin?: "global" | "lanternwatch" | "workspace" | "registered-workspace" | "imported-workspace" | "external";
  workspacePath?: string;
  /** Destinations that are currently free and safe for an explicit copy. */
  copyDestinations?: CatalogCopyDestination[];
};

export type CatalogCopyDestination = {
  scope: "global" | "workspace";
  path: string;
  workspacePath?: string;
};

export type CatalogWorkspaceSnapshot = {
  workspacePath: string;
  agentCount: number;
  importedAt: string;
};

export type CatalogResponse = {
  agents: CatalogAgent[];
  settings: CatalogSettings;
  /** Explicitly registered workspace roots, including roots with no TOMLs. */
  workspacePaths: string[];
  /** Imported workspace roots, including intentionally empty snapshots. */
  workspaceSnapshots: string[];
  workspaceSnapshotMetadata: CatalogWorkspaceSnapshot[];
};

export type CatalogSettings = {
  discoveryMode: "manual" | "automatic-once";
  collisionPolicy: "rename" | "tag" | "disable";
  lastScannedAt: string | null;
};

export type CatalogAction =
  | { action: "scan" }
  | { action: "settings"; settings: Partial<CatalogSettings> }
  | { action: "create"; scope: "global" | "workspace"; workspacePath?: string; name: string; description: string; developerInstructions: string; tags?: string[] }
  | { action: "register"; sourcePath: string }
  | { action: "unregister"; sourcePath: string }
  | { action: "import"; sourcePath: string; scope: "global" | "workspace"; workspacePath?: string }
  | { action: "register-workspace"; workspacePath: string }
  | { action: "unregister-workspace"; workspacePath: string }
  | { action: "import-workspace-snapshot"; workspacePath: string }
  | { action: "remove-workspace-snapshot"; workspacePath: string }
  | { action: "tags"; sourcePath: string; tags: string[] }
  | { action: "toggle"; sourcePath: string; enabled: boolean }
  | { action: "rename"; sourcePath: string; name: string }
  | { action: "resolve-collision"; sourcePath: string; resolution: "tag" | "rename" | "disable"; tags?: string[]; name?: string };

export type AgentMetric = {
  agent: string;
  runCount: number;
  trackedActiveSeconds: number;
  activeInstances: number;
  lastActivityAt: string | null;
  lastActivityMessage: string | null;
};

export type AgentPresentation = {
  scope?: CatalogAgent["scope"];
  tags: string[];
  sourcePath?: string;
  unresolved: boolean;
  candidates?: Array<Pick<CatalogAgent, "scope" | "sourcePath" | "tags">>;
};

export type GuildStatistics = {
  totalRuns: number;
  completedRuns: number;
  interruptedRuns: number;
  activeRuns: number;
  stalledRuns: number;
  completionRate: number;
  averageDurationSeconds: number;
  totalRuntimeSeconds: number;
  mostUsedAgent: string | null;
  mostUsedAgentRuns: number;
};

export type DashboardPayload = {
  projects: GuildProject[];
  selectedProjectId: string | null;
  run: GuildRun | null;
  runs: GuildRun[];
  events: StoredGuildEvent[];
  recentEvents: StoredGuildEvent[];
  agentActivities: GuildAgentActivity[];
  agentRunCounts: Record<string, number>;
  agentMetrics: Record<string, AgentMetric>;
  agentCatalog: CatalogAgent[];
  agentCatalogSettings: CatalogSettings;
  agentWorkspacePaths: string[];
  statistics: GuildStatistics;
  serverTime: string;
};

export type GuildStorageHealth = {
  ok: true;
  databasePath: string;
  vaultPath: string;
  storageRootPath: string;
  hookLogPath: string;
  hookLogStatus: HookLogStatus;
  projectCount: number;
  runCount: number;
  workingRunCount: number;
  eventCount: number;
  latestRunAt: string | null;
  latestRunAgeSeconds: number | null;
  latestEventAt: string | null;
  latestEventAgeSeconds: number | null;
  lastHookReceiptAt: string | null;
  lastHookReceiptAgeSeconds: number | null;
  lastHookEvent: string | null;
  lastHookStage: string | null;
  lastHookSource: HookSource | null;
};

export type IncomingGuildEvent = {
  eventId?: string;
  projectPath?: string;
  projectName?: string;
  runId?: string;
  agent?: string;
  /** Raw host-selected custom-agent identity; `agent` remains the canonical role. */
  agentType?: string;
  status?: string;
  message?: string;
  quest?: string;
  from?: string;
  occurredAt?: string;
  runComplete?: boolean;
  heartbeat?: boolean;
  agentInstanceId?: string;
  source?: HookSource;
};
