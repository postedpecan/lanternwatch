import type { AgentId, RoomStatus } from "@/lib/guild-data";
import type { HookLogStatus } from "@/lib/guild-health";

export type GuildProject = {
  id: string;
  name: string;
  path: string;
  lastSeenAt: string;
};

export type GuildRun = {
  id: string;
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
  agent: AgentId;
  status: RoomStatus;
  message: string;
  quest: string | null;
  from: AgentId | null;
  occurredAt: string;
  elapsedSeconds: number;
  agentInstanceId: string | null;
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
  mostUsedAgent: AgentId | null;
  mostUsedAgentRuns: number;
};

export type DashboardPayload = {
  projects: GuildProject[];
  selectedProjectId: string | null;
  run: GuildRun | null;
  runs: GuildRun[];
  events: StoredGuildEvent[];
  agentRunCounts: Record<AgentId, number>;
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
};

export type IncomingGuildEvent = {
  eventId?: string;
  projectPath?: string;
  projectName?: string;
  runId?: string;
  agent?: string;
  status?: string;
  message?: string;
  quest?: string;
  from?: string;
  occurredAt?: string;
  runComplete?: boolean;
  heartbeat?: boolean;
  agentInstanceId?: string;
};
