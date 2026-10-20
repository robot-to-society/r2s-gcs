// What a double-click on a briefing row frames (spec 2026-10-20 §9): the mission's positioned
// items, its home, its fence (polygon vertices, circle outlines) and its rally points.
import { hasPosition, type LatLon } from '../mission/geo'
import { circleRing } from '../mission/geofenceModel'
import type { Draft } from '../mission/model'

export function framePoints(d: Draft): LatLon[] {
  const items = d.items.filter(hasPosition).map((it) => ({ lat: it.lat, lon: it.lon }))
  const h = d.mission.home
  const home = h && !(h.lat === 0 && h.lon === 0) ? [{ lat: h.lat, lon: h.lon }] : []
  const fence = d.mission.fence.flatMap((z) => (z.kind === 'circle' ? circleRing(z.center, z.radius, 16) : z.vertices))
  const rally = d.mission.rally.map((r) => ({ lat: r.lat, lon: r.lon }))
  return [...home, ...items, ...fence, ...rally].map((p) => ({ lat: p.lat, lon: p.lon }))
}
