import type { Severity, StreamHealth } from "@/types";

/**
 * Risk score (0–100) — ported from the Streamlit dashboard:
 *   risk = min((mse / threshold) * 50, 100)
 * A reading exactly at the threshold yields 50.
 */
export function computeRisk(mse: number, threshold: number): number {
  if (threshold <= 0) return 0;
  return Math.min((mse / threshold) * 50, 100);
}

/** Severity buckets — identical cut-offs to update_dashboard_view(). */
export function riskToSeverity(risk: number): Severity {
  if (risk > 80) return "CRITICAL";
  if (risk > 60) return "HIGH";
  if (risk > 40) return "MEDIUM";
  return "NORMAL";
}

export const SEVERITY_COLOR: Record<Severity, string> = {
  NORMAL: "#10B981",
  MEDIUM: "#F59E0B",
  HIGH: "#F59E0B",
  CRITICAL: "#EF4444",
};

/** Tailwind text-color class per severity (for inline className usage). */
export const SEVERITY_TEXT_CLASS: Record<Severity, string> = {
  NORMAL: "text-normal",
  MEDIUM: "text-warning",
  HIGH: "text-warning",
  CRITICAL: "text-critical",
};

export const SEVERITY_BADGE_CLASS: Record<Severity, string> = {
  NORMAL: "badge-normal",
  MEDIUM: "badge-warning",
  HIGH: "badge-warning",
  CRITICAL: "badge-critical",
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  NORMAL: "NORMAL",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
  CRITICAL: "CRITICAL (Active Breach)",
};

/**
 * Stream freshness from the lag since the last tick — mirrors the
 * "Stream Status" card logic (active < 5s; warn ≥ 200ms; critical ≥ 500ms).
 */
export function streamHealth(lagMs: number): {
  health: StreamHealth;
  text: string;
  colorClass: string;
} {
  if (lagMs >= 5000) {
    return {
      health: "LOST",
      text: "Delayed — Data pipeline lag detected",
      colorClass: "text-critical",
    };
  }
  if (lagMs >= 500) {
    return {
      health: "ACTIVE",
      text: "Delayed — Data pipeline lag detected",
      colorClass: "text-critical",
    };
  }
  if (lagMs >= 200) {
    return { health: "ACTIVE", text: "Moderate", colorClass: "text-warning" };
  }
  return { health: "ACTIVE", text: "Good", colorClass: "text-normal" };
}
