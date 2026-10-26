import type { Dict } from '../../shared/i18n'
import type { VehicleState } from '../../shared/api/types'

/** Mode label: a disarmed rover / copter on the ground shows the UI word for "ground". */
export function modeLabel(v: VehicleState, dict: Dict): string {
  if (!v.armed && v.mode === '' ) return dict.ground
  return v.mode
}

export function altText(v: VehicleState): string {
  return `${Math.round(v.alt_rel)} m`
}

export function speedText(v: VehicleState): string {
  return `${v.ground_speed.toFixed(1)} m/s`
}

/** Percentage, else voltage; a dash when neither is reported (no battery monitor: 0 V, no %). */
export function battText(v: VehicleState): string {
  if (v.battery.pct !== null) return `${v.battery.pct}%`
  return v.battery.volt > 0 ? `${v.battery.volt.toFixed(1)} V` : '—'
}

export function battLow(v: VehicleState): boolean {
  return v.battery.pct !== null && v.battery.pct < 50
}

/** Bar fill; 0 % when unknown: an unknown battery must never look full (UX-11). */
export function battWidth(v: VehicleState): string {
  return `${v.battery.pct ?? 0}%`
}

/** Case-insensitive filter on name and mode, like the prototype's search box. */
export function matches(v: VehicleState, query: string, dict: Dict): boolean {
  const q = query.trim().toLowerCase()
  return q === '' || v.name.toLowerCase().includes(q) || modeLabel(v, dict).toLowerCase().includes(q)
}

/** Status dot colour class (prototype: blue copter, amber warn / delay, red lost, green ground). */
export function dotClass(v: VehicleState): string {
  if (v.link === 'lost') return 'dot lost'
  if (v.warn || v.link === 'delay') return 'dot warn'
  return v.kind === 'copter' ? 'dot copter' : 'dot ok'
}
