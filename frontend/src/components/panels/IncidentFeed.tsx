import { useDashboardStore } from "@/store/useDashboardStore";
import { useCommand } from "@/hooks/CommandContext";
import { Panel } from "@/components/ui/Panel";
import { hhmmss, ageString } from "@/utils/format";
import { sensorName } from "@/utils/sensors";
import type { Incident, IncidentStatus } from "@/types";

const ACTIVE: IncidentStatus[] = ["New", "Ongoing", "Acknowledged"];
const isActive = (s: IncidentStatus) => ACTIVE.includes(s);

const borderForType = (type: string): string => {
  if (type.includes("CRITICAL") || type.includes("PERSISTENT")) return "border-l-critical";
  if (type.includes("HIGH") || type.includes("MEDIUM") || type.includes("WARNING"))
    return "border-l-warning";
  return "border-l-normal";
};

const STATUS_BADGE: Record<IncidentStatus, string> = {
  New: "border border-accent/30 bg-accent/15 text-accent",
  Ongoing: "border border-critical/30 bg-critical/15 text-critical",
  Acknowledged: "border border-warning/30 bg-warning/15 text-warning",
  Resolved: "border border-normal/30 bg-normal/15 text-normal",
  Archived: "border border-border bg-surface-2 text-text-faint",
};

/** Frozen on resolution: resolved/archived use resolvedAt, else last detection. */
const durationSec = (inc: Incident): number =>
  (inc.resolvedAt ?? inc.lastSeen) - inc.createdAt;

/**
 * Left column: aggregated incident cards with a full lifecycle (New → Ongoing →
 * Acknowledged → Resolved → Archived). Operators can Acknowledge / Resolve, and
 * the dropdown links an incident to its time range on the anomaly chart.
 */
export function IncidentFeed() {
  const incidents = useDashboardStore((s) => s.incidents);
  const selectedId = useDashboardStore((s) => s.selectedIncidentId);
  const selectIncident = useDashboardStore((s) => s.selectIncident);

  const sorted = [...incidents].sort((a, b) => {
    const aActive = isActive(a.status);
    const bActive = isActive(b.status);
    if (aActive !== bActive) return aActive ? -1 : 1;
    return b.lastSeen - a.lastSeen;
  });
  const activeCount = sorted.filter((i) => isActive(i.status)).length;

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title="🚨 Incident Feed"
        action={
          sorted.length > 0 ? (
            <span className="rounded bg-surface-2 px-2 py-0.5 text-xs text-text-muted">
              {activeCount} active
            </span>
          ) : null
        }
      >
        <div className="matte-card max-h-[560px] space-y-3 overflow-y-auto p-3">
          {sorted.length === 0 && (
            <p className="text-xs text-text-muted">No incidents. System nominal.</p>
          )}
          {sorted.slice(0, 25).map((inc) => (
            <IncidentCard
              key={inc.id}
              inc={inc}
              selected={inc.id === selectedId}
              onSelect={() => selectIncident(inc.id === selectedId ? null : inc.id)}
            />
          ))}
        </div>
      </Panel>

      <Panel title="Correlation & Analysis">
        <select
          value={selectedId ?? ""}
          onChange={(e) => selectIncident(e.target.value || null)}
          className="w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-xs text-text focus:border-accent focus:outline-none"
        >
          <option value="">Highlight incident on graph…</option>
          {sorted.slice(0, 12).map((inc, i) => (
            <option key={inc.id} value={inc.id}>
              {i + 1}. {isActive(inc.status) ? "🔴" : "🟢"} {inc.type} ({inc.component}) @{" "}
              {hhmmss(inc.startTime)}
            </option>
          ))}
        </select>
      </Panel>
    </div>
  );
}

function IncidentCard({
  inc,
  selected,
  onSelect,
}: {
  inc: Incident;
  selected: boolean;
  onSelect: () => void;
}) {
  const send = useCommand();
  const active = isActive(inc.status);

  return (
    <div
      onClick={onSelect}
      className={`w-full cursor-pointer border-l-[3px] pl-3 text-left transition ${borderForType(
        inc.type,
      )} ${selected ? "bg-white/5" : "hover:bg-white/[0.03]"} rounded-r py-1`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-text-strong">{inc.type}</div>
        <span className={`badge ${STATUS_BADGE[inc.status]}`}>{inc.status}</span>
      </div>
      <div className="mt-0.5 space-y-0.5 text-[0.8rem] text-text-muted">
        <div>
          <b>Component:</b> {sensorName(inc.component)}{" "}
          <span className="text-text-faint">({inc.component})</span>
        </div>
        <div>
          <b>Duration:</b> {ageString(durationSec(inc))}
          {!active && <span className="text-text-faint"> (frozen)</span>}
        </div>
        <div>
          <b>Occurrences:</b> {inc.occurrences} · <b>Trend:</b> {inc.trend}
        </div>
        <div>
          <b>Last Seen:</b> {hhmmss(inc.lastSeen)}
        </div>
        {inc.acknowledgedAt && (
          <div className="text-warning">
            Ack by {inc.acknowledgedBy} @ {hhmmss(inc.acknowledgedAt)}
          </div>
        )}
        {inc.resolvedAt && (
          <div className="text-normal">
            Resolved @ {hhmmss(inc.resolvedAt)} — {inc.resolutionReason}
          </div>
        )}
      </div>

      {active && (
        <div className="mt-1.5 flex gap-2">
          {inc.status !== "Acknowledged" && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                send({ type: "acknowledgeIncident", id: inc.id });
              }}
              className="rounded bg-warning/15 px-2 py-1 text-[0.7rem] font-semibold text-warning hover:bg-warning/25"
            >
              Acknowledge
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              send({ type: "resolveIncident", id: inc.id });
            }}
            className="rounded bg-normal/15 px-2 py-1 text-[0.7rem] font-semibold text-normal hover:bg-normal/25"
          >
            Resolve
          </button>
        </div>
      )}
    </div>
  );
}
