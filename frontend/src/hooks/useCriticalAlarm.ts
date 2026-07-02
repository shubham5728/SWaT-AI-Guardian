import { useEffect, useRef, useState } from "react";
import { useDashboardStore } from "@/store/useDashboardStore";
import { computeRisk, riskToSeverity } from "@/utils/severity";

/**
 * Audible critical alarm. While the latest tick's severity is CRITICAL (and the
 * user hasn't muted), it plays a looping two-tone siren via the Web Audio API —
 * no audio asset needed.
 *
 * Browsers block audio until a user gesture, so the AudioContext is created/
 * resumed lazily on the first interaction (the mute toggle, or any click).
 */
export function useCriticalAlarm() {
  const [muted, setMuted] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const toggleRef = useRef(true); // alternates the two siren tones

  // Derive "is critical now" from the latest tick.
  const lastTick = useDashboardStore((s) => s.ticks.at(-1));
  const isCritical = lastTick
    ? riskToSeverity(computeRisk(lastTick.mse, lastTick.threshold)) === "CRITICAL"
    : false;

  // Ensure an AudioContext exists and is running (must follow a user gesture).
  const ensureContext = (): AudioContext | null => {
    if (typeof window === "undefined") return null;
    if (!ctxRef.current) {
      const Ctor = window.AudioContext ?? (window as any).webkitAudioContext;
      if (!Ctor) return null;
      ctxRef.current = new Ctor();
    }
    if (ctxRef.current.state === "suspended") void ctxRef.current.resume();
    return ctxRef.current;
  };

  // Unlock audio on the first user interaction anywhere on the page.
  useEffect(() => {
    const unlock = () => ensureContext();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  const beep = () => {
    const ctx = ctxRef.current;
    if (!ctx || ctx.state !== "running") return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    toggleRef.current = !toggleRef.current;
    osc.type = "square";
    osc.frequency.value = toggleRef.current ? 880 : 660; // two-tone siren
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.32);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.34);
  };

  // Start/stop the repeating siren based on critical state + mute.
  useEffect(() => {
    const active = isCritical && !muted;
    if (active) {
      ensureContext();
      if (!intervalRef.current) {
        beep();
        intervalRef.current = setInterval(beep, 600);
      }
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isCritical, muted]);

  return { muted, setMuted, isCritical };
}
