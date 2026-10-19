// Altitudes for the 3D map (memory: RGCS mission UI conventions). Vehicles fly at the DEM ground
// of their home plus the relative altitude — `alt_msl` is not used: SITL's MSL and a real GPS's
// geoid need not match the DEM, while "home ground + rel" always puts the vehicle over its take-off.
import type { MissionItem, VehicleState } from '../../shared/api/types'
import type { LatLon } from './store'

/** Ground elevation in metres AMSL, `null` while its DEM tile is not loaded. */
export type ElevAt = (lon: number, lat: number) => number | null
export type Rgb = readonly [number, number, number]

/** One vertex in MapLibre mercator units (z = metres scaled like x / y). */
export interface AirVertex {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly c: Rgb
}

export interface AirPoint {
  readonly lon: number
  readonly lat: number
  readonly amsl: number
  readonly color: Rgb
}

const finite = (n: number | null): n is number => n !== null && Number.isFinite(n)

export function vehicleAmsl(v: VehicleState, home: LatLon | null, elevAt: ElevAt): { ground: number; amsl: number } | null {
  if (!home || (v.lat === 0 && v.lon === 0)) return null
  const homeGround = elevAt(home.lon, home.lat)
  if (!finite(homeGround) || !Number.isFinite(v.alt_rel)) return null
  const under = elevAt(v.lon, v.lat)
  return { ground: finite(under) ? under : homeGround, amsl: homeGround + v.alt_rel }
}

export function itemAmsl(item: MissionItem, home: LatLon | null, elevAt: ElevAt): number | null {
  if (item.frame === 'abs') return item.alt
  const ground = item.frame === 'ter' ? elevAt(item.lon, item.lat) : home ? elevAt(home.lon, home.lat) : null
  return finite(ground) ? ground + item.alt : null
}

const CYAN: Rgb = [0x9c / 255, 0xc9 / 255, 1]
const ALT_HI: Rgb = [0xd8 / 255, 0xa8 / 255, 1]

/** `--accent` → `--alt-hi` by the normalised altitude (spec 10 §6). */
export function altColor(t: number): Rgb {
  const k = Math.min(1, Math.max(0, t))
  return [CYAN[0] + (ALT_HI[0] - CYAN[0]) * k, CYAN[1] + (ALT_HI[1] - CYAN[1]) * k, CYAN[2] + (ALT_HI[2] - CYAN[2]) * k]
}

/** Same maths as `maplibregl.MercatorCoordinate.fromLngLat` (kept pure for tests). */
const EARTH_CIRCUMFERENCE = 2 * Math.PI * 6371008.8

export function toMercator(lon: number, lat: number, amsl: number): { x: number; y: number; z: number } {
  const x = (180 + lon) / 360
  const y = (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / 360
  const z = amsl / (EARTH_CIRCUMFERENCE * Math.cos((lat * Math.PI) / 180))
  return { x, y, z }
}

export function mercatorLine(points: readonly AirPoint[]): AirVertex[] {
  return points.map((p) => ({ ...toMercator(p.lon, p.lat, p.amsl), c: p.color }))
}
