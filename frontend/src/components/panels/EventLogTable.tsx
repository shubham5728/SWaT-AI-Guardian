import { useDashboardStore } from "@/store/useDashboardStore";
import { Panel } from "@/components/ui/Panel";
import { SEVERITY_TEXT_CLASS } from "@/utils/severity";
import { hhmmss } from "@/utils/format";
import { sensorName } from "@/utils/sensors";

const COLUMNS = ["Time", "Type", "Truth", "Result", "Score", "Component"] as const;

/** Every logged row is an alert (severity != NORMAL), so prediction = Attack:
 *  TP if ground-truth label is Attack, otherwise FP. */
function result(label: string): { text: string; cls: string } {
  return label.includes("Attack")
    ? { text: "✅ TP", cls: "text-normal" }
    : { text: "⚠ FP", cls: "text-warning" };
}

/** Security Event Log — tabular feed of every scored frame's verdict. */
export function EventLogTable() {
  const log = useDashboardStore((s) => s.log);

  return (
    <Panel title="🚨 Security Event Log">
      <div className="matte-card h-[320px] overflow-auto p-0">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-surface-2 text-text-muted">
            <tr>
              {COLUMNS.map((c) => (
                <th key={c} className="px-3 py-2 font-semibold uppercase tracking-wide">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {log.slice(0, 20).map((e, i) => {
              const r = result(e.label);
              return (
                <tr key={`${e.ts}-${i}`} className="hover:bg-white/[0.03]">
                  <td className="px-3 py-1.5 font-mono text-text-faint">{hhmmss(e.ts)}</td>
                  <td className={`px-3 py-1.5 font-semibold ${SEVERITY_TEXT_CLASS[e.type]}`}>
                    {e.type}
                  </td>
                  <td className="px-3 py-1.5">{e.label}</td>
                  <td className={`px-3 py-1.5 font-semibold ${r.cls}`}>{r.text}</td>
                  <td className="px-3 py-1.5 font-mono">{e.score}</td>
                  <td className="px-3 py-1.5">
                    {sensorName(e.component)}{" "}
                    <span className="text-text-faint">({e.component})</span>
                  </td>
                </tr>
              );
            })}
            {log.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length} className="px-3 py-4 text-center text-text-faint">
                  Awaiting events…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
