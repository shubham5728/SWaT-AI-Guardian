import type { ReactNode } from "react";

interface MetricCardProps {
  label: string;
  /** Main value — string or rich node. */
  value: ReactNode;
  /** Tailwind text-color class for the value (e.g. "text-critical"). */
  valueClass?: string;
  /** Small secondary line under the value. */
  sub?: ReactNode;
  valueSize?: "lg" | "sm";
}

export function MetricCard({
  label,
  value,
  valueClass = "text-text-strong",
  sub,
  valueSize = "sm",
}: MetricCardProps) {
  return (
    <div className="matte-card flex min-h-[82px] flex-col justify-center">
      <div className="metric-label">{label}</div>
      <div
        className={`font-bold leading-tight ${valueClass} ${
          valueSize === "lg" ? "text-[1.8rem] tabular-nums" : "text-[1.15rem]"
        }`}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[0.7rem] font-normal text-text-muted">{sub}</div>}
    </div>
  );
}
