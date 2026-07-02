import { useLiveData } from "@/hooks/useLiveData";
import { CommandContext } from "@/hooks/CommandContext";
import { useDashboardStore } from "@/store/useDashboardStore";
import { TopBar } from "@/components/layout/TopBar";
import { IncidentFeed } from "@/components/panels/IncidentFeed";
import { ControlCenter } from "@/components/panels/ControlCenter";
import { AnomalyChart } from "@/components/panels/AnomalyChart";
import { TelemetryChart } from "@/components/panels/TelemetryChart";
import { RootCausePanel } from "@/components/panels/RootCausePanel";
import { LiveEvaluation } from "@/components/panels/LiveEvaluation";
import { EventTimeline } from "@/components/panels/EventTimeline";
import { EventLogTable } from "@/components/panels/EventLogTable";

/**
 * Top-level layout — mirrors the Streamlit dashboard regions:
 *   TopBar  →  [Incident Feed | Charts | Control Center]  →  Root Cause  →
 *   [Timeline | Event Log]
 */
export default function App() {
  const { send } = useLiveData();
  const status = useDashboardStore((s) => s.transportStatus);
  const hasData = useDashboardStore((s) => s.ticks.length > 0);

  return (
    <CommandContext.Provider value={send}>
      <div className="mx-auto max-w-[1800px] space-y-5 p-4 md:p-6">
        {(status !== "open" || !hasData) && (
          <div
            className={`rounded-md border px-4 py-2 text-sm font-semibold ${
              status === "open"
                ? "border-warning/40 bg-warning/10 text-warning"
                : "border-critical/40 bg-critical/10 text-critical"
            }`}
          >
            {status !== "open"
              ? `⏳ Connecting to backend (${status})… KPIs will populate once the stream is live.`
              : "⏳ Connected — waiting for the first data frame (backend may still be loading the model)…"}
          </div>
        )}

        <TopBar />

        {/* 20 / 60 / 20 main grid */}
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,3fr)_minmax(0,1fr)]">
          <div className="min-h-[520px]">
            <IncidentFeed />
          </div>

          <div className="space-y-5">
            <AnomalyChart />
            <TelemetryChart />
          </div>

          <div className="min-h-[520px]">
            <ControlCenter />
          </div>
        </div>

        <RootCausePanel />

        <LiveEvaluation />

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_2fr]">
          <EventTimeline />
          <EventLogTable />
        </div>
      </div>
    </CommandContext.Provider>
  );
}
