import { useDashboardStore } from "@/store/useDashboardStore";
import { useDerivedMetrics } from "@/hooks/useDerivedMetrics";
import { SEVERITY_LABEL, SEVERITY_TEXT_CLASS } from "@/utils/severity";
import { ageString } from "@/utils/format";
import { MetricCard } from "./MetricCard";
import { AlarmIndicator } from "./AlarmIndicator";

/** Top KPI strip — title + the five metric cards from the Streamlit header. */
export function TopBar() {
  const m = useDerivedMetrics();
  const system = useDashboardStore((s) => s.system);
  const status = useDashboardStore((s) => s.transportStatus);

  const incidentColor =
    m.critCount > 0
      ? "text-critical"
      : m.highCount > 0 || m.medCount > 0
        ? "text-warning"
        : "text-normal";

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[2fr_1fr_1fr_1fr_1fr_1.5fr]">
      {/* Brand */}
      <div className="flex items-center gap-3 pt-1">
        <div className="text-[2.2rem] drop-shadow-glow">🛡️</div>
        <h1 className="text-[2.2rem] font-bold tracking-tight text-text-strong">
          SWaT AI GUARDIAN
        </h1>
        <div className="ml-auto">
          <AlarmIndicator />
        </div>
      </div>

      <MetricCard
        label="System Status"
        value={SEVERITY_LABEL[m.effectiveSeverity]}
        valueClass={SEVERITY_TEXT_CLASS[m.effectiveSeverity]}
        sub={
          m.effectiveSeverity !== "NORMAL" && m.severity === "NORMAL"
            ? "Driven by active incidents (live frame normal)"
            : undefined
        }
      />

      <MetricCard
        label="Active Incidents"
        value={m.ongoingIncidents}
        valueClass={incidentColor}
        sub={
          <>
            ({m.critCount} Crit, {m.highCount} High, {m.medCount} Med)
            {m.oldestActiveAgeSec !== null && ` | Oldest: ${ageString(m.oldestActiveAgeSec)}`}
          </>
        }
      />

      <MetricCard
        label="Risk Score"
        value={m.risk.toFixed(1)}
        valueClass={SEVERITY_TEXT_CLASS[m.severity]}
        valueSize="lg"
      />

      <MetricCard
        label="Stream Status"
        value={
          <span className={`badge ${m.stream.health === "ACTIVE" ? "badge-normal" : "badge-critical"}`}>
            {m.stream.health === "ACTIVE" ? "🟢 Stream Active" : "🔴 Stream Lost"}
          </span>
        }
        sub={`Lag: ${m.lagMs.toFixed(0)}ms (${m.stream.text})`}
      />

      <DashboardHealth
        backendMode={system.backendMode}
        running={system.runSystem}
        status={status}
        latencyMs={m.avgLatencyMs}
        msgsPerSec={m.msgsPerSec}
      />
    </div>
  );
}

function DashboardHealth({
  backendMode,
  running,
  status,
  latencyMs,
  msgsPerSec,
}: {
  backendMode: string;
  running: boolean;
  status: string;
  latencyMs: number;
  msgsPerSec: number;
}) {
  const row = (label: string, value: string) => (
    <div>
      <span className="font-bold text-normal">{label}:</span> {value}
    </div>
  );
  return (
    <div className="matte-card min-h-[82px] py-3">
      <div className="metric-label mb-0.5 text-[0.75rem]">Dashboard Health</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[0.7rem] leading-tight text-text">
        {row("Backend", status === "open" ? "● Connected" : "● Offline")}
        {row("Source", backendMode === "KAFKA" ? "● Kafka" : "● Simulated")}
        {row("AI Engine", running ? "● Running" : "● Standby")}
        {row("Throughput", `${msgsPerSec.toFixed(1)}/s`)}
        {row("Inference", latencyMs > 0 ? `${latencyMs.toFixed(1)} ms` : "—")}
        {row("UI", "● Synced")}
      </div>
    </div>
  );
}
