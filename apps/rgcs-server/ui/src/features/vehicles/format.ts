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

export function battText(v: VehicleState): string {
  return v.battery.pct === null ? `${v.battery.volt.toFixed(1)} V` : `${v.battery.pct}%`
}

export function battLow(v: VehicleState): boolean {
  return v.battery.pct !== null && v.battery.pct < 50
}

export function battWidth(v: VehicleState): string {
  return `${v.battery.pct ?? 100}%`
}

/** Case-insensitive filter on name and mode, like the prototype's search box. */
export function matches(v: VehicleState, query: string, dict: Dict): boolean {
  const q = query.trim().toLowerCase()
  return q === '' || v.name.toLowerCase().includes(q) || modeLabel(v, dict).toLowerCase().includes(q)
}
