import { create } from "zustand";
import type {
  EvalMetrics,
  EventLogEntry,
  Incident,
  ModelMeta,
  ServerMessage,
  SystemState,
  Tick,
  TransportStatus,
} from "@/types";

const MAX_HISTORY = 120; // rolling window length for the live charts

interface DashboardState {
  // --- live data ---
  ticks: Tick[];
  incidents: Incident[];
  log: EventLogEntry[];
  metrics: EvalMetrics;
  meta: ModelMeta | null;
  system: SystemState;
  transportStatus: TransportStatus;
  lastTickAt: number; // epoch ms of the most recent tick (for lag/freshness)

  // --- UI-only state ---
  selectedIncidentId: string | null;

  // --- reducers ---
  applyServerMessage: (msg: ServerMessage) => void;
  setTransportStatus: (status: TransportStatus) => void;
  selectIncident: (id: string | null) => void;
  reset: () => void;
}

const initialSystem: SystemState = {
  runSystem: true,
  simulationSpeed: 1.0,
  dataMode: "Normal",
  sensitivity: "Balanced",
  backendMode: "OFFLINE",
  lastUpdated: new Date().toISOString(),
};

export const useDashboardStore = create<DashboardState>((set) => ({
  ticks: [],
  incidents: [],
  log: [],
  metrics: { tp: 0, fp: 0, fn: 0, tn: 0 },
  meta: null,
  system: initialSystem,
  transportStatus: "connecting",
  lastTickAt: 0,
  selectedIncidentId: null,

  applyServerMessage: (msg) =>
    set((state) => {
      switch (msg.type) {
        case "tick":
          return {
            ticks: [...state.ticks, msg.payload].slice(-MAX_HISTORY),
            lastTickAt: Date.now(),
          };
        case "incidents":
          return { incidents: msg.payload };
        case "log":
          return { log: msg.payload };
        case "metrics":
          return { metrics: msg.payload };
        case "state":
          return { system: msg.payload };
        case "snapshot":
          return {
            system: msg.payload.state,
            ticks: msg.payload.ticks.slice(-MAX_HISTORY),
            incidents: msg.payload.incidents,
            log: msg.payload.log,
            metrics: msg.payload.metrics,
            meta: msg.payload.meta,
            lastTickAt: msg.payload.ticks.length ? Date.now() : state.lastTickAt,
          };
        default:
          return {};
      }
    }),

  setTransportStatus: (transportStatus) => set({ transportStatus }),
  selectIncident: (selectedIncidentId) => set({ selectedIncidentId }),
  reset: () => set({ ticks: [], incidents: [], log: [], selectedIncidentId: null }),
}));
