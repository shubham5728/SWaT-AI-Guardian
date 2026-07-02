/**
 * ============================================================================
 *  SWaT AI Guardian — Frontend ⇄ Backend data contract
 * ============================================================================
 *
 * This file is the single source of truth for the wire protocol between the
 * React UI and the streaming backend. It is modelled directly on the original
 * Streamlit pipeline so a thin FastAPI/WebSocket shim can produce it 1:1:
 *
 *   - `Tick`              ← AnomalyDetector.predict() + the raw sensor record
 *   - `SystemState`       ← utils.get_system_state() (models/system_state.json)
 *   - `Incident`          ← st.session_state.incidents[*]
 *   - `EventLogEntry`     ← st.session_state.event_log[*]
 *
 * The backend pushes `ServerMessage`s over the socket; the UI sends
 * `ClientCommand`s back (replacing the Streamlit Control Center widgets).
 */

// ---------------------------------------------------------------------------
// Enums / unions
// ---------------------------------------------------------------------------

export type DataMode = "Normal" | "Attack";

/** Maps to the threshold multiplier the Streamlit sidebar applied. */
export type Sensitivity = "Conservative" | "Balanced" | "Aggressive";

export const SENSITIVITY_MULTIPLIER: Record<Sensitivity, number> = {
  Conservative: 2.0,
  Balanced: 1.0,
  Aggressive: 0.5,
};

/** Derived severity buckets (see utils/severity.ts for the risk thresholds). */
export type Severity = "NORMAL" | "MEDIUM" | "HIGH" | "CRITICAL";

export type IncidentStatus = "New" | "Ongoing" | "Acknowledged" | "Resolved" | "Archived";
export type IncidentTrend = "Increasing" | "Decreasing" | "Stable";

export type StreamHealth = "ACTIVE" | "LOST";
export type TransportStatus = "connecting" | "open" | "closed" | "error";
export type BackendMode = "KAFKA" | "SIMULATION" | "OFFLINE";

// ---------------------------------------------------------------------------
// Core records
// ---------------------------------------------------------------------------

/** One scored sensor frame — the atom of the live stream. */
export interface Tick {
  /** Server epoch seconds. */
  ts: number;
  /** "HH:MM:SS" convenience label (backend may omit; UI derives from ts). */
  time?: string;
  /** Autoencoder reconstruction error (raw model output). */
  mse: number;
  /** Active threshold the backend compared against (ae_threshold × multiplier). */
  threshold: number;
  /** Autoencoder verdict (mse > threshold). */
  isAnomaly: boolean;
  /** Isolation Forest verdict (iso_score < iso_threshold). */
  isIso: boolean;
  /** Isolation Forest decision_function score. */
  isoScore: number;
  /** Ground-truth label from the dataset when streaming CSV ("Normal"/"Attack"/"Unknown"). */
  label: string;
  /** Per-sensor anomaly contribution (|scaled value|), sensor → impact score. */
  topFeatures: Record<string, number>;
  /** Numeric raw sensor readings for this frame (FIT101, LIT101, P102, ...). */
  sensors: Record<string, number>;
  /** Model inference time for this frame, in milliseconds. */
  latencyMs?: number;
}

/** Global run state — mirrors models/system_state.json. */
export interface SystemState {
  runSystem: boolean;
  simulationSpeed: number;
  dataMode: DataMode;
  sensitivity: Sensitivity;
  /** Whether the backend is consuming real Kafka or replaying CSV. */
  backendMode: BackendMode;
  lastUpdated: string;
}

/** Aggregated, de-duplicated incident (one row in the Incident Feed). */
export interface Incident {
  id: string;
  type: string; // e.g. "CRITICAL ALERT", "PERSISTENT TE"
  component: string; // top contributing sensor, e.g. "LIT101"
  severity: Severity;
  status: IncidentStatus;
  trend: IncidentTrend;
  occurrences: number;
  startTime: number; // epoch seconds (first detection)
  lastSeen: number; // epoch seconds (most recent detection)
  riskHistory: number[];
  // --- lifecycle ---
  createdAt: number; // epoch seconds
  acknowledgedAt: number | null;
  resolvedAt: number | null;
  acknowledgedBy: string | null;
  resolutionReason: string | null;
}

/**
 * Live confusion matrix — the backend compares each frame's ALERT decision
 * (severity != NORMAL) against the dataset ground-truth label.
 */
export interface EvalMetrics {
  tp: number; // alerted & actually attack
  fp: number; // alerted & actually normal
  fn: number; // not alerted & actually attack
  tn: number; // not alerted & actually normal
}

/** Static model/pipeline metadata (set once at backend load). */
export interface ModelMeta {
  model: string; // e.g. "Autoencoder + Isolation Forest"
  pcaComponents: number;
  aeThreshold: number; // base (Balanced) AE threshold
}

/** One row of the Security Event Log table. */
export interface EventLogEntry {
  ts: number;
  time: string;
  type: Severity;
  score: string; // formatted mse, e.g. "0.004213"
  limit: string; // formatted threshold
  label: string;
  component: string;
}

// ---------------------------------------------------------------------------
// Server → Client messages
// ---------------------------------------------------------------------------

export interface TickMessage {
  type: "tick";
  payload: Tick;
}

export interface StateMessage {
  type: "state";
  payload: SystemState;
}

export interface IncidentsMessage {
  type: "incidents";
  payload: Incident[];
}

export interface LogMessage {
  type: "log";
  payload: EventLogEntry[];
}

export interface MetricsMessage {
  type: "metrics";
  payload: EvalMetrics;
}

/** Optional batched message to hydrate the UI on (re)connect. */
export interface SnapshotMessage {
  type: "snapshot";
  payload: {
    state: SystemState;
    ticks: Tick[];
    incidents: Incident[];
    log: EventLogEntry[];
    metrics: EvalMetrics;
    meta: ModelMeta | null;
  };
}

export type ServerMessage =
  | TickMessage
  | StateMessage
  | IncidentsMessage
  | LogMessage
  | MetricsMessage
  | SnapshotMessage;

// ---------------------------------------------------------------------------
// Client → Server commands (replace the Streamlit Control Center)
// ---------------------------------------------------------------------------

export type ClientCommand =
  | { type: "setMode"; mode: DataMode }
  | { type: "setSensitivity"; sensitivity: Sensitivity }
  | { type: "setSpeed"; speed: number }
  | { type: "setRun"; run: boolean }
  | { type: "reset" }
  | { type: "acknowledgeIncident"; id: string }
  | { type: "resolveIncident"; id: string; reason?: string };
