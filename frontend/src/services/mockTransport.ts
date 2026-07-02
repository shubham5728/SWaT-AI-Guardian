import type {
  ClientCommand,
  EventLogEntry,
  Incident,
  ServerMessage,
  SystemState,
  Tick,
  TransportStatus,
} from "@/types";
import { SENSITIVITY_MULTIPLIER } from "@/types";
import { computeRisk, riskToSeverity } from "@/utils/severity";
import { hhmmss } from "@/utils/format";
import { Emitter, type Transport } from "./transport";

const BASE_AE_THRESHOLD = 0.0334; // mirrors models/threshold.json (Release v2.1)
const SENSORS = ["FIT101", "LIT101", "P102", "AIT201", "MV101"] as const;

/**
 * In-browser simulator that emits the exact same `ServerMessage` shapes the real
 * backend would, so the entire UI is exercisable with `VITE_TRANSPORT=mock`.
 * It loosely imitates the SWaT stream: quiet "Normal" mode with occasional
 * spikes, and a noisier "Attack" mode that periodically breaches the threshold.
 */
export class MockTransport implements Transport {
  private readonly messages = new Emitter<ServerMessage>();
  private readonly statuses = new Emitter<TransportStatus>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private t = 0;
  private incidents: Incident[] = [];
  private log: EventLogEntry[] = [];
  private cm = { tp: 0, fp: 0, fn: 0, tn: 0 };

  private state: SystemState = {
    runSystem: true,
    simulationSpeed: 1.0,
    dataMode: "Normal",
    sensitivity: "Balanced",
    backendMode: "SIMULATION",
    lastUpdated: new Date().toISOString(),
  };

  connect(): void {
    this.statuses.emit("connecting");
    // Emit an initial snapshot, then tick.
    setTimeout(() => {
      this.statuses.emit("open");
      this.messages.emit({
        type: "snapshot",
        payload: {
          state: this.state,
          ticks: [],
          incidents: [],
          log: [],
          metrics: { ...this.cm },
          meta: {
            model: "Autoencoder + Isolation Forest (mock)",
            pcaComponents: 15,
            aeThreshold: BASE_AE_THRESHOLD,
          },
        },
      });
      this.schedule();
    }, 150);
  }

  private schedule(): void {
    if (this.timer) clearInterval(this.timer);
    // 1 record/second at 1x (matches the backend / SWaT's 1 Hz cadence).
    const interval = Math.max(100, 1000 / this.state.simulationSpeed);
    this.timer = setInterval(() => this.tick(), interval);
  }

  private threshold(): number {
    return BASE_AE_THRESHOLD * SENSITIVITY_MULTIPLIER[this.state.sensitivity];
  }

  private tick(): void {
    if (!this.state.runSystem) return;
    this.t += 1;
    const threshold = this.threshold();
    const attack = this.state.dataMode === "Attack";

    // Baseline noise + periodic anomaly bursts (stronger/more frequent in Attack).
    const noise = Math.random() * threshold * 0.4;
    const burstPeriod = attack ? 14 : 45;
    const inBurst = this.t % burstPeriod < (attack ? 5 : 2);
    const burst = inBurst
      ? threshold * (attack ? 1.4 + Math.random() * 1.8 : 0.9 + Math.random())
      : 0;
    const mse = Math.max(0.0002, noise + burst);

    const isAnomaly = mse > threshold;
    const isoScore = isAnomaly ? -0.25 - Math.random() * 0.2 : 0.05 + Math.random() * 0.1;
    const isIso = isoScore < -0.2;

    const sensors: Record<string, number> = {};
    for (const s of SENSORS) {
      const wobble = inBurst ? 1 + Math.random() * 0.6 : 1;
      sensors[s] = +(50 + 30 * Math.sin(this.t / 7 + SENSORS.indexOf(s)) * wobble).toFixed(2);
    }

    const topFeatures: Record<string, number> = {};
    if (isAnomaly) {
      const picks = [...SENSORS].sort(() => Math.random() - 0.5).slice(0, 4);
      picks.forEach((s, i) => (topFeatures[s] = +(2.5 - i * 0.5 + Math.random()).toFixed(3)));
    }

    const ts = Date.now() / 1000;
    const tick: Tick = {
      ts,
      time: hhmmss(ts),
      mse,
      threshold,
      isAnomaly,
      isIso,
      isoScore,
      label: isAnomaly && attack ? "Attack" : "Normal",
      topFeatures,
      sensors,
    };
    this.messages.emit({ type: "tick", payload: tick });

    const risk = computeRisk(mse, threshold);
    const severity = riskToSeverity(risk);
    const component = (Object.keys(topFeatures)[0] ?? "System").replace(/_SMA$/, "");

    // Live confusion matrix (alert decision vs label) — mirrors the backend.
    const actualAttack = tick.label === "Attack";
    const predictedAlert = severity !== "NORMAL";
    if (predictedAlert && actualAttack) this.cm.tp += 1;
    else if (predictedAlert) this.cm.fp += 1;
    else if (actualAttack) this.cm.fn += 1;
    else this.cm.tn += 1;
    this.messages.emit({ type: "metrics", payload: { ...this.cm } });

    // Maintain a small event log + aggregated incidents, like the Streamlit loop.
    if (severity !== "NORMAL") {
      this.log.unshift({
        ts,
        time: tick.time!,
        type: severity,
        score: mse.toFixed(6),
        limit: threshold.toFixed(5),
        label: tick.label,
        component,
      });
      this.log = this.log.slice(0, 50);

      const type = `${severity} ALERT`;
      const existing = this.incidents.find(
        (i) =>
          (i.status === "New" || i.status === "Ongoing" || i.status === "Acknowledged") &&
          i.type === type &&
          i.component === component,
      );
      if (existing) {
        existing.occurrences += 1;
        existing.lastSeen = ts;
        existing.riskHistory.push(risk);
        existing.trend =
          risk > existing.riskHistory.at(-2)! ? "Increasing" : "Decreasing";
        if (existing.status === "New" && existing.occurrences >= 3) existing.status = "Ongoing";
      } else {
        this.incidents.unshift({
          id: `${ts}-${component}`,
          type,
          component,
          severity,
          status: "New",
          trend: "Stable",
          occurrences: 1,
          startTime: ts,
          lastSeen: ts,
          createdAt: ts,
          acknowledgedAt: null,
          resolvedAt: null,
          acknowledgedBy: null,
          resolutionReason: null,
          riskHistory: [risk],
        });
      }
    }

    // Lifecycle transitions (mock timings are shorter than the backend's).
    for (const inc of this.incidents) {
      const liveActive =
        inc.status === "New" || inc.status === "Ongoing" || inc.status === "Acknowledged";
      if (liveActive && ts - inc.lastSeen > 30) {
        inc.status = "Resolved";
        inc.resolvedAt = ts;
        inc.resolutionReason = "Auto-resolved (no recurrence)";
      } else if (inc.status === "Resolved" && inc.resolvedAt && ts - inc.resolvedAt > 60) {
        inc.status = "Archived";
      }
    }
    this.incidents = this.incidents.slice(0, 30);

    this.messages.emit({ type: "incidents", payload: this.incidents });
    this.messages.emit({ type: "log", payload: this.log });
  }

  disconnect(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.statuses.emit("closed");
  }

  send(command: ClientCommand): void {
    switch (command.type) {
      case "setMode":
        this.state.dataMode = command.mode;
        break;
      case "setSensitivity":
        this.state.sensitivity = command.sensitivity;
        break;
      case "setSpeed":
        this.state.simulationSpeed = command.speed;
        this.schedule();
        break;
      case "setRun":
        this.state.runSystem = command.run;
        break;
      case "reset":
        this.incidents = [];
        this.log = [];
        this.cm = { tp: 0, fp: 0, fn: 0, tn: 0 };
        this.t = 0;
        break;
      case "acknowledgeIncident": {
        const inc = this.incidents.find((i) => i.id === command.id);
        if (inc && (inc.status === "New" || inc.status === "Ongoing")) {
          inc.status = "Acknowledged";
          inc.acknowledgedAt = Date.now() / 1000;
          inc.acknowledgedBy = "operator";
        }
        this.messages.emit({ type: "incidents", payload: this.incidents });
        return;
      }
      case "resolveIncident": {
        const inc = this.incidents.find((i) => i.id === command.id);
        if (
          inc &&
          (inc.status === "New" || inc.status === "Ongoing" || inc.status === "Acknowledged")
        ) {
          inc.status = "Resolved";
          inc.resolvedAt = Date.now() / 1000;
          inc.resolutionReason = command.reason ?? "Manually resolved";
        }
        this.messages.emit({ type: "incidents", payload: this.incidents });
        return;
      }
    }
    this.state.lastUpdated = new Date().toISOString();
    this.messages.emit({ type: "state", payload: { ...this.state } });
  }

  onMessage(handler: (msg: ServerMessage) => void): () => void {
    return this.messages.on(handler);
  }

  onStatus(handler: (status: TransportStatus) => void): () => void {
    return this.statuses.on(handler);
  }
}
