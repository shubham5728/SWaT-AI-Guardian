import { useDashboardStore } from "@/store/useDashboardStore";
import { Panel } from "@/components/ui/Panel";
import { sensorName } from "@/utils/sensors";

/** Strip the engineered "_SMA" suffix for display / grouping. */
const baseName = (sensor: string): string => sensor.replace(/_SMA$/, "");

const reasonFor = (sensor: string): string => {
  if (sensor.includes("LIT")) return "Tank level deviating from baseline";
  if (sensor.includes("FIT")) return "Flow rate inconsistency";
  if (sensor.includes("DPIT") || sensor.includes("PIT")) return "Pressure / differential-pressure anomaly";
  if (sensor.includes("AIT")) return "Analyzer reading out of range";
  if (sensor.startsWith("MV")) return "Motorized-valve state mismatch";
  if (sensor.startsWith("P")) return "Pump state / flow mismatch";
  return "Anomalous deviation detected";
};

/** A concrete remediation hint tied to the actual contributing sensor. */
const actionFor = (sensor: string): string => {
  const b = baseName(sensor);
  if (b.includes("LIT")) return `Verify tank-level sensor ${b}`;
  if (b.includes("FIT")) return `Inspect flow line / pump around ${b}`;
  if (b.includes("DPIT") || b.includes("PIT")) return `Check pressure at ${b}`;
  if (b.includes("AIT")) return `Validate analyzer ${b} (calibration/fouling)`;
  if (b.startsWith("MV")) return `Confirm motorized valve ${b} position`;
  if (b.startsWith("P")) return `Check pump ${b} on/off state`;
  return `Investigate ${b}`;
};

/**
 * "Top Contributing Signals" — the attribution panel. Shows the top sensors
 * driving the current anomaly as their **relative contribution share** (honest:
 * derived from each sensor's |scaled value| as a fraction of the total, so the
 * numbers vary and sum to ~100% — not a capped, identical "999%"). The
 * recommended actions are generated from the actual contributing sensors.
 */
interface DeviationGroup {
  base: string; // base sensor tag, e.g. "PIT502"
  impact: number; // combined |scaled deviation| across variants (for share)
  magnitude: number; // largest single-variant |scaled deviation| (robust-scaled)
  variants: string[]; // ["PIT502", "PIT502_SMA"]
}

export function RootCausePanel() {
  const latest = useDashboardStore((s) => s.ticks.at(-1));
  const features = latest ? Object.entries(latest.topFeatures) : [];

  // Collapse raw + "_SMA" variants of the same physical sensor into one group.
  const groups = new Map<string, DeviationGroup>();
  for (const [sensor, value] of features) {
    const base = baseName(sensor);
    const g = groups.get(base) ?? { base, impact: 0, magnitude: 0, variants: [] };
    g.impact += Math.abs(value);
    g.magnitude = Math.max(g.magnitude, Math.abs(value));
    g.variants.push(sensor);
    groups.set(base, g);
  }
  const ranked = [...groups.values()].sort((a, b) => b.impact - a.impact);
  const total = ranked.reduce((sum, g) => sum + g.impact, 0) || 1;

  const actions = ranked.slice(0, 3).map((g) => actionFor(g.base));

  return (
    <Panel
      title="⚡ Largest Deviations (Not causal)"
      subtitle="Most-deviated signals by |scaled deviation| — relative share, not a causal magnitude"
    >
      {ranked.length === 0 ? (
        <div className="matte-card text-sm text-text-muted">
          System is operating within normal parameters. No root cause available.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <div className="matte-card border-t-[3px] border-accent">
            <h4 className="text-text-strong">Recommended Action</h4>
            <ul className="mt-2 list-disc pl-4 text-[0.8rem] text-text-muted">
              {actions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </div>
          {ranked.slice(0, 4).map((g, i) => {
            const share = (g.impact / total) * 100;
            const hasAvg = g.variants.some((v) => v.endsWith("_SMA"));
            const hasRaw = g.variants.some((v) => !v.endsWith("_SMA"));
            const variantLabel = [hasRaw && "raw", hasAvg && "avg"].filter(Boolean).join(" + ");
            return (
              <div key={g.base} className="matte-card border-t-[3px] border-critical">
                <h4 className="text-text-strong">
                  #{i + 1} {sensorName(g.base)}
                </h4>
                <div className="text-[0.7rem] text-text-faint">
                  {g.base} · {variantLabel}
                </div>
                <div className="mt-1 text-2xl font-bold text-critical">
                  {share.toFixed(1)}% deviation share
                </div>
                <div className="text-[0.8rem] text-text-muted">{reasonFor(g.base)}</div>
                <div className="mt-1 text-[0.7rem] text-text-faint">
                  ≈ {g.magnitude.toFixed(1)} robust-scaled (IQR) units from median ·
                  deviation indicator, not causal
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
