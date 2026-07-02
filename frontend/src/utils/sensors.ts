/**
 * Human-readable names for the SWaT (Secure Water Treatment) testbed sensor
 * tags. Naming convention is [Type][Stage][Number]:
 *   FIT=flow, LIT=tank level, P=pump, MV=motorized valve,
 *   AIT=water-quality analyzer, DPIT=diff. pressure, PIT=pressure, UV=UV unit.
 * Stage digit: 1 Raw water · 2 Chemical dosing · 3 Ultrafiltration ·
 *              4 Dechlorination(UV) · 5 Reverse Osmosis · 6 Permeate/Backwash.
 */
export const SENSOR_LABELS: Record<string, string> = {
  // Stage 1 — Raw water intake & storage
  FIT101: "Raw Water Inflow",
  LIT101: "Raw Water Tank Level",
  MV101: "Raw Water Inlet Valve",
  P101: "Raw Water Pump",
  P102: "Raw Water Pump (Backup)",
  // Stage 2 — Chemical dosing / pre-treatment
  AIT201: "Conductivity (NaCl)",
  AIT202: "pH (HCl)",
  AIT203: "ORP (NaOCl)",
  FIT201: "Dosing Flow",
  MV201: "UF Feed Inlet Valve",
  P201: "NaCl Dosing Pump",
  P202: "NaCl Dosing Pump (Backup)",
  P203: "HCl Dosing Pump",
  P204: "HCl Dosing Pump (Backup)",
  P205: "NaOCl Dosing Pump",
  P206: "NaOCl Dosing Pump (Backup)",
  // Stage 3 — Ultrafiltration (UF)
  DPIT301: "UF Membrane Diff. Pressure",
  FIT301: "UF Flow",
  LIT301: "UF Feed Tank Level",
  MV301: "UF Backwash Valve",
  MV302: "UF Outlet Valve",
  MV303: "UF Backwash Drain Valve",
  MV304: "UF Drain Valve",
  P301: "UF Feed Pump",
  P302: "UF Feed Pump (Backup)",
  // Stage 4 — Dechlorination (UV)
  AIT401: "RO Hardness",
  AIT402: "ORP (Dechlorination)",
  FIT401: "UV Dechlorinator Flow",
  LIT401: "RO Feed Tank Level",
  P401: "RO Feed Pump",
  P402: "RO Feed Pump (Backup)",
  P403: "NaHSO₃ Dosing Pump",
  P404: "NaHSO₃ Dosing Pump (Backup)",
  UV401: "UV Dechlorinator",
  // Stage 5 — Reverse Osmosis (RO)
  AIT501: "RO Feed pH",
  AIT502: "RO Feed ORP",
  AIT503: "RO Feed Conductivity",
  AIT504: "RO Permeate Conductivity",
  FIT501: "RO Membrane Inlet Flow",
  FIT502: "RO Permeate Flow",
  FIT503: "RO Reject Flow",
  FIT504: "RO Recirculation Flow",
  P501: "RO Boost Pump",
  PIT501: "RO Feed Pressure",
  PIT502: "RO Permeate Pressure",
  PIT503: "RO Reject Pressure",
  // Stage 6 — Permeate transfer / backwash
  FIT601: "Backwash Flow",
  P601: "Permeate Recycle Pump",
  P602: "UF Backwash Pump",
  P603: "Backwash Pump (Backup)",
};

/** Base tag without the engineered "_SMA" (moving-average) suffix. */
export function sensorTag(code: string): string {
  return code.replace(/_SMA$/, "");
}

/**
 * True for continuous/analog sensors (flow FIT, level LIT, pressure PIT/DPIT,
 * analyzer AIT). Discrete actuators — valves (MV), pumps (P), UV unit — are
 * on/off states (0/1/2), so they're excluded from analog telemetry trends.
 */
export function isAnalogSensor(code: string): boolean {
  return /^(FIT|LIT|AIT|DPIT|PIT)\d/.test(sensorTag(code));
}

/**
 * Friendly name for a sensor code. "_SMA" features (rolling averages) get an
 * "(avg)" hint. Unknown codes fall back to the raw code.
 */
export function sensorName(code: string): string {
  const isAvg = code.endsWith("_SMA");
  const tag = sensorTag(code);
  const label = SENSOR_LABELS[tag];
  if (!label) return code;
  return isAvg ? `${label} (avg)` : label;
}

/** "Friendly Name (TAG)" — best for places that should show both. */
export function sensorNameWithTag(code: string): string {
  const tag = sensorTag(code);
  if (!SENSOR_LABELS[tag]) return code;
  return `${sensorName(code)} · ${code}`;
}
