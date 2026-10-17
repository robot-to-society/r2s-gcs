import type { Feature, FeatureCollection, LineString } from 'geojson'

export type Point = readonly [number, number]
export type Track = readonly Point[]
export type Tracks = ReadonlyMap<number, Track>

export const MAX_TRACK_POINTS = 600
const MIN_STEP_M = 0.5

function metres(a: Point, b: Point): number {
  const dx = (b[0] - a[0]) * 111_320 * Math.cos((a[1] * Math.PI) / 180)
  const dy = (b[1] - a[1]) * 110_540
  return Math.hypot(dx, dy)
}

/** New map with the point appended to `sysid`'s track; identity-stable when the move is jitter. */
export function appendPoint(tracks: Tracks, sysid: number, lon: number, lat: number): Tracks {
  const prev = tracks.get(sysid) ?? []
  const last = prev.at(-1)
  const next: Point = [lon, lat]
  if (last && metres(last, next) < MIN_STEP_M) return tracks
  const out = new Map(tracks)
  out.set(sysid, [...prev, next].slice(-MAX_TRACK_POINTS))
  return out
}

export function tracksGeoJson(tracks: Tracks, selected: number | null): FeatureCollection<LineString, { sysid: number; selected: boolean }> {
  const features: Feature<LineString, { sysid: number; selected: boolean }>[] = []
  for (const [sysid, track] of tracks) {
    if (track.length < 2) continue
    features.push({
      type: 'Feature',
      properties: { sysid, selected: sysid === selected },
      geometry: { type: 'LineString', coordinates: track.map((p) => [p[0], p[1]]) },
    })
  }
  return { type: 'FeatureCollection', features }
}
