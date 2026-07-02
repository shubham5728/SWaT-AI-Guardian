import { useDashboardStore } from "@/store/useDashboardStore";
import { Panel } from "@/components/ui/Panel";

/**
 * Live evaluation: the backend scores each frame's ALERT decision
 * (severity != NORMAL) against the dataset ground-truth label, accumulating a
 * confusion matrix. We derive Precision / Recall / F1 from it — a genuine,
 * non-fabricated quality readout (only possible because the dataset is labelled).
 */
export function LiveEvaluation() {
  const { tp, fp, fn, tn } = useDashboardStore((s) => s.metrics);

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const total = tp + fp + fn + tn;
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

  const cell = (label: string, value: number, cls: string) => (
    <div className="rounded bg-surface-2 px-2 py-1.5 text-center">
      <div className={`text-base font-bold tabular-nums ${cls}`}>{value}</div>
      <div className="text-[0.62rem] uppercase tracking-wide text-text-faint">{label}</div>
    </div>
  );

  const stat = (label: string, value: string) => (
    <div className="text-center">
      <div className="text-base font-bold tabular-nums text-text-strong">{value}</div>
      <div className="text-[0.62rem] uppercase tracking-wide text-text-muted">{label}</div>
    </div>
  );

  return (
    <Panel
      title="Live Evaluation"
      subtitle="Alert decision vs dataset label (ground truth)"
    >
      <div className="matte-card space-y-3">
        <div className="grid grid-cols-4 gap-2">
          {cell("TP", tp, "text-normal")}
          {cell("FP", fp, "text-warning")}
          {cell("FN", fn, "text-critical")}
          {cell("TN", tn, "text-text")}
        </div>
        <div className="grid grid-cols-4 gap-2 border-t border-border pt-2">
          {stat("Precision", pct(precision))}
          {stat("Recall", pct(recall))}
          {stat("F1", pct(f1))}
          {stat("Frames", total.toLocaleString())}
        </div>
      </div>
    </Panel>
  );
}
