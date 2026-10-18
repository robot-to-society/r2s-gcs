import maplibregl, { type Map as MlMap, type Marker, type StyleSpecification } from 'maplibre-gl'
import { useEffect, useRef } from 'react'
import type { FeatureCollection } from 'geojson'
import type { CameraSnapshot, Mission, VehicleState } from '../../shared/api/types'
import { hasPosition as itemHasPosition, pathGeoJson } from '../mission/geo'
import { followTarget, type Padding } from './follow'
import { footprintsGeoJson, projectedIds } from './footprints'
import { orderLayers } from './layers'
import { gimbalPose, hasPosition, homeEl, markerEl, updateMarkerEl } from './markers'
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
  /** False for the audience mini-map: no controls, no pan/zoom. */
  readonly interactive?: boolean
  /** The selected vehicle's mission (route overlay) and its current item (1-based). */
  readonly mission?: Mission | null
  readonly missionCurrent?: number | null
  /** Each vehicle's home, when known (its mission's home); drawn as `.rg-home` tiles. */
  readonly homes?: ReadonlyMap<number, LatLon>
  /** Camera snapshots for the gimbal fan (and footprint). */
  readonly cameras?: ReadonlyMap<number, CameraSnapshot>
  /** App setting 地上への投影: draw the image footprint instead of the fan where it hits the ground. */
  readonly groundProjection?: boolean
}

const HOME: [number, number] = [139.372, 36.162]
const TRACKS = 'tracks'
const GUIDED = 'guided'
const MISSION = 'mission-path'
/** The `.vmk` disc is 34 px wide at the element's left edge; pull it back so its centre sits on the position. */
const ARROW_OFFSET: [number, number] = [-17, 0]
const NO_HOMES: ReadonlyMap<number, LatLon> = new Map()
const NO_CAMERAS: ReadonlyMap<number, CameraSnapshot> = new Map()
const FOOTPRINT = 'gimbal-footprint'
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }

/** MapLibre canvas behind the floating panels (spec 10 §3.1). Pure helpers do the data work. */
export function MapView({ vehicles, tracks, follow, selected, padding, style, target, onDragStart, onClick, interactive = true, mission = null, missionCurrent = null, homes = NO_HOMES, cameras = NO_CAMERAS, groundProjection = false }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<MlMap | null>(null)
  const loaded = useRef(false)
  const markers = useRef(new Map<number, { marker: Marker; el: HTMLDivElement }>())
  const targetMarker = useRef<Marker | null>(null)
  const missionBadges = useRef<Marker[]>([])
  const homeMarkers = useRef<Marker[]>([])
  const missionRef = useRef(mission)
  missionRef.current = mission
  const dragRef = useRef(onDragStart)
  const clickRef = useRef(onClick)
  dragRef.current = onDragStart
  clickRef.current = onClick

  useEffect(() => {
    if (!container.current) return
    const m = new maplibregl.Map({ container: container.current, style, center: HOME, zoom: 14, attributionControl: { compact: true }, interactive })
    if (interactive) {
      m.addControl(new maplibregl.NavigationControl({ showZoom: false, visualizePitch: false }), 'top-right')
      m.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-right')
    }
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
      m.addSource(MISSION, { type: 'geojson', data: EMPTY })
      m.addLayer({
        id: 'mission-path-line',
        type: 'line',
        source: MISSION,
        paint: { 'line-color': ['interpolate', ['linear'], ['get', 'alt_t'], 0, '#9cc9ff', 1, '#d8a8ff'], 'line-width': 2.5, 'line-opacity': 0.9 },
      })
      m.addSource(GUIDED, { type: 'geojson', data: EMPTY })
      m.addLayer({
        id: 'guided-line',
        type: 'line',
        source: GUIDED,
        paint: { 'line-color': '#9cc9ff', 'line-width': 2, 'line-dasharray': [1, 2] },
      })
      m.addSource(FOOTPRINT, { type: 'geojson', data: EMPTY })
      m.addLayer({ id: 'gimbal-footprint', type: 'fill', source: FOOTPRINT, paint: { 'fill-color': '#5fd39b', 'fill-opacity': ['case', ['==', ['get', 'sel'], 1], 0.26, 0.14] } })
      m.addLayer({ id: 'gimbal-footprint-line', type: 'line', source: FOOTPRINT, paint: { 'line-color': '#5fd39b', 'line-width': 1.5 } })
      orderLayers(m)
      loaded.current = true
      const current = missionRef.current
      if (current) {
        const src = m.getSource(MISSION) as { setData: (d: unknown) => void } | undefined
        src?.setData(pathGeoJson(current.items, current.home))
      }
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

  const feet = groundProjection ? footprintsGeoJson(vehicles, cameras, selected) : EMPTY
  const projected = projectedIds(feet)

  useEffect(() => {
    if (!loaded.current) return
    const src = map.current?.getSource(FOOTPRINT) as { setData: (d: unknown) => void } | undefined
    src?.setData(feet)
  })

  useEffect(() => {
    const m = map.current
    if (!m) return
    const seen = new Set<number>()
    for (const v of vehicles.values()) {
      if (!hasPosition(v)) continue
      seen.add(v.sysid)
      const pose = projected.has(v.sysid) ? null : gimbalPose(v, cameras.get(v.sysid))
      const existing = markers.current.get(v.sysid)
      if (existing) {
        existing.marker.setLngLat([v.lon, v.lat])
        updateMarkerEl(existing.el, v, v.sysid === selected, pose)
      } else {
        const el = markerEl(v, v.sysid === selected, pose)
        const marker = new maplibregl.Marker({ element: el, anchor: 'left', offset: ARROW_OFFSET, rotationAlignment: 'map', opacityWhenCovered: '1' }).setLngLat([v.lon, v.lat]).addTo(m)
        markers.current.set(v.sysid, { marker, el })
      }
    }
    for (const [sysid, entry] of markers.current) {
      if (!seen.has(sysid)) {
        entry.marker.remove()
        markers.current.delete(sysid)
      }
    }
    // `projected` derives from vehicles / cameras / groundProjection
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicles, selected, cameras, groundProjection])

  // Home is its own marker (prototype), never a replacement for the vehicle glyph.
  useEffect(() => {
    const m = map.current
    if (!m) return
    homeMarkers.current.forEach((h) => h.remove())
    homeMarkers.current = [...homes.values()].map((h) => new maplibregl.Marker({ element: homeEl() }).setLngLat([h.lon, h.lat]).addTo(m))
  }, [homes])

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
    if (!loaded.current) return
    const src = map.current?.getSource(GUIDED) as { setData: (d: unknown) => void } | undefined
    const from = selected === null ? undefined : vehicles.get(selected)
    const line: FeatureCollection =
      target && from && hasPosition(from)
        ? {
            type: 'FeatureCollection',
            features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[from.lon, from.lat], [target.lon, target.lat]] } }],
          }
        : EMPTY
    src?.setData(line)
  }, [target, vehicles, selected])

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

  // Mission overlay: route line + small numbered badges, the current one highlighted (addendum §5.2).
  useEffect(() => {
    const m = map.current
    if (!m) return
    if (loaded.current) {
      const src = m.getSource(MISSION) as { setData: (d: unknown) => void } | undefined
      src?.setData(mission ? pathGeoJson(mission.items, mission.home) : EMPTY)
    }
    missionBadges.current.forEach((b) => b.remove())
    missionBadges.current = []
    if (!mission) return
    mission.items.forEach((it, i) => {
      if (!itemHasPosition(it)) return
      const el = document.createElement('div')
      el.className = `wp-mk small${i + 1 === missionCurrent ? ' current' : ''}`
      el.textContent = String(i + 1)
      missionBadges.current.push(new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([it.lon, it.lat]).addTo(m))
    })
  }, [mission, missionCurrent])

  return <div ref={container} className="map" data-testid="map" />
}
