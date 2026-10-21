// The survey area being drawn on the planner map: its outline, vertices and a marker on the first
// vertex that closes the ring. The layers (`survey-draw-*`) are added only once a drawing starts.
import maplibregl, { type Map as MlMap } from 'maplibre-gl'
import type { Feature, FeatureCollection } from 'geojson'
import { useEffect, useRef, type RefObject } from 'react'
import type { LatLon } from '../mission/geo'

/** What the map needs while a survey area is drawn. */
export interface SurveyDrawMap {
  readonly ring: readonly LatLon[]
  /** A map click: the next vertex. */
  readonly onClick: (lat: number, lon: number) => void
  /** The first vertex was clicked: finish. */
  readonly onClose: () => void
}

const SOURCE = 'survey-draw'
const COLOR = '#ffd166'

export function drawGeoJson(ring: readonly LatLon[] | null): FeatureCollection {
  if (!ring || ring.length === 0) return { type: 'FeatureCollection', features: [] }
  const coords = ring.map((p) => [p.lon, p.lat])
  const points: Feature[] = coords.map((c) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: c } }))
  const outline: Feature[] = coords.length > 1 ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords.length > 2 ? [...coords, coords[0]!] : coords } }] : []
  const fill: Feature[] = coords.length > 2 ? [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...coords, coords[0]!]] } }] : []
  return { type: 'FeatureCollection', features: [...fill, ...outline, ...points] }
}

function setup(m: MlMap): void {
  m.addSource(SOURCE, { type: 'geojson', data: drawGeoJson(null) })
  m.addLayer({ id: 'survey-draw-fill', type: 'fill', source: SOURCE, filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': COLOR, 'fill-opacity': 0.12 } })
  m.addLayer({ id: 'survey-draw-line', type: 'line', source: SOURCE, filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': COLOR, 'line-width': 2, 'line-dasharray': [2, 1.5] } })
  m.addLayer({ id: 'survey-draw-pt', type: 'circle', source: SOURCE, filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 4, 'circle-color': COLOR, 'circle-stroke-color': '#0b1b2e', 'circle-stroke-width': 1.5 } })
}

interface Args {
  readonly map: RefObject<MlMap | null>
  readonly loaded: RefObject<boolean>
  readonly draw: SurveyDrawMap | null
}

export function useSurveyDrawLayer({ map, loaded, draw }: Args): void {
  const ring = draw?.ring ?? null
  const onClose = useRef(draw?.onClose)
  onClose.current = draw?.onClose

  useEffect(() => {
    const m = map.current
    if (!m || (!ring && !m.getSource(SOURCE))) return
    const paint = () => {
      if (!m.getSource(SOURCE)) setup(m)
      const src = m.getSource(SOURCE) as { setData: (d: unknown) => void } | undefined
      src?.setData(drawGeoJson(ring))
    }
    if (loaded.current) paint()
    else m.once('load', paint)
  }, [map, loaded, ring])

  const first = ring?.[0]
  const [lat, lon] = [first?.lat, first?.lon]
  useEffect(() => {
    const m = map.current
    if (!m || lat === undefined || lon === undefined) return
    const el = document.createElement('div')
    el.className = 'sv-draw-close'
    el.addEventListener('click', (e) => {
      e.stopPropagation()
      onClose.current?.()
    })
    const mk = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([lon, lat]).addTo(m)
    return () => {
      mk.remove()
    }
  }, [map, lat, lon])
}
