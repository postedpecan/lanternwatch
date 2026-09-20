"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AGENTS,
  AGENT_IDS,
  canonicalAgentId,
  DEFAULT_QUEST,
  STEPS,
  type AgentId,
  type GuildEvent,
  type RoomStatus,
} from "@/lib/guild-data";
import type {
  AgentMetric,
  DashboardPayload,
  CatalogAgent,
  CatalogSettings,
  GuildAgentActivity,
  GuildProject,
  GuildRun,
  GuildStorageHealth,
  GuildStatistics,
  StoredGuildEvent,
} from "@/lib/guild-contract";
import { DEFAULT_APPEARANCE, applyPalette, loadAppearance } from "@/lib/appearance";
import { titleCase } from "@/lib/guild-format";

// This provider owns every piece of state that must stay consistent between
// the live view (`/`) and the history view (`/history`): the live reducer
// that drives the agent-room visualization, the polling loop against the
// local API, project/run selection, and the theme. It is mounted once in the
// root layout so navigating between routes never resets or duplicates it.

export type TimelineStatus = "waiting" | "active" | "done";
export type Theme = "light" | "dark";
export type DataMode = "live" | "demo";

const THEME_STORAGE_KEY = "lanternwatch-theme";

const emptyStatistics: GuildStatistics = {
  totalRuns: 0, completedRuns: 0, interruptedRuns: 0, activeRuns: 0,
  stalledRuns: 0, completionRate: 0, averageDurationSeconds: 0,
  totalRuntimeSeconds: 0, mostUsedAgent: null, mostUsedAgentRuns: 0,
};

export type LogEntry = {
  id: number;
  time: number;
  agent: string;
  message: string;
};

export type AgentTiming = {
  startedAt: number | null;
  duration: number;
};

export type GuildState = {
  quest: string;
  running: boolean;
  paused: boolean;
  delivered: boolean;
  currentStep: number;
  elapsed: number;
  roomStatuses: Record<string, RoomStatus>;
  agentTimings: Record<string, AgentTiming>;
  timelineStatuses: TimelineStatus[];
  timelineTimes: Array<number | null>;
  detail: { title: string; text: string; tag: string };
  logs: LogEntry[];
  activeInstances: Record<string, string>;
};

type Action =
  | { type: "RESET"; quest: string }
  | { type: "STEP"; index: number; elapsed: number }
  | { type: "DELIVERY"; elapsed: number }
  | { type: "FINISH"; elapsed: number }
  | { type: "PAUSE"; paused: boolean }
  | { type: "TICK"; elapsed: number }
  | { type: "HYDRATE"; payload: DashboardPayload }
  | { type: "EXTERNAL"; event: GuildEvent; index: number; elapsed: number };

type GuildApi = {
  agents: AgentId[];
  push: (event: Omit<GuildEvent, "agent" | "from"> & { agent: string; from?: string }) => boolean;
  start: (quest?: string) => void;
};

declare global {
  interface Window {
    guildHall?: GuildApi;
  }
}

const waitingRooms = (): Record<string, RoomStatus> =>
  Object.fromEntries(AGENT_IDS.map((id) => [id, "waiting"]));

const emptyAgentTimings = (): Record<string, AgentTiming> =>
  Object.fromEntries(
    AGENT_IDS.map((id) => [id, { startedAt: null, duration: 0 }]),
  );

// Demo walkthrough timing. Kept as the single source of truth for how long
// each simulated step takes, so the live view's ETA can be computed exactly
// from the same numbers the simulation actually sleeps on, instead of a
// separate guess.
function demoStepDurationMs(index: number) {
  return index === 3 ? 2300 : 1750;
}
const DEMO_DELIVERY_PAUSE_MS = 350;
export const DEMO_TOTAL_DURATION_SECONDS = Math.round(
  (STEPS.reduce((total: number, _step, index) => total + demoStepDurationMs(index), 0) + DEMO_DELIVERY_PAUSE_MS) / 1000,
);

const initialState: GuildState = {
  quest: "",
  running: false,
  paused: false,
  delivered: false,
  currentStep: -1,
  elapsed: 0,
  roomStatuses: waitingRooms(),
  agentTimings: emptyAgentTimings(),
  timelineStatuses: STEPS.map(() => "waiting"),
  timelineTimes: STEPS.map(() => null),
  detail: {
    title: "Team at rest",
    text: "Start a project task to see each role’s status, runtime, and handoff in real time.",
    tag: "Ready",
  },
  logs: [],
  activeInstances: {},
};

function addLog(state: GuildState, agent: string, message: string, elapsed: number): LogEntry[] {
  return [...state.logs, { id: state.logs.length + 1, time: elapsed, agent, message }];
}

function transitionTimings(
  state: GuildState,
  nextStatuses: Record<string, RoomStatus>,
  elapsed: number,
) {
  return Object.fromEntries(
    AGENT_IDS.map((id) => {
      const previousStatus = state.roomStatuses[id];
      const nextStatus = nextStatuses[id];
      const timing = state.agentTimings[id] ?? { startedAt: null, duration: 0 };

      if (nextStatus === "working" && previousStatus !== "working") {
        return [id, { startedAt: elapsed, duration: timing.duration }];
      }

      if (previousStatus === "working" && nextStatus !== "working" && timing.startedAt !== null) {
        return [id, { startedAt: null, duration: timing.duration + elapsed - timing.startedAt }];
      }

      return [id, timing];
    }),
  );
}

function reducer(state: GuildState, action: Action): GuildState {
  switch (action.type) {
    case "HYDRATE":
      return hydrateState(action.payload);
    case "RESET":
      return {
        ...initialState,
        quest: action.quest,
        running: true,
        roomStatuses: waitingRooms(),
        agentTimings: emptyAgentTimings(),
        timelineStatuses: STEPS.map(() => "waiting"),
        timelineTimes: STEPS.map(() => null),
        detail: {
          title: "Business Analyst",
          text: "The Business Analyst is reviewing your project task…",
          tag: "Starting",
        },
      };
    case "STEP": {
      const step = STEPS[action.index];
      const completedAgents = new Set(STEPS.slice(0, action.index).flatMap((item) => item.agents));
      const roomStatuses = waitingRooms();
      completedAgents.forEach((id) => (roomStatuses[id] = "complete"));
      step.agents.forEach((id) => (roomStatuses[id] = "working"));
      const timelineStatuses = STEPS.map<TimelineStatus>((_, index) =>
        index < action.index ? "done" : index === action.index ? "active" : "waiting",
      );
      const timelineTimes = [...state.timelineTimes];
      timelineTimes[action.index] = action.elapsed;
      return {
        ...state,
        currentStep: action.index,
        roomStatuses,
        agentTimings: transitionTimings(state, roomStatuses, action.elapsed),
        timelineStatuses,
        timelineTimes,
        detail: { title: step.agentLabel, text: step.detail, tag: step.parallel ? "Parallel" : "Working" },
        logs: addLog(state, step.agentLabel, step.detail, action.elapsed),
      };
    }
    case "DELIVERY": {
      const roomStatuses = { ...state.roomStatuses, "compliance-reviewer": "complete" as RoomStatus };
      return {
        ...state,
        roomStatuses,
        agentTimings: transitionTimings(state, roomStatuses, action.elapsed),
        detail: {
          title: "Delivery",
          text: "The checked answer is ready for you.",
          tag: "Delivering",
        },
      };
    }
    case "FINISH": {
      const roomStatuses = { ...state.roomStatuses, "compliance-reviewer": "complete" as RoomStatus };
      return {
        ...state,
        running: false,
        paused: false,
        delivered: true,
        elapsed: action.elapsed,
        roomStatuses,
        agentTimings: transitionTimings(state, roomStatuses, action.elapsed),
        timelineStatuses: STEPS.map(() => "done"),
        detail: {
          title: "Delivery",
          text: "The final report has been delivered to the requester.",
          tag: "Delivered",
        },
        logs: addLog(state, "Delivery", "The final report has been delivered to the requester.", action.elapsed),
      };
    }
    case "PAUSE":
      return { ...state, paused: action.paused };
    case "TICK":
      return { ...state, elapsed: action.elapsed };
    case "EXTERNAL": {
      const eventStatus = action.event.status ?? "working";
      const activeInstances = { ...state.activeInstances };
      if (action.event.agentInstanceId) {
        if (eventStatus === "working") activeInstances[action.event.agentInstanceId] = action.event.agent;
        else delete activeInstances[action.event.agentInstanceId];
      }
      const roleStillActive = Object.values(activeInstances).includes(action.event.agent);
      const effectiveStatus = roleStillActive ? "working" : eventStatus;
      const timelineStatuses = [...state.timelineStatuses];
      if (action.index >= 0) {
        for (let index = 0; index < action.index; index += 1) timelineStatuses[index] = "done";
        timelineStatuses[action.index] = effectiveStatus === "complete" ? "done" : "active";
      }
      const agentName = AGENTS.find((agent) => agent.id === action.event.agent)?.name ?? titleCase(action.event.agent);
      const message = action.event.message ?? `${agentName} changed state to ${eventStatus}.`;
      const roomStatuses = { ...state.roomStatuses, [action.event.agent]: effectiveStatus };
      const hasActiveWork = Object.values(roomStatuses).some(
        (status) => status === "working" || status === "queued",
      );
      return {
        ...state,
        quest: action.event.quest ?? state.quest,
        running: hasActiveWork,
        delivered: action.event.agent === "compliance-reviewer" && eventStatus === "complete",
        currentStep: Math.max(state.currentStep, action.index),
        roomStatuses,
        agentTimings: transitionTimings(state, roomStatuses, action.elapsed),
        timelineStatuses,
        detail: { title: agentName, text: message, tag: titleCase(eventStatus) },
        logs: addLog(state, agentName, message, action.elapsed),
        activeInstances,
      };
    }
  }
}

function hydrateState(payload: DashboardPayload): GuildState {
  if (!payload.run) return initialState;
  let hydrated: GuildState = {
    ...initialState,
    quest: payload.run.quest,
    running: payload.run.status === "working",
  };
  for (const storedEvent of payload.events) {
    const event: GuildEvent = {
      agent: storedEvent.agent,
      status: storedEvent.status,
      message: storedEvent.message,
      quest: storedEvent.quest ?? undefined,
      from: storedEvent.from ?? undefined,
      agentInstanceId: storedEvent.agentInstanceId ?? undefined,
    };
    const index = STEPS.findIndex((step) => step.agents.includes(event.agent as AgentId));
    hydrated = reducer(hydrated, {
      type: "EXTERNAL",
      event,
      index,
      elapsed: storedEvent.elapsedSeconds,
    });
  }
  const terminalRoomStatus = payload.run.status === "complete"
    ? "complete"
    : payload.run.status === "interrupted"
      ? "interrupted"
      : payload.run.status === "stalled"
        ? "stalled"
        : null;
  const roomStatuses = terminalRoomStatus
    ? Object.fromEntries(Object.entries(hydrated.roomStatuses).map(([id, status]) => [id, status === "working" || status === "queued" ? terminalRoomStatus : status])) as Record<AgentId, RoomStatus>
    : hydrated.roomStatuses;
  return {
    ...hydrated,
    elapsed: payload.run.durationSeconds,
    roomStatuses,
    running: payload.run.status === "working",
    delivered: payload.run.status === "complete",
    paused: false,
  };
}

export function runtimeFor(state: GuildState, id: AgentId) {
  const timing = state.agentTimings[id] ?? { startedAt: null, duration: 0 };
  if (state.roomStatuses[id] === "working" && timing.startedAt !== null) {
    return timing.duration + state.elapsed - timing.startedAt;
  }
  return timing.duration;
}

type GuildDataContextValue = {
  hydrated: boolean;
  theme: Theme;
  toggleTheme: () => void;
  mode: DataMode;
  draft: string;
  setDraft: (value: string) => void;
  projects: GuildProject[];
  selectedProjectId: string;
  selectProject: (projectId: string) => void;
  savedRuns: GuildRun[];
  selectedRunId: string;
  selectRun: (runId: string) => void;
  followLive: () => void;
  currentRun: GuildRun | null;
  currentEvents: StoredGuildEvent[];
  recentEvents: StoredGuildEvent[];
  agentActivities: GuildAgentActivity[];
  statistics: GuildStatistics;
  agentRunCounts: Record<string, number>;
  agentMetrics: Record<string, AgentMetric>;
  agentCatalog: CatalogAgent[];
  agentCatalogSettings: CatalogSettings;
  agentWorkspacePaths: string[];
  storageConnected: boolean;
  healthApiConnected: boolean;
  storageHealth: GuildStorageHealth | null;
  state: GuildState;
  startCommission: (quest?: string) => void;
  handlePause: () => void;
  liveStatus: { live: boolean; text: string };
};

const GuildDataContext = createContext<GuildDataContextValue | null>(null);

export function useGuildData() {
  const context = useContext(GuildDataContext);
  if (!context) throw new Error("useGuildData must be used within GuildDataProvider");
  return context;
}

export function GuildDataProvider({ children }: { children: ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  const [state, dispatch] = useReducer(reducer, initialState);
  const [draft, setDraft] = useState(DEFAULT_QUEST);
  const [theme, setTheme] = useState<Theme>("dark");
  const [mode, setMode] = useState<DataMode>("live");
  const [projects, setProjects] = useState<GuildProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [savedRuns, setSavedRuns] = useState<GuildRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState("");
  const [currentRun, setCurrentRun] = useState<GuildRun | null>(null);
  const [currentEvents, setCurrentEvents] = useState<StoredGuildEvent[]>([]);
  const [recentEvents, setRecentEvents] = useState<StoredGuildEvent[]>([]);
  const [agentActivities, setAgentActivities] = useState<GuildAgentActivity[]>([]);
  const [statistics, setStatistics] = useState<GuildStatistics>(emptyStatistics);
  const [agentRunCounts, setAgentRunCounts] = useState<Record<string, number>>(
    () => Object.fromEntries(AGENT_IDS.map((agent) => [agent, 0])) as Record<AgentId, number>,
  );
  const [agentMetrics, setAgentMetrics] = useState<Record<string, AgentMetric>>({});
  const [agentCatalog, setAgentCatalog] = useState<CatalogAgent[]>([]);
  const [agentCatalogSettings, setAgentCatalogSettings] = useState<CatalogSettings>({ discoveryMode: "manual", collisionPolicy: "rename", lastScannedAt: null });
  const [agentWorkspacePaths, setAgentWorkspacePaths] = useState<string[]>([]);
  const [storageConnected, setStorageConnected] = useState(false);
  const [healthApiConnected, setHealthApiConnected] = useState(false);
  const [storageHealth, setStorageHealth] = useState<GuildStorageHealth | null>(null);
  const runIdRef = useRef(0);
  const pausedRef = useRef(false);
  const elapsedRef = useRef(0);

  useEffect(() => () => {
    runIdRef.current += 1;
  }, []);

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
  }, []);

  useEffect(() => {
    if (mode !== "live") return;
    let cancelled = false;
    let timer: number | undefined;
    const controller = new AbortController();
    const syncDashboard = async () => {
      const params = new URLSearchParams();
      if (selectedProjectId) params.set("projectId", selectedProjectId);
      if (selectedRunId) params.set("runId", selectedRunId);
      const query = params.size ? `?${params.toString()}` : "";
      const loadDashboard = async () => {
        const response = await fetch(`/api/guild/dashboard${query}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error(`Dashboard API returned ${response.status}`);
        return response.json() as Promise<DashboardPayload>;
      };
      const loadHealth = async () => {
        const response = await fetch("/api/guild/health", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error(`Health API returned ${response.status}`);
        return response.json() as Promise<GuildStorageHealth>;
      };

      try {
        const [dashboardResult, healthResult] = await Promise.allSettled([loadDashboard(), loadHealth()]);
        if (cancelled) return;

        if (dashboardResult.status === "fulfilled") {
          const payload = dashboardResult.value;
          setProjects(payload.projects);
          setSavedRuns(payload.runs);
          setCurrentRun(payload.run);
          setCurrentEvents(payload.events);
          setRecentEvents(payload.recentEvents);
          setAgentActivities(payload.agentActivities);
          setStatistics(payload.statistics);
          setAgentRunCounts(payload.agentRunCounts);
          setAgentMetrics(payload.agentMetrics);
          setAgentCatalog(payload.agentCatalog);
          setAgentCatalogSettings(payload.agentCatalogSettings);
          setAgentWorkspacePaths(payload.agentWorkspacePaths);
          setStorageConnected(true);
          if (selectedProjectId && !payload.projects.some((project) => project.id === selectedProjectId)) {
            setSelectedProjectId("");
          }
          if (selectedRunId && payload.run?.id !== selectedRunId) {
            setSelectedRunId("");
          }
          elapsedRef.current = payload.run?.durationSeconds ?? 0;
          dispatch({ type: "HYDRATE", payload });
        } else {
          setStorageConnected(false);
        }

        if (healthResult.status === "fulfilled") {
          setStorageHealth(healthResult.value);
          setHealthApiConnected(true);
        } else {
          setHealthApiConnected(false);
        }
      } finally {
        if (!cancelled) timer = window.setTimeout(() => { void syncDashboard(); }, 1500);
      }
    };
    void syncDashboard();
    return () => {
      cancelled = true;
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [mode, selectedProjectId, selectedRunId]);

  useEffect(() => {
    if (!state.running || state.paused) return;
    const timer = window.setInterval(() => {
      elapsedRef.current += 1;
      dispatch({ type: "TICK", elapsed: elapsedRef.current });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [state.running, state.paused]);

  const sleep = useCallback(async (duration: number, runId: number) => {
    let remaining = duration;
    let last = performance.now();
    while (remaining > 0) {
      if (runId !== runIdRef.current) return false;
      await new Promise((resolve) => window.setTimeout(resolve, Math.min(100, remaining)));
      const now = performance.now();
      if (!pausedRef.current) remaining -= now - last;
      last = now;
    }
    return runId === runIdRef.current;
  }, []);

  const startCommission = useCallback(async (quest: string = draft) => {
    const cleanQuest = quest.trim();
    if (!cleanQuest) return;
    setSelectedRunId("");
    setMode("demo");
    runIdRef.current += 1;
    const runId = runIdRef.current;
    elapsedRef.current = 0;
    pausedRef.current = false;
    dispatch({ type: "RESET", quest: cleanQuest });

    for (let index = 0; index < STEPS.length; index += 1) {
      if (runId !== runIdRef.current) return;
      dispatch({ type: "STEP", index, elapsed: elapsedRef.current });
      if (!await sleep(demoStepDurationMs(index), runId)) return;
    }

    dispatch({ type: "DELIVERY", elapsed: elapsedRef.current });
    if (!await sleep(DEMO_DELIVERY_PAUSE_MS, runId)) return;
    dispatch({ type: "FINISH", elapsed: elapsedRef.current });
    if (runId === runIdRef.current) setMode("live");
  }, [draft, sleep]);

  const pushEvent = useCallback((event: Omit<GuildEvent, "agent" | "from"> & { agent: string; from?: string }) => {
    if (!event) return false;
    const agent = canonicalAgentId(event.agent);
    const from = event.from === undefined ? undefined : canonicalAgentId(event.from);
    if (!agent || (event.from !== undefined && !from)) return false;
    const status: RoomStatus = event.status ?? "working";
    if (!["waiting", "queued", "working", "complete", "interrupted", "stalled"].includes(status)) return false;
    runIdRef.current += 1;
    const canonicalEvent: GuildEvent = { ...event, agent, from: from ?? undefined, status };
    const index = STEPS.findIndex((step) => step.agents.includes(agent));
    dispatch({ type: "EXTERNAL", event: canonicalEvent, index, elapsed: elapsedRef.current });
    return true;
  }, []);

  useEffect(() => {
    const api: GuildApi = Object.freeze({
      agents: [...AGENT_IDS],
      push: pushEvent,
      start: (quest = draft) => { void startCommission(quest); },
    });
    window.guildHall = api;
    return () => {
      if (window.guildHall === api) delete window.guildHall;
    };
  }, [draft, pushEvent, startCommission]);

  const handlePause = useCallback(() => {
    if (!state.running) return;
    const paused = !pausedRef.current;
    pausedRef.current = paused;
    dispatch({ type: "PAUSE", paused });
  }, [state.running]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const nextTheme: Theme = current === "light" ? "dark" : "light";
      document.documentElement.dataset.theme = nextTheme;
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
      } catch {
        // The switch still works when browser storage is unavailable.
      }
      let appearance = DEFAULT_APPEARANCE;
      try {
        appearance = loadAppearance(window.localStorage);
      } catch {
        // Keep the default palette when device storage access is blocked.
      }
      applyPalette(document.documentElement.style, appearance.palettes[nextTheme]);
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute("content", appearance.palettes[nextTheme].surface);
      return nextTheme;
    });
  }, []);

  const selectProject = useCallback((projectId: string) => {
    setSelectedProjectId(projectId);
    setSelectedRunId("");
    setMode("live");
  }, []);

  const selectRun = useCallback((runId: string) => {
    setSelectedRunId(runId);
    setMode("live");
  }, []);

  const followLive = useCallback(() => {
    setSelectedRunId("");
  }, []);

  const liveStatus = useMemo(() => {
    if (mode === "live" && selectedRunId) return { live: false, text: "Viewing run history" };
    if (mode === "live" && !storageConnected) return { live: false, text: "Storage offline" };
    if (mode === "live") {
      if (agentActivities.length > 0) {
        return {
          live: true,
          text: `${agentActivities.length} active role${agentActivities.length === 1 ? "" : "s"}`,
        };
      }
      return { live: false, text: "No active roles" };
    }
    if (state.paused) return { live: false, text: "Project task paused" };
    if (state.running) return { live: true, text: "Project task in progress" };
    if (state.delivered) return { live: false, text: "Report delivered" };
    if (Object.values(state.roomStatuses).includes("interrupted")) return { live: false, text: "Project task interrupted" };
    if (Object.values(state.roomStatuses).includes("stalled")) return { live: false, text: "Project task may be stalled" };
    return { live: false, text: "Awaiting a project task" };
  }, [agentActivities.length, mode, selectedRunId, state.delivered, state.paused, state.running, storageConnected, state.roomStatuses]);

  const value: GuildDataContextValue = {
    hydrated,
    theme,
    toggleTheme,
    mode,
    draft,
    setDraft,
    projects,
    selectedProjectId,
    selectProject,
    savedRuns,
    selectedRunId,
    selectRun,
    followLive,
    currentRun,
    currentEvents,
    recentEvents,
    agentActivities,
    statistics,
    agentRunCounts,
    agentMetrics,
    agentCatalog,
    agentCatalogSettings,
    agentWorkspacePaths,
    storageConnected,
    healthApiConnected,
    storageHealth,
    state,
    startCommission: (quest?: string) => { void startCommission(quest); },
    handlePause,
    liveStatus,
  };

  return <GuildDataContext.Provider value={value}>{children}</GuildDataContext.Provider>;
}
