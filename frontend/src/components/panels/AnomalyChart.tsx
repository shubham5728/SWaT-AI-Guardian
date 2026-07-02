import { useMemo } from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import { useDashboardStore } from "@/store/useDashboardStore";
import { Panel } from "@/components/ui/Panel";

/**
 * Live anomaly score chart — the centerpiece. Renders the MSE line, the dashed
 * threshold rule, red markers on threshold breaches, and a translucent band
 * highlighting the time range of the selected incident.
 */
export function AnomalyChart() {
  const ticks = useDashboardStore((s) => s.ticks);
  const incidents = useDashboardStore((s) => s.incidents);
  const selectedId = useDashboardStore((s) => s.selectedIncidentId);

  const option = useMemo<EChartsOption>(() => {
    const threshold = ticks.at(-1)?.threshold ?? 0.0334;
    const points = ticks.map((t) => [t.ts * 1000, t.mse] as [number, number]);
    const breaches = ticks
      .filter((t) => t.mse > t.threshold)
      .map((t) => [t.ts * 1000, t.mse] as [number, number]);

    // Contiguous breach runs (score above threshold) → translucent red bands,
    // so "attack regions" are obvious at a glance.
    const bands: [{ xAxis: number }, { xAxis: number }][] = [];
    let runStart: number | null = null;
    for (let i = 0; i < ticks.length; i++) {
      const over = ticks[i].mse > ticks[i].threshold;
      if (over && runStart === null) runStart = ticks[i].ts * 1000;
      if (!over && runStart !== null) {
        bands.push([{ xAxis: runStart }, { xAxis: ticks[i - 1].ts * 1000 }]);
        runStart = null;
      }
    }
    if (runStart !== null) {
      bands.push([{ xAxis: runStart }, { xAxis: ticks[ticks.length - 1].ts * 1000 }]);
    }

    const selected = incidents.find((i) => i.id === selectedId);
    const selectedBand: [{ xAxis: number }, { xAxis: number }][] = selected
      ? [[{ xAxis: selected.startTime * 1000 }, { xAxis: selected.lastSeen * 1000 }]]
      : [];

    // Current "live" point, coloured by whether it breaches the threshold.
    const last = ticks.at(-1);
    const currentPoint = last
      ? [
          {
            value: [last.ts * 1000, last.mse],
            itemStyle: {
              color: last.mse > last.threshold ? "#EF4444" : "#10B981",
              borderColor: "#fff",
              borderWidth: 1.5,
            },
          },
        ]
      : [];

    return {
      backgroundColor: "transparent",
      grid: { left: 8, right: 16, top: 16, bottom: 24, containLabel: true },
      tooltip: {
        trigger: "axis",
        backgroundColor: "#111827",
        borderColor: "rgba(255,255,255,0.1)",
        textStyle: { color: "#E0E0E0" },
        valueFormatter: (v) => (typeof v === "number" ? v.toFixed(6) : String(v)),
      },
      xAxis: {
        type: "time",
        axisLabel: { color: "#6B7280", fontSize: 10 },
        axisLine: { lineStyle: { color: "#1F2937" } },
        splitLine: { show: false },
      },
      yAxis: {
        type: "value",
        name: "Anomaly Score",
        nameTextStyle: { color: "#9CA3AF", fontSize: 10 },
        axisLabel: { color: "#6B7280", fontSize: 10 },
        splitLine: { lineStyle: { color: "rgba(255,255,255,0.04)" } },
        min: 0,
      },
      series: [
        {
          name: "MSE",
          type: "line",
          showSymbol: false,
          // No smoothing — a spline overshoots on steep rises, so the curve
          // would diverge from the actual data points (and the red breach
          // markers, which sit on exact points). Straight segments keep the
          // line passing precisely through every sample.
          smooth: false,
          data: points,
          lineStyle: { color: "#10B981", width: 2 },
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: "rgba(16,185,129,0.25)" },
                { offset: 1, color: "rgba(16,185,129,0)" },
              ],
            },
          },
          markLine: {
            silent: true,
            symbol: "none",
            lineStyle: { color: "#EF4444", type: "dashed", width: 2 },
            label: {
              color: "#EF4444",
              formatter: `Threshold ${threshold.toFixed(2)}`,
              position: "insideEndTop",
            },
            data: [{ yAxis: threshold }],
          },
          markArea: {
            silent: true,
            data: [
              // Breach regions (light), then the selected-incident band (stronger).
              ...bands.map((b) => [
                { ...b[0], itemStyle: { color: "rgba(239,68,68,0.10)" } },
                b[1],
              ]),
              ...selectedBand.map((b) => [
                { ...b[0], itemStyle: { color: "rgba(239,68,68,0.22)" } },
                b[1],
              ]),
            ] as unknown as [{ xAxis: number }, { xAxis: number }][],
          },
        },
        {
          name: "Breach",
          type: "scatter",
          data: breaches,
          symbolSize: 8,
          itemStyle: { color: "#EF4444", opacity: 0.8 },
          tooltip: { show: true },
        },
        {
          name: "Now",
          type: "scatter",
          data: currentPoint,
          symbolSize: 13,
          tooltip: { show: true },
          z: 5,
        },
      ],
    };
  }, [ticks, incidents, selectedId]);

  return (
    <Panel
      title="Live Anomaly Detection"
      subtitle="Baseline: Expected vs Current — reconstruction error vs threshold"
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
