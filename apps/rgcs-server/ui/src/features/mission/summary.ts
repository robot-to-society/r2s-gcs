// Client-side mirror of rgcs-core's `Mission::stats` and the structural warnings (the fence
// checks need the vehicle's parameters and stay on the server: `POST /api/missions/validate`).
import type { Home, MissionItem, MissionStats } from '../../shared/api/types'
import { hasPosition, haversineM, isPositional } from './geo'

export const LONG_FLIGHT_S = 1200

export interface LocalWarning {
  readonly code: 'empty' | 'first_not_takeoff' | 'mixed_frames' | 'terrain_frame' | 'no_land_or_rtl' | 'long_flight'
  readonly seq: number | null
}

const WAIT_CMDS = new Set([16, 19, 112])

export function stats(items: readonly MissionItem[], home: Home | null, speed: number): MissionStats {
  let distance = 0
  let waits = 0
  let maxAlt = 0
  let prev: { lat: number; lon: number } | null = home ? { lat: home.lat, lon: home.lon } : null
  for (const it of items) {
    if (hasPosition(it)) {
      if (prev) distance += haversineM(prev.lat, prev.lon, it.lat, it.lon)
      prev = { lat: it.lat, lon: it.lon }
      maxAlt = Math.max(maxAlt, it.alt)
    }
    if (WAIT_CMDS.has(it.command)) waits += Math.max(0, it.params[0])
    else if (it.command === 93 && it.params[0] >= 0) waits += it.params[0]
  }
  return { distance_m: distance, duration_s: distance / Math.max(speed, 0.1) + waits, max_alt: maxAlt }
}

export function localWarnings(items: readonly MissionItem[], speed: number): readonly LocalWarning[] {
  if (items.length === 0) return [{ code: 'empty', seq: null }]
  const out: LocalWarning[] = []
  if (items[0]?.command !== 22) out.push({ code: 'first_not_takeoff', seq: 1 })
  const frames = new Set(items.filter(isPositional).map((it) => it.frame))
  if (frames.size > 1) out.push({ code: 'mixed_frames', seq: null })
  items.forEach((it, i) => {
    if (isPositional(it) && it.frame === 'ter') out.push({ code: 'terrain_frame', seq: i + 1 })
  })
  const last = items[items.length - 1]
  if (last && last.command !== 21 && last.command !== 20) out.push({ code: 'no_land_or_rtl', seq: items.length })
  if (stats(items, null, speed).duration_s > LONG_FLIGHT_S) out.push({ code: 'long_flight', seq: null })
  return out
}
