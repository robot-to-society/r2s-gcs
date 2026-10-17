import maplibregl, { type Map as MlMap, type Marker, type StyleSpecification } from 'maplibre-gl'
import { useEffect, useRef } from 'react'
import type { FeatureCollection } from 'geojson'
import type { VehicleState } from '../../shared/api/types'
import { followTarget, type Padding } from './follow'
import { hasPosition, markerEl, updateMarkerEl } from './markers'
import type { LatLon } from './store'
import { tracksGeoJson, type Tracks } from './tracks'

interface Props {
  readonly vehicles: ReadonlyMap<number, VehicleState>
  readonly tracks: Tracks
  readonly follow: number | null
  readonly selected: number | null
  readonly padding: Padding
  readonly style: StyleSpecification
  readonly target: LatLon | null
  readonly onDragStart: () => void
  readonly onClick: (p: LatLon) => void
}

const HOME: [number, number] = [139.372, 36.162]
const TRACKS = 'tracks'
/** The arrow is 34 px wide at the element's left edge; pull it back so its centre sits on the position. */
const ARROW_OFFSET: [number, number] = [-17, 0]
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }

/** MapLibre canvas behind the floating panels (spec 10 §3.1). Pure helpers do the data work. */
export function MapView({ vehicles, tracks, follow, selected, padding, style, target, onDragStart, onClick }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<MlMap | null>(null)
  const loaded = useRef(false)
  const markers = useRef(new Map<number, { marker: Marker; el: HTMLDivElement }>())
  const targetMarker = useRef<Marker | null>(null)
  const dragRef = useRef(onDragStart)
  const clickRef = useRef(onClick)
  dragRef.current = onDragStart
  clickRef.current = onClick

  useEffect(() => {
    if (!container.current) return
    const m = new maplibregl.Map({ container: container.current, style, center: HOME, zoom: 14, attributionControl: { compact: true } })
    m.addControl(new maplibregl.NavigationControl({ showZoom: false, visualizePitch: false }), 'top-right')
    m.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-right')
    m.on('load', () => {
      m.addSource(TRACKS, { type: 'geojson', data: EMPTY })
      m.addLayer({
        id: 'tracks-others',
        type: 'line',
        source: TRACKS,
        filter: ['!', ['get', 'selected']],
        paint: { 'line-color': '#9cc9ff', 'line-width': 2, 'line-dasharray': [2, 2], 'line-opacity': 0.8 },
      })
      m.addLayer({
        id: 'tracks-selected',
        type: 'line',
        source: TRACKS,
        filter: ['get', 'selected'],
        paint: { 'line-color': '#f2b544', 'line-width': 3 },
      })
      loaded.current = true
    })
    m.on('dragstart', () => dragRef.current())
    m.on('click', (e) => clickRef.current({ lat: e.lngLat.lat, lon: e.lngLat.lng }))
    map.current = m
    return () => {
      m.remove()
      map.current = null
      loaded.current = false
      markers.current = new Map()
    }
    // The style is applied once; a changed tile source is a page reload concern (spec: config.toml).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const m = map.current
    if (!m) return
    const seen = new Set<number>()
    for (const v of vehicles.values()) {
      if (!hasPosition(v)) continue
      seen.add(v.sysid)
      const existing = markers.current.get(v.sysid)
      if (existing) {
        existing.marker.setLngLat([v.lon, v.lat])
        updateMarkerEl(existing.el, v, v.sysid === selected)
      } else {
        const el = markerEl(v, v.sysid === selected)
        const marker = new maplibregl.Marker({ element: el, anchor: 'left', offset: ARROW_OFFSET }).setLngLat([v.lon, v.lat]).addTo(m)
        markers.current.set(v.sysid, { marker, el })
      }
    }
    for (const [sysid, entry] of markers.current) {
      if (!seen.has(sysid)) {
        entry.marker.remove()
        markers.current.delete(sysid)
      }
    }
  }, [vehicles, selected])

  useEffect(() => {
    map.current?.setPadding(padding)
  }, [padding])

  useEffect(() => {
    const center = followTarget(vehicles, follow)
    if (center) map.current?.easeTo({ center, duration: 200 })
  }, [vehicles, follow])

  useEffect(() => {
    if (!loaded.current) return
    const src = map.current?.getSource(TRACKS) as { setData: (d: unknown) => void } | undefined
    src?.setData(tracksGeoJson(tracks, selected))
  }, [tracks, selected])

  useEffect(() => {
    const m = map.current
    if (!m) return
    if (!target) {
      targetMarker.current?.remove()
      targetMarker.current = null
      return
    }
    if (!targetMarker.current) {
      const el = document.createElement('div')
      el.className = 'rg-tgt'
      el.textContent = 'G'
      targetMarker.current = new maplibregl.Marker({ element: el }).setLngLat([target.lon, target.lat]).addTo(m)
    } else {
      targetMarker.current.setLngLat([target.lon, target.lat])
    }
  }, [target])

  return <div ref={container} className="map" data-testid="map" />
}
