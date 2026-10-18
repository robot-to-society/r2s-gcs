// Where each vehicle is going (user request 2026-10-19, 2D): the course-over-ground vector and,
// while the autopilot navigates, a line to its current target (GUIDED target or the bearing /
// distance of NAV_CONTROLLER_OUTPUT).
import type { Feature, FeatureCollection } from 'geojson'
import type { SysId, VehicleState } from '../../shared/api/types'
import { hasPosition } from './markers'

/** The vector shows where the vehicle will be in this many seconds at its current speed. */
export const VECTOR_SECONDS = 10
const MIN_VECTOR_M = 15
const MIN_SPEED_MS = 0.5
/** Modes in which NAV_CONTROLLER_OUTPUT describes a real destination. */
const NAVIGATING = new Set(['AUTO', 'GUIDED', 'RTL', 'SMART_RTL', 'LAND', 'BRAKE'])
const M_PER_DEG = 111_320
const RAD = Math.PI / 180

type LngLat = [number, number]

/** Flat-earth destination: fine for the few hundred metres drawn here. */
export function destination(lat: number, lon: number, bearingDeg: number, distM: number): LngLat {
  const north = distM * Math.cos(bearingDeg * RAD)
  const east = distM * Math.sin(bearingDeg * RAD)
  return [lon + east / (M_PER_DEG * Math.cos(lat * RAD)), lat + north / M_PER_DEG]
}

const lineFeature = (coords: LngLat[], properties: Record<string, unknown>): Feature => ({ type: 'Feature', properties, geometry: { type: 'LineString', coordinates: coords } })

function vector(v: VehicleState, sel: number): Feature[] {
  if (v.cog === undefined || v.ground_speed < MIN_SPEED_MS) return []
  const len = Math.max(MIN_VECTOR_M, v.ground_speed * VECTOR_SECONDS)
  return [lineFeature([[v.lon, v.lat], destination(v.lat, v.lon, v.cog, len)], { kind: 'vector', sysid: v.sysid, sel })]
}

function navTarget(v: VehicleState): LngLat | null {
  if (!v.armed || !v.nav || v.nav.wp_dist <= 0 || !NAVIGATING.has(v.mode)) return null
  if (v.mode === 'GUIDED' && v.target) return [v.target.lon, v.target.lat]
  return destination(v.lat, v.lon, v.nav.target_bearing, v.nav.wp_dist)
}

function nav(v: VehicleState, sel: number): Feature[] {
  const end = navTarget(v)
  if (!end || !v.nav) return []
  return [
    lineFeature([[v.lon, v.lat], end], { kind: 'nav', sysid: v.sysid, sel, dist: v.nav.wp_dist }),
    { type: 'Feature', properties: { kind: 'target', sysid: v.sysid, sel }, geometry: { type: 'Point', coordinates: end } },
  ]
}

export function courseGeoJson(vehicles: ReadonlyMap<SysId, VehicleState>, selected: SysId | null): FeatureCollection {
  const features = [...vehicles.values()].filter(hasPosition).flatMap((v) => {
    const sel = v.sysid === selected ? 1 : 0
    return [...nav(v, sel), ...vector(v, sel)]
  })
  return { type: 'FeatureCollection', features }
}
