import { useState } from "react";
import { useDashboardStore } from "@/store/useDashboardStore";
import { useCommand } from "@/hooks/CommandContext";
import { Panel } from "@/components/ui/Panel";
import type { DataMode, Sensitivity } from "@/types";

const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";

const SENSITIVITIES: Sensitivity[] = ["Conservative", "Balanced", "Aggressive"];

/**
 * Right column: replaces the Streamlit sidebar. Every control dispatches a
 * typed ClientCommand to the backend (or mock) — no local-only state.
 */
export function ControlCenter() {
  const send = useCommand();
  const system = useDashboardStore((s) => s.system);
  const resetStore = useDashboardStore((s) => s.reset);
  const threshold = useDashboardStore((s) => s.ticks.at(-1)?.threshold);
  const meta = useDashboardStore((s) => s.meta);

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto pr-1">
      <Panel title="⚙️ Control Center">
        <div className="space-y-5">
          <Field label="System Mode / Data Stream">
            <Segmented<DataMode>
              value={system.dataMode}
              options={["Normal", "Attack"]}
              onChange={(mode) => send({ type: "setMode", mode })}
            />
          </Field>

          <Field label="AI Sensitivity">
            <Segmented<Sensitivity>
              value={system.sensitivity}
              options={SENSITIVITIES}
              onChange={(sensitivity) => send({ type: "setSensitivity", sensitivity })}
            />
            {threshold !== undefined && (
              <p className="mt-1 text-[0.7rem] text-text-muted">
                Current threshold:{" "}
                <span className="font-mono text-text">{threshold.toFixed(3)}</span>
              </p>
            )}
          </Field>

          <Field label={`Streaming Speed — ${system.simulationSpeed.toFixed(2)}×`}>
            <input
              type="range"
              min={0.1}
              max={10}
              step={0.1}
              value={system.simulationSpeed}
              onChange={(e) => send({ type: "setSpeed", speed: Number(e.target.value) })}
              className="w-full accent-accent"
            />
          </Field>

          <Field label="System Actions">
            <div className="space-y-2">
              <button
                onClick={() => send({ type: "setRun", run: !system.runSystem })}
                className={`w-full rounded px-3 py-2 text-sm font-bold transition ${
                  system.runSystem
                    ? "bg-normal/15 text-normal hover:bg-normal/25"
                    : "bg-surface-2 text-text-muted hover:bg-white/10"
                }`}
              >
                {system.runSystem ? "🚀 SYSTEM RUNNING" : "⏸ SYSTEM PAUSED"}
              </button>
              <button
                onClick={() => {
                  send({ type: "reset" });
                  resetStore();
                }}
                className="w-full rounded bg-surface-2 px-3 py-2 text-sm text-text hover:bg-white/10"
              >
                Reset Dashboard
              </button>
              <TestEmailButton />
            </div>
          </Field>

          {meta && (
            <Field label="Model">
              <div className="space-y-1 rounded border border-border bg-surface-2 px-3 py-2 text-[0.72rem] text-text">
                <MetaRow k="Pipeline" v={meta.model} />
                <MetaRow k="PCA" v={`${meta.pcaComponents} components`} />
                <MetaRow k="Base threshold" v={meta.aeThreshold.toFixed(3)} />
                <MetaRow
                  k="Active threshold"
                  v={threshold !== undefined ? threshold.toFixed(3) : "—"}
                />
                <MetaRow k="Sensitivity" v={system.sensitivity} />
              </div>
            </Field>
          )}
        </div>
      </Panel>
    </div>
  );
}

function MetaRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-text-muted">{k}</span>
      <span className="text-right font-mono text-text">{v}</span>
    </div>
  );
}

/** Triggers the backend's POST /api/test-email and shows the result inline. */
function TestEmailButton() {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [msg, setMsg] = useState("");

  const send = async () => {
    setState("sending");
    setMsg("");
    try {
      const res = await fetch(`${API_BASE}/test-email`, { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setState("sent");
        setMsg(data.to ? `Sent to ${data.to}` : "Sent");
      } else {
        setState("error");
        setMsg(data.error ?? "Failed");
      }
    } catch {
      setState("error");
      setMsg("Request failed");
    }
  };

  return (
    <div>
      <button
        onClick={send}
        disabled={state === "sending"}
        className="w-full rounded bg-surface-2 px-3 py-2 text-sm text-text hover:bg-white/10 disabled:opacity-60"
      >
        {state === "sending" ? "Sending…" : "✉️ Send Test Email"}
      </button>
      {msg && (
        <p
          className={`mt-1 text-[0.7rem] ${
            state === "error" ? "text-critical" : "text-normal"
          }`}
        >
          {msg}
        </p>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="metric-label">{label}</div>
      {children}
    </div>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-1 rounded bg-surface-2 p-1">
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          className={`flex-1 rounded px-2 py-1.5 text-xs font-semibold transition ${
            value === opt
              ? "bg-accent text-white"
              : "text-text-muted hover:text-text"
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}
