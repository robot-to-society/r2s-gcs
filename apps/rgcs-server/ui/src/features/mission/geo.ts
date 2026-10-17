// Geometry helpers shared by the editor map, the summary and the ops progress row.
import type { Feature, FeatureCollection, LineString } from 'geojson'
import type { Home, MissionItem } from '../../shared/api/types'

export interface LatLon {
  readonly lat: number
  readonly lon: number
}

const R = 6_371_000

export function haversineM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const p1 = (aLat * Math.PI) / 180
  const p2 = (bLat * Math.PI) / 180
  const dp = p2 - p1
  const dl = ((bLon - aLon) * Math.PI) / 180
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

export const midpoint = (a: LatLon, b: LatLon): LatLon => ({ lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 })

/** NAV commands that fly to a position (same rule as `MissionItem::is_positional` in rgcs-core). */
export function isPositional(it: MissionItem): boolean {
  return (it.command >= 16 && it.command <= 22) || it.command === 82 || it.command === 201
}

export function hasPosition(it: MissionItem): boolean {
  return isPositional(it) && !(it.lat === 0 && it.lon === 0)
}

/** Positioned items with their 1-based mission sequence. */
export function positioned(items: readonly MissionItem[]): readonly { seq: number; item: MissionItem }[] {
  return items.flatMap((item, i) => (hasPosition(item) ? [{ seq: i + 1, item }] : []))
}

export type PathProps = { readonly seq: number; readonly alt_t: number }

/** One LineString per leg; `alt_t` is the leg's end altitude normalised to 0..1 across the mission. */
export function pathGeoJson(items: readonly MissionItem[], home: Home | null): FeatureCollection<LineString, PathProps> {
  const pts = positioned(items)
  const alts = pts.map((p) => p.item.alt)
  const lo = Math.min(...alts)
  const hi = Math.max(...alts)
  const t = (alt: number) => (hi > lo ? (alt - lo) / (hi - lo) : 0)
  const features: Feature<LineString, PathProps>[] = []
  let prev: LatLon | null = home ? { lat: home.lat, lon: home.lon } : null
  for (const { seq, item } of pts) {
    if (prev) {
      features.push({
        type: 'Feature',
        properties: { seq, alt_t: t(item.alt) },
        geometry: { type: 'LineString', coordinates: [[prev.lon, prev.lat], [item.lon, item.lat]] },
      })
    }
    prev = { lat: item.lat, lon: item.lon }
  }
  return { type: 'FeatureCollection', features }
}

/**
 * Metres still to fly: vehicle → the current item (1-based `seq`), then the remaining legs.
 * `null` when `seq` is 0 (not started) or beyond the mission; 0 once the last positioned item is reached.
 */
export function remainingDistanceM(items: readonly MissionItem[], seq: number, vehicle: LatLon | null): number | null {
  if (seq < 1 || seq > items.length) return null
  const ahead = positioned(items).filter((p) => p.seq >= seq)
  if (ahead.length === 0) return 0
  let total = 0
  let prev: LatLon | null = vehicle
  for (const { item } of ahead) {
    if (prev) total += haversineM(prev.lat, prev.lon, item.lat, item.lon)
    prev = { lat: item.lat, lon: item.lon }
  }
  return total
}
