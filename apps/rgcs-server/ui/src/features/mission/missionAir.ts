// 3D mission path (prototype updateMissionAir): one altitude polyline per leg coloured by
// its climb angle (steep climbs turn red), a post per positioned item (amber when selected), ground discs, and the altitude of
// every badge and mid-leg handle so the DOM markers can float to it.
import { useEffect, useRef, type RefObject } from 'react'
import type { FeatureCollection, Point } from 'geojson'
import type { Map as MlMap, Marker } from 'maplibre-gl'
import { climbColor, itemAmsl, mercatorLine, type AirPoint, type AirVertex, type ElevAt, type Rgb } from '../map/air'
import { useAir3d } from '../map/air3d'
import { pixelsPerMetre } from '../map/float'
import type { MapMode } from '../map/mapMode'
import { arcPoints, isArc } from './arc'
import { haversineM, hasPosition, type LatLon } from './geo'
import type { Draft, DraftItem } from './model'

const POST: Rgb = [0xbf / 255, 0xe0 / 255, 1]
const AMBER: Rgb = [0xf2 / 255, 0xb5 / 255, 0x44 / 255]
const FRAME_LABEL = { rel: 'Rel', abs: 'Abs', ter: 'Ter' } as const

export const AIR = 'mission-air3d'
export const FOOT = 'mission-foot'
export const GROUND = 'mission-ground'
export const MISSION_3D_LAYERS = { only3d: [FOOT, GROUND], only2d: ['mission-path-casing', 'mission-path-line'] }

export interface MissionAir {
  readonly lines: AirVertex[][]
  readonly posts: AirVertex[][]
  readonly discs: FeatureCollection<Point, { sel: number }>
  /** AMSL per item uid, `null` while unknown. */
  readonly alts: ReadonlyMap<number, number | null>
  /** AMSL at each mid-leg handle (same order as `midHandles`). */
  readonly mids: readonly (number | null)[]
}

type Pt = { lat: number; lon: number; amsl: number }

interface Stop {
  readonly lat: number
  readonly lon: number
  readonly amsl: number
  readonly item: DraftItem | null
}

/** "▲ 80 m Rel" (prototype 3D badge chip). */
export const altChip = (it: DraftItem): string => `▲ ${Math.round(it.alt)} m ${FRAME_LABEL[it.frame]}`

function legPoints(a: Stop, b: Stop, elevAt: ElevAt): Pt[] {
  const len = haversineM(a.lat, a.lon, b.lat, b.lon)
  const ter = a.item?.frame === 'ter' && b.item?.frame === 'ter'
  const arc = b.item && isArc(b.item) ? b.item.params[0] : 0
  const n0 = ter ? Math.min(200, Math.max(2, Math.ceil(len / 20))) : Math.max(2, Math.min(8, Math.ceil(len / 400)))
  const n = arc ? Math.max(n0, 16) : n0
  // an ARC_WAYPOINT leg follows its arc; the altitude still changes linearly along it
  const bent = arc ? arcPoints(a, b, arc, n) : null
  // a sub-degree arc or a zero chord comes back as [a, b]: draw it straight
  const along = bent && bent.length === n + 1 ? bent : null
  return Array.from({ length: n + 1 }, (_, k) => {
    const t = k / n
    const lat = along ? along[k]!.lat : a.lat + (b.lat - a.lat) * t
    const lon = along ? along[k]!.lon : a.lon + (b.lon - a.lon) * t
    const g = ter ? elevAt(lon, lat) : null
    const amsl = ter && g !== null ? g + a.item!.alt + (b.item!.alt - a.item!.alt) * t : a.amsl + (b.amsl - a.amsl) * t
    return { lat, lon, amsl }
  })
}

/** Each vertex takes the climb of the segment that leaves it (the last one, the segment into it). */
function coloured(pts: readonly Pt[]): AirPoint[] {
  return pts.map((p, i) => {
    const [a, b] = i < pts.length - 1 ? [p, pts[i + 1]!] : [pts[i - 1] ?? p, p]
    return { ...p, color: climbColor(b.amsl - a.amsl, haversineM(a.lat, a.lon, b.lat, b.lon)) }
  })
}

export function missionAirData(draft: Draft, selected: ReadonlySet<number>, elevAt: ElevAt): MissionAir {
  const items = draft.items.filter(hasPosition)
  const home: LatLon | null = draft.mission.home ?? items[0] ?? null
  const alts = new Map(items.map((it) => [it.uid, itemAmsl(it, home, elevAt)] as const))
  const homeGround = home ? elevAt(home.lon, home.lat) : null
  const stops: Stop[] = items.flatMap((it) => {
    const amsl = alts.get(it.uid)
    return amsl === null || amsl === undefined ? [] : [{ lat: it.lat, lon: it.lon, amsl, item: it }]
  })
  const route = draft.mission.home && homeGround !== null && stops.length > 0 ? [{ ...draft.mission.home, amsl: homeGround, item: null }, ...stops] : stops
  const lines = route.slice(1).map((b, i) => mercatorLine(coloured(legPoints(route[i]!, b, elevAt))))
  const discs: FeatureCollection<Point, { sel: number }> = { type: 'FeatureCollection', features: [] }
  const posts = stops.flatMap((s) => {
    const g = elevAt(s.lon, s.lat) ?? homeGround
    if (g === null) return []
    const c = selected.has(s.item!.uid) ? AMBER : POST
    discs.features.push({ type: 'Feature', properties: { sel: selected.has(s.item!.uid) ? 1 : 0 }, geometry: { type: 'Point', coordinates: [s.lon, s.lat] } })
    return [mercatorLine([{ lon: s.lon, lat: s.lat, amsl: Math.min(g, s.amsl), color: c }, { lon: s.lon, lat: s.lat, amsl: Math.max(g, s.amsl), color: c }])]
  })
  // `midHandles` puts one handle between each pair of consecutive positioned items
  const mids = items.slice(1).map((b, i) => {
    const za = alts.get(items[i]!.uid)
    const zb = alts.get(b.uid)
    return za == null || zb == null ? null : (za + zb) / 2
  })
  return { lines, posts, discs, alts, mids }
}

interface Args {
  readonly map: RefObject<MlMap | null>
  readonly loaded: RefObject<boolean>
  readonly mode: MapMode
  readonly terrainTiles: string | null
  readonly draft: Draft
  readonly selected: ReadonlySet<number>
  readonly badges: RefObject<ReadonlyMap<number, { marker: Marker }>>
  readonly handles: RefObject<readonly Marker[]>
}

function setup(m: MlMap): void {
  m.addSource(GROUND, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  m.addLayer({ id: FOOT, type: 'line', source: 'mission-path', layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#9cc9ff', 'line-width': 1.5, 'line-opacity': 0.5 } })
  m.addLayer({
    id: GROUND,
    type: 'circle',
    source: GROUND,
    layout: { visibility: 'none' },
    paint: { 'circle-radius': 5, 'circle-color': ['case', ['==', ['get', 'sel'], 1], '#f2b544', '#9cc9ff'], 'circle-stroke-color': '#0f1824', 'circle-stroke-width': 2, 'circle-opacity': 0.95, 'circle-pitch-alignment': 'map' },
  })
}

export interface MissionAir3d {
  readonly is3d: boolean
  /** Screen pixels per metre of altitude at an item in the last 3D frame, `null` before one. */
  readonly pxPerMetre: (uid: number) => number | null
}

export function useMissionAir({ map, loaded, mode, terrainTiles, draft, selected, badges, handles }: Args): MissionAir3d {
  const { sampler, ready, is3d, tick, layer, floats, matrix } = useAir3d({ map, loaded, mode, terrainTiles, layerId: AIR, setup, modeLayers: MISSION_3D_LAYERS })
  const latest = useRef({ draft, alts: new Map<number, number | null>() as ReadonlyMap<number, number | null> })
  useEffect(() => {
    const m = map.current
    if (!m || !ready || !sampler || !is3d) return
    const d = missionAirData(draft, selected, sampler.elevAt)
    latest.current = { draft, alts: d.alts }
    const byUid = new Map(draft.items.map((it) => [it.uid, it]))
    const badgeFloats = [...badges.current.entries()].flatMap(([uid, { marker }]) => {
      const it = byUid.get(uid)
      return it ? [{ marker, lon: it.lon, lat: it.lat, amsl: d.alts.get(uid) ?? null, base: [0, 0] as const }] : []
    })
    const handleFloats = handles.current.map((marker, i) => {
      const p = marker.getLngLat()
      return { marker, lon: p.lng, lat: p.lat, amsl: d.mids[i] ?? null, base: [0, 0] as const }
    })
    floats.current = [...badgeFloats, ...handleFloats]
    layer.setLines(d.lines, d.posts)
    const src = m.getSource(GROUND) as { setData: (x: unknown) => void } | undefined
    src?.setData(d.discs)
  }, [map, ready, is3d, sampler, draft, selected, badges, handles, tick, layer, floats])

  const pxPerMetre = (uid: number): number | null => {
    const m = map.current
    const it = latest.current.draft.items.find((x) => x.uid === uid)
    if (!m || !matrix.current || !it) return null
    const el = m.getContainer()
    // before its ground is known an item floats at 0 m: the scale barely depends on it
    return pixelsPerMetre(matrix.current, { w: el.clientWidth, h: el.clientHeight }, it.lon, it.lat, latest.current.alts.get(uid) ?? 0)
  }
  return { is3d, pxPerMetre }
}
