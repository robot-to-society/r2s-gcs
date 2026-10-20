// Draws the briefing's other missions under the active one (dimmed, no click handlers) and the
// crossing / near-approach labels as DOM markers (spec 2026-10-20 §5.3).
import maplibregl, { type ExpressionSpecification, type Map as MlMap, type Marker } from 'maplibre-gl'
import { useEffect, useRef, type RefObject } from 'react'
import type { CrossLabel } from './crossings'
import { briefLabelEl, othersGeoJson, type OtherMission, type OthersGeoJson } from './overlay'

const PATHS = 'briefing-paths'
const FENCE = 'briefing-fence'
const RALLY = 'briefing-rally'
const COLOR: ExpressionSpecification = ['get', 'color']
/** The active mission's first layers: everything here goes beneath them. */
const ACTIVE_BOTTOM = ['plan-fence-fill', 'mission-path-casing']

type Source = { setData: (d: unknown) => void }

function setup(m: MlMap): void {
  const before = ACTIVE_BOTTOM.find((id) => m.getLayer(id))
  for (const id of [PATHS, FENCE, RALLY]) m.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  m.addLayer({ id: 'briefing-fence', type: 'fill', source: FENCE, filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': COLOR, 'fill-opacity': 0.08 } }, before)
  m.addLayer({ id: 'briefing-fence-line', type: 'line', source: FENCE, paint: { 'line-color': COLOR, 'line-width': 1.5, 'line-opacity': 0.5 } }, before)
  m.addLayer({ id: 'briefing-paths', type: 'line', source: PATHS, filter: ['==', ['get', 'predicted'], 0], layout: { 'line-join': 'round' }, paint: { 'line-color': COLOR, 'line-width': 2, 'line-opacity': 0.55 } }, before)
  m.addLayer({ id: 'briefing-predicted', type: 'line', source: PATHS, filter: ['==', ['get', 'predicted'], 1], layout: { 'line-join': 'round' }, paint: { 'line-color': COLOR, 'line-width': 1.5, 'line-opacity': 0.5, 'line-dasharray': [2, 1.5] } }, before)
  m.addLayer({ id: 'briefing-rally', type: 'circle', source: RALLY, paint: { 'circle-color': COLOR, 'circle-radius': 5, 'circle-opacity': 0.55, 'circle-stroke-color': '#0b1b2e', 'circle-stroke-width': 1 } }, before)
}

function draw(m: MlMap, g: OthersGeoJson): void {
  if (!m.getSource(PATHS)) setup(m)
  ;(m.getSource(PATHS) as Source | undefined)?.setData(g.paths)
  ;(m.getSource(FENCE) as Source | undefined)?.setData(g.fences)
  ;(m.getSource(RALLY) as Source | undefined)?.setData(g.rally)
}

export interface BriefingOverlayArgs {
  readonly map: RefObject<MlMap | null>
  readonly loaded: RefObject<boolean>
  readonly others: readonly OtherMission[]
  readonly labels: readonly CrossLabel[]
  readonly names: ReadonlyMap<string, string>
  readonly colors: ReadonlyMap<string, string>
  readonly onLabel: (l: CrossLabel) => void
}

/** The layers are only added once there is something to draw: a single-mission session stays as it was. */
function useOthersLayers(map: RefObject<MlMap | null>, loaded: RefObject<boolean>, others: readonly OtherMission[]): void {
  const latest = useRef<OthersGeoJson | null>(null)
  useEffect(() => {
    const m = map.current
    if (!m) return
    const g = othersGeoJson(others)
    latest.current = g
    if (others.length === 0 && !m.getSource(PATHS)) return
    if (loaded.current) draw(m, g)
    else m.once('load', () => latest.current && draw(m, latest.current))
  }, [map, loaded, others])
}

export function useBriefingOverlay({ map, loaded, others, labels, names, colors, onLabel }: BriefingOverlayArgs): void {
  useOthersLayers(map, loaded, others)
  const onLabelRef = useRef(onLabel)
  useEffect(() => {
    onLabelRef.current = onLabel
  }, [onLabel])
  const markers = useRef<Marker[]>([])
  useEffect(() => {
    const m = map.current
    if (!m) return
    markers.current.forEach((mk) => mk.remove())
    markers.current = labels.map((l) => {
      const el = briefLabelEl(l, names, colors, (x) => onLabelRef.current(x))
      return new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, -8] }).setLngLat([l.lon, l.lat]).addTo(m)
    })
  }, [map, labels, names, colors])
  useEffect(
    () => () => {
      markers.current.forEach((mk) => mk.remove())
      markers.current = []
    },
    [],
  )
}
