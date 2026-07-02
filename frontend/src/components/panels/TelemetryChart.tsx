import { useMemo } from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import { useDashboardStore } from "@/store/useDashboardStore";
import { Panel } from "@/components/ui/Panel";
import { sensorName, sensorTag, isAnalogSensor } from "@/utils/sensors";

// Analog-only baseline (flow / level / pressure) — no discrete valves or pumps.
const BASELINE_SENSORS = ["FIT101", "LIT101", "DPIT301"];
const SERIES_COLORS = ["#3B82F6", "#10B981", "#F59E0B", "#A78BFA"];

/**
 * Multi-sensor telemetry. Like the Streamlit version it switches between a
 * "Baseline View" (FIT101/LIT101/P102) and an "Anomaly-Focused View" that
 * surfaces whichever sensors are currently driving the anomaly (top features).
 */
export function TelemetryChart() {
  const ticks = useDashboardStore((s) => s.ticks);

  const { option, anomalyView } = useMemo(() => {
    const latest = ticks.at(-1);
    // Attribution returns both "PIT502" and "PIT502_SMA"; collapse to the base
    // tag (the raw `sensors` dict has no _SMA keys, so those would plot as empty
    // lines). Keep only analog sensors — discrete valves/pumps (0/1/2 states)
    // aren't meaningful as continuous trend lines.
    const attribution = latest
      ? Object.keys(latest.topFeatures).map(sensorTag).filter(isAnalogSensor)
      : [];
    const anomalyView = attribution.length > 0;

    const active: string[] = [];
    for (const s of [...attribution, ...BASELINE_SENSORS]) {
      if (!active.includes(s)) active.push(s);
      if (active.length >= 4) break;
    }
    const sensors = active;

    const series = sensors.map((name, i) => ({
      name: sensorName(name),
      type: "line" as const,
      showSymbol: false,
      smooth: true,
      data: ticks.map((t) => [t.ts * 1000, t.sensors[name] ?? null] as [number, number | null]),
      lineStyle: { width: 1.8, color: SERIES_COLORS[i % SERIES_COLORS.length] },
      itemStyle: { color: SERIES_COLORS[i % SERIES_COLORS.length] },
    }));

    const option: EChartsOption = {
      backgroundColor: "transparent",
      // Extra top margin reserves a dedicated band for the legend so plot lines
      // never render over the labels.
      grid: { left: 8, right: 16, top: 56, bottom: 24, containLabel: true },
      tooltip: { trigger: "axis", backgroundColor: "#111827", textStyle: { color: "#E0E0E0" } },
      legend: {
        type: "scroll",
        textStyle: { color: "#9CA3AF", fontSize: 10 },
        top: 4,
        left: "center",
        icon: "roundRect",
        itemWidth: 14,
        itemGap: 14,
      },
      xAxis: {
        type: "time",
        axisLabel: { color: "#6B7280", fontSize: 10 },
        axisLine: { lineStyle: { color: "#1F2937" } },
      },
      yAxis: {
        type: "value",
        scale: true,
        axisLabel: { color: "#6B7280", fontSize: 10 },
        splitLine: { lineStyle: { color: "rgba(255,255,255,0.04)" } },
      },
      series,
    };
    return { option, anomalyView };
  }, [ticks]);

  return (
    <Panel
      title="Sensor Telemetry"
      subtitle={anomalyView ? "Mode: Anomaly-Focused View" : "Mode: Baseline View"}
    >
      <div className="matte-card h-[260px] p-2">
        <ReactECharts
          option={option}
          notMerge
          lazyUpdate
          style={{ height: "100%", width: "100%" }}
        />
      </div>
    </Panel>
  );
}
