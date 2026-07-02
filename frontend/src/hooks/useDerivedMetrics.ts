import { useEffect, useState } from "react";
import { useDashboardStore } from "@/store/useDashboardStore";
import { computeRisk, riskToSeverity, streamHealth } from "@/utils/severity";
import type { Severity } from "@/types";

export interface DerivedMetrics {
  mse: number;
  threshold: number;
  risk: number;
  severity: Severity;
  /** System status: the higher of the latest-tick severity and any ongoing
   *  incident severity — so active incidents can't hide behind a momentary
   *  normal frame. */
  effectiveSeverity: Severity;
  /** How many × over the active threshold the latest score is. */
  thresholdMultiple: number;
  lagMs: number;
  stream: ReturnType<typeof streamHealth>;
  ongoingIncidents: number;
  critCount: number;
  highCount: number;
  medCount: number;
  oldestActiveAgeSec: number | null;
  /** Avg model inference time over recent ticks (ms). */
  avgLatencyMs: number;
  /** Observed tick throughput (messages/sec). */
  msgsPerSec: number;
}

const SEVERITY_RANK: Record<Severity, number> = {
  NORMAL: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};

/**
 * Computes the header KPIs from the latest tick + incidents. Re-evaluates on a
 * 500ms timer too, so the "stream lag" keeps climbing when ticks stop arriving.
 */
export function useDerivedMetrics(): DerivedMetrics {
  const ticks = useDashboardStore((s) => s.ticks);
  const lastTick = ticks.at(-1);
  const lastTickAt = useDashboardStore((s) => s.lastTickAt);
  const incidents = useDashboardStore((s) => s.incidents);

  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 500);
    return () => clearInterval(id);
  }, []);

  const mse = lastTick?.mse ?? 0;
  const threshold = lastTick?.threshold ?? 0.0334;
  const risk = computeRisk(mse, threshold);
  const severity = riskToSeverity(risk);
  const lagMs = lastTickAt ? Date.now() - lastTickAt : 0;

  const ongoing = incidents.filter(
    (i) => i.status === "New" || i.status === "Ongoing" || i.status === "Acknowledged",
  );
  const has = (i: { type: string }, kw: string) => i.type.includes(kw);
  const critCount = ongoing.filter((i) => has(i, "CRITICAL") || has(i, "PERSISTENT")).length;
  const highCount = ongoing.filter((i) => has(i, "HIGH")).length;
  const medCount = ongoing.filter((i) => has(i, "MEDIUM")).length;
  const oldestActiveAgeSec = ongoing.length
    ? Math.floor(Date.now() / 1000 - Math.min(...ongoing.map((i) => i.startTime)))
    : null;

  // System status reflects the worst of {live frame, active incidents}.
  const incidentSeverity: Severity =
    critCount > 0 ? "CRITICAL" : highCount > 0 ? "HIGH" : medCount > 0 ? "MEDIUM" : "NORMAL";
  const effectiveSeverity =
    SEVERITY_RANK[incidentSeverity] >= SEVERITY_RANK[severity] ? incidentSeverity : severity;

  const thresholdMultiple = threshold > 0 ? mse / threshold : 0;

  // Runtime metrics from the recent tick window.
  const recent = ticks.slice(-30);
  const lat = recent.map((t) => t.latencyMs).filter((v): v is number => typeof v === "number");
  const avgLatencyMs = lat.length ? lat.reduce((a, b) => a + b, 0) / lat.length : 0;
  let msgsPerSec = 0;
  if (recent.length >= 2) {
    const spanSec = (recent[recent.length - 1].ts - recent[0].ts) || 1;
    msgsPerSec = (recent.length - 1) / spanSec;
  }

  return {
    mse,
    threshold,
    risk,
    severity,
    effectiveSeverity,
    thresholdMultiple,
    lagMs,
    stream: streamHealth(lagMs),
    ongoingIncidents: ongoing.length,
    critCount,
    highCount,
    medCount,
    oldestActiveAgeSec,
    avgLatencyMs,
    msgsPerSec,
  };
}
