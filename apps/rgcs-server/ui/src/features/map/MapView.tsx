import maplibregl, { type ExpressionSpecification, type Map as MlMap, type Marker, type StyleSpecification } from 'maplibre-gl'
import { useEffect, useRef, useState } from 'react'
import type { FeatureCollection } from 'geojson'
import type { Basemap, CameraSnapshot, Mission, VehicleState } from '../../shared/api/types'
import { hasPosition as itemHasPosition, pathGeoJson } from '../mission/geo'
import { followTarget, needsRecenter, type Padding } from './follow'
import { useBasemapSwap } from './basemaps'
import type { MapMode } from './mapMode'
import { useVehicleAir } from './vehicleAir'
import { MODE_EASE_MS } from './air3d'
import { courseGeoJson, metresPerPixel } from './course'
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
  /** The picked base map; a change swaps the base tiles in place. */
  readonly basemap?: Basemap
  /** 2D / 3D; 3D needs `terrainTiles`. */
  readonly mode?: MapMode
  /** Terrarium DEM tile template (`/api/settings/app`), `null` → 2D only. */
  readonly terrainTiles?: string | null
  /** Right-click: the map point and the viewport position for a menu. */
  /** One-shot centre on a vehicle (from the message log). */
  readonly focus?: { readonly sysid: number; readonly n: number } | null
  readonly onContext?: (p: { lat: number; lon: number; x: number; y: number }) => void
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
const COURSE = 'course'
const SEL: ExpressionSpecification = ['==', ['get', 'sel'], 1]
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }

/** MapLibre canvas behind the floating panels (spec 10 §3.1). Pure helpers do the data work. */
export function MapView({ vehicles, tracks, follow, selected, padding, style, target, onDragStart, onClick, interactive = true, mission = null, missionCurrent = null, homes = NO_HOMES, cameras = NO_CAMERAS, groundProjection = false, basemap, mode = '2d', terrainTiles = null, onContext, focus = null }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<MlMap | null>(null)
  const loaded = useRef(false)
  const markers = useRef(new Map<number, { marker: Marker; el: HTMLDivElement }>())
  const targetMarker = useRef<Marker | null>(null)
  const missionBadges = useRef<Marker[]>([])
  const homeMarkers = useRef(new Map<number, Marker>())
  const missionRef = useRef(mission)
  missionRef.current = mission
  const dragRef = useRef(onDragStart)
  const clickRef = useRef(onClick)
  const contextRef = useRef(onContext)
  contextRef.current = onContext
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
      m.addSource(COURSE, { type: 'geojson', data: EMPTY })
      m.addLayer({ id: 'course-nav', type: 'line', source: COURSE, filter: ['==', ['get', 'kind'], 'nav'], paint: { 'line-color': ['case', SEL, '#f2b544', '#9cc9ff'], 'line-width': 2, 'line-dasharray': [2, 2], 'line-opacity': 0.9 } })
      m.addLayer({ id: 'course-vector-casing', type: 'line', source: COURSE, filter: ['==', ['get', 'kind'], 'vector'], layout: { 'line-cap': 'round' }, paint: { 'line-color': '#0f1824', 'line-width': 6, 'line-opacity': 0.6 } })
      m.addLayer({ id: 'course-vector', type: 'line', source: COURSE, filter: ['==', ['get', 'kind'], 'vector'], layout: { 'line-cap': 'round' }, paint: { 'line-color': ['case', SEL, '#ffffff', '#9cc9ff'], 'line-width': 3, 'line-opacity': 0.95 } })
      m.addLayer({ id: 'course-target', type: 'circle', source: COURSE, filter: ['==', ['get', 'kind'], 'target'], paint: { 'circle-radius': 5, 'circle-color': ['case', SEL, '#f2b544', '#9cc9ff'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 } })
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
    m.on('zoomend', () => setZoom(m.getZoom()))
    m.on('click', (e) => clickRef.current({ lat: e.lngLat.lat, lon: e.lngLat.lng }))
    m.on('contextmenu', (e) => {
      if (!contextRef.current) return
      e.originalEvent.preventDefault()
      contextRef.current({ lat: e.lngLat.lat, lon: e.lngLat.lng, x: e.originalEvent.clientX, y: e.originalEvent.clientY })
    })
    map.current = m
    // E2E / live checks read the camera (pitch, layers) from the dev build only.
    if (import.meta.env.DEV && interactive) (window as unknown as { __rgcsMap?: MlMap }).__rgcsMap = m
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

  // Home is its own marker (prototype), never a replacement for the vehicle glyph. Keyed by vehicle
  // and moved in place: `homes` is a new Map on every telemetry frame.
  useEffect(() => {
    const m = map.current
    if (!m) return
    const markers = homeMarkers.current
    homes.forEach((h, sysid) => {
      const existing = markers.get(sysid)
      if (existing) existing.setLngLat([h.lon, h.lat])
      else markers.set(sysid, new maplibregl.Marker({ element: homeEl() }).setLngLat([h.lon, h.lat]).addTo(m))
    })
    markers.forEach((marker, sysid) => {
      if (!homes.has(sysid)) {
        marker.remove()
        markers.delete(sysid)
      }
    })
  }, [homes])

  // Compare by value: the Shell builds a new padding object on every render (10 Hz telemetry,
  // the clock), and setPadding stops a drag or zoom gesture in progress.
  const { top, right, bottom, left } = padding
  useEffect(() => {
    map.current?.setPadding({ top, right, bottom, left })
  }, [top, right, bottom, left])

  useBasemapSwap(map, loaded, basemap)
  const modeSwitchAt = useVehicleAir({ map, loaded, mode, terrainTiles, vehicles, selected, homes, tracks, markers, base: ARROW_OFFSET })
  const [zoom, setZoom] = useState(14)
  const followed = useRef<number | null>(null)
  useEffect(() => {
    const m = map.current
    const center = followTarget(vehicles, follow)
    if (!m || !center) {
      followed.current = null
      return
    }
    // An ease would cancel the 2D / 3D tilt in progress (MapLibre stops the running animation).
    if (Date.now() - modeSwitchAt.current < MODE_EASE_MS) return
    // A new follow always centres; after that, sub-pixel GPS noise is ignored (dead band).
    const fresh = followed.current !== follow
    followed.current = follow
    if (fresh || needsRecenter(m.project(m.getCenter()), m.project(center))) m.easeTo({ center, duration: 200 })
  }, [vehicles, follow])

  const focused = useRef(0)
  useEffect(() => {
    const m = map.current
    if (!m || !focus || focus.n === focused.current) return
    const v = vehicles.get(focus.sysid)
    if (!v || !hasPosition(v)) return
    focused.current = focus.n
    m.easeTo({ center: [v.lon, v.lat], duration: 600 })
  }, [focus, vehicles])

  useEffect(() => {
    if (!loaded.current) return
    const src = map.current?.getSource(COURSE) as { setData: (d: unknown) => void } | undefined
    src?.setData(courseGeoJson(vehicles, selected, metresPerPixel(zoom, map.current?.getCenter().lat ?? 36)))
  }, [vehicles, selected, zoom])

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
