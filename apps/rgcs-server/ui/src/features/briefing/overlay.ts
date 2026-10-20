// The briefing's other missions on the planner map (spec 2026-10-20): route, predicted path, fence
// and rally of every open mission but the one being edited, each in its row colour, plus the DOM
// labels at crossings / near approaches showing both planned altitudes.
import type { Feature, FeatureCollection, Geometry, Point } from 'geojson'
import type { PathPoint } from '../flightpath/planePath'
import { fenceGeoJson } from '../mission/fenceMap'
import { pathGeoJson, placeTakeoffs } from '../mission/geo'
import { FRAME_LABEL } from '../mission/missionAir'
import type { Draft } from '../mission/model'
import type { CrossLabel, Side } from './crossings'

export interface OtherMission {
  readonly key: string
  readonly color: string
  readonly draft: Draft
  /** The flight its vehicle is expected to fly; null = not predicted (only the plan is drawn). */
  readonly predicted: PathPoint[] | null
}

export interface OthersGeoJson {
  readonly paths: FeatureCollection
  readonly fences: FeatureCollection
  readonly rally: FeatureCollection
}

type Tag = { readonly key: string; readonly color: string }

const collection = (features: Feature[]): FeatureCollection => ({ type: 'FeatureCollection', features })

function routeOf(o: OtherMission, tag: Tag): Feature[] {
  const { items, mission } = o.draft
  const placed = placeTakeoffs(items, mission.home)
  const legs = pathGeoJson(placed, mission.home).features.map((f): Feature => ({ ...f, properties: { ...tag, predicted: 0 } }))
  const pred = o.predicted && o.predicted.length >= 2 ? [o.predicted] : []
  const predicted = pred.map((pts): Feature<Geometry> => ({ type: 'Feature', properties: { ...tag, predicted: 1 }, geometry: { type: 'LineString', coordinates: pts.map((p) => [p.lon, p.lat]) } }))
  return [...legs, ...predicted]
}

const fenceOf = (o: OtherMission, tag: Tag): Feature[] => fenceGeoJson(o.draft.mission.fence).features.map((f) => ({ ...f, properties: { ...f.properties, ...tag } }))

const rallyOf = (o: OtherMission, tag: Tag): Feature<Point>[] =>
  o.draft.mission.rally.map((r) => ({ type: 'Feature', properties: { ...tag }, geometry: { type: 'Point', coordinates: [r.lon, r.lat] } }))

/** Every feature carries its mission's `key` and `color`; route features also `predicted` (0 / 1). */
export function othersGeoJson(others: readonly OtherMission[]): OthersGeoJson {
  const tags = others.map((o) => ({ o, tag: { key: o.key, color: o.color } }))
  return {
    paths: collection(tags.flatMap(({ o, tag }) => routeOf(o, tag))),
    fences: collection(tags.flatMap(({ o, tag }) => fenceOf(o, tag))),
    rally: collection(tags.flatMap(({ o, tag }) => rallyOf(o, tag))),
  }
}

function span(cls: string, text: string): HTMLSpanElement {
  const el = document.createElement('span')
  el.className = cls
  el.textContent = text
  return el
}

function sideLine(s: Side, names: ReadonlyMap<string, string>, colors: ReadonlyMap<string, string>): HTMLDivElement {
  const line = document.createElement('div')
  line.className = 'brief-label-line'
  const dot = span('brief-label-dot', '●')
  dot.style.color = colors.get(s.key) ?? ''
  line.append(dot, span('brief-label-name', names.get(s.key) ?? ''), span('brief-label-alt num', `${Math.round(s.alt)} m`), span('brief-label-frame', FRAME_LABEL[s.frame]))
  return line
}

/** "● 北エリア 40 m Rel" per side; a click goes to `onLabel` and never reaches the map. */
export function briefLabelEl(l: CrossLabel, names: ReadonlyMap<string, string>, colors: ReadonlyMap<string, string>, onLabel: (l: CrossLabel) => void): HTMLDivElement {
  const el = document.createElement('div')
  el.className = `brief-label ${l.kind}`
  el.append(sideLine(l.a, names, colors), sideLine(l.b, names, colors))
  el.addEventListener('click', (e) => {
    e.stopPropagation()
    onLabel(l)
  })
  return el
}
