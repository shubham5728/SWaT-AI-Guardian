import { useCriticalAlarm } from "@/hooks/useCriticalAlarm";

/**
 * Critical-alarm control: pulses red and plays a siren while any tick is
 * CRITICAL. Click to mute/unmute (also unlocks browser audio on first click).
 */
export function AlarmIndicator() {
  const { muted, setMuted, isCritical } = useCriticalAlarm();

  const base =
    "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-bold transition select-none";
  const cls = isCritical
    ? muted
      ? "border-critical/40 bg-critical/10 text-critical"
      : "border-critical bg-critical/20 text-critical animate-pulse-ring"
    : "border-border bg-surface-2 text-text-muted hover:text-text";

  return (
    <button
      onClick={() => setMuted((m) => !m)}
      className={`${base} ${cls}`}
      title={muted ? "Alarm muted — click to unmute" : "Alarm armed — click to mute"}
    >
      <span className="text-sm leading-none">{muted ? "🔇" : "🔊"}</span>
      {isCritical ? (muted ? "MUTED" : "CRITICAL ALARM") : "Alarm armed"}
    </button>
  );
}
