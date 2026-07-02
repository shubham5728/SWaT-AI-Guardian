import { useDashboardStore } from "@/store/useDashboardStore";
import { Panel } from "@/components/ui/Panel";
import { hhmmss } from "@/utils/format";

/** Monospace deviation timeline — non-NORMAL events only, newest first. */
export function EventTimeline() {
  const log = useDashboardStore((s) => s.log);
  const events = log.filter((e) => e.type !== "NORMAL").slice(0, 12);

  return (
    <Panel title="Event Timeline">
      <div className="matte-card h-[320px] overflow-y-auto font-mono text-xs leading-relaxed">
        {events.length === 0 ? (
          <span className="text-text-faint">No deviation events.</span>
        ) : (
          events.map((e, i) => (
            <div key={`${e.ts}-${i}`} className="mb-2">
              <span className="text-text-faint">[{hhmmss(e.ts)}]</span>{" "}
              <span className="text-warning">Deviation Detected ({e.component})</span>{" "}
              <span className="text-critical">— Alert Triggered</span>
            </div>
          ))
        )}
      </div>
    </Panel>
  );
}
