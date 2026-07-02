/** "HH:MM:SS" from epoch seconds (local time), matching Streamlit's time.strftime. */
export function hhmmss(tsSeconds: number): string {
  const d = new Date(tsSeconds * 1000);
  return d.toLocaleTimeString("en-GB", { hour12: false });
}

/** Human-readable elapsed seconds, e.g. 73 → "1m 13s". */
export function ageString(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

export function fixed(value: number, digits = 6): string {
  return value.toFixed(digits);
}
