import type { VehicleState } from '../../shared/api/types'
import { hasPosition } from './markers'

export type Aside = 'full' | 'rail' | 'none'

export interface Padding {
  readonly top: number
  readonly left: number
  readonly right: number
  readonly bottom: number
}

const GAP = 12
const ASIDE_W = 296
const RAIL_W = 60
const RIGHT_W = 372

/** Keeps follow / fly-to centred in the visible map (spec 20 §4 `setPadding`). */
export function padding(aside: Aside, right: boolean): Padding {
  const left = aside === 'full' ? ASIDE_W + 2 * GAP : aside === 'rail' ? RAIL_W + 2 * GAP : 0
  return { top: 72, left, right: right ? RIGHT_W + 2 * GAP : 0, bottom: 60 }
}

/** `[lon, lat]` of the followed vehicle, or null when nothing to centre on. */
export function followTarget(vehicles: ReadonlyMap<number, VehicleState>, follow: number | null): [number, number] | null {
  if (follow === null) return null
  const v = vehicles.get(follow)
  return v && hasPosition(v) ? [v.lon, v.lat] : null
}

/** Follow re-centres only beyond this distance: a hovering vehicle's GPS noise would otherwise
 * shake the whole map (waypoints, home) by a pixel or two at every telemetry frame. */
export const FOLLOW_DEADBAND_PX = 4

export interface ScreenPoint {
  readonly x: number
  readonly y: number
}

export function needsRecenter(center: ScreenPoint, vehicle: ScreenPoint, minPx = FOLLOW_DEADBAND_PX): boolean {
  return Math.hypot(vehicle.x - center.x, vehicle.y - center.y) > minPx
}
