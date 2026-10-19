import maplibregl, { type ExpressionSpecification, type Map as MlMap, type Marker, type StyleSpecification } from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import { useEffect, useRef } from 'react'
import type { VehicleState } from '../../shared/api/types'
import { hasPosition as vehicleHasPosition, markerEl, updateMarkerEl } from '../map/markers'
import { hasPosition, pathGeoJson } from './geo'
import { badgeEl, dragDelta, handleEl, midHandles, updateBadgeEl, type ContextMenu } from './mapEdit'
import { cmdKey, type Draft } from './model'
import type { Tool } from './store'
import { useBasemapSwap } from '../map/basemaps'
import type { Basemap } from '../../shared/api/types'

interface Props {
  readonly draft: Draft
  readonly selected: ReadonlySet<number>
  readonly tool: Tool
  readonly style: StyleSpecification
  /** The picked base map; a change swaps the base tiles in place. */
  readonly basemap?: Basemap
  readonly vehicle: VehicleState | null
  /** Bump to fit the view to the mission (after loading / importing). */
  readonly fitRequest: number
  readonly onAdd: (lat: number, lon: number) => void
  readonly onInsertAfter: (uid: number, lat: number, lon: number) => void
  readonly onMove: (uid: number, lat: number, lon: number) => void
  readonly onMoveSelected: (dLat: number, dLon: number) => void
  readonly onSelect: (uid: number, additive: boolean, range: boolean) => void
  readonly onBackgroundClick: () => void
  readonly onContext: (menu: ContextMenu | null) => void
}

const HOME: [number, number] = [139.372, 36.162]
const PATH = 'mission-path'
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }
/** `--accent` → `--alt-hi` (spec 10 §6: the path is coloured by altitude). */
const ALT_COLOR: ExpressionSpecification = ['interpolate', ['linear'], ['get', 'alt_t'], 0, '#9cc9ff', 1, '#d8a8ff']

interface Badge {
  readonly marker: Marker
  readonly el: HTMLDivElement
}

type Callbacks = Omit<Props, 'draft' | 'selected' | 'tool' | 'style' | 'basemap' | 'vehicle' | 'fitRequest'>

/** 2D mission editing layer (spec 10 §6, addendum §5.2): path, draggable badges, mid-leg inserts. */
export function MissionMap(props: Props) {
  const { draft, selected, tool, style, vehicle, fitRequest } = props
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<MlMap | null>(null)
  const loaded = useRef(false)
  useBasemapSwap(map, loaded, props.basemap)
  const badges = useRef(new Map<number, Badge>())
  const handles = useRef<Marker[]>([])
  const vehicleMarker = useRef<Badge | null>(null)
  const cb = useRef<Callbacks>(props)
  cb.current = props
  const toolRef = useRef(tool)
  toolRef.current = tool
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const draftRef = useRef(draft)
  draftRef.current = draft

  useEffect(() => {
    if (!container.current) return
    const m = new maplibregl.Map({ container: container.current, style, center: HOME, zoom: 14, attributionControl: { compact: true }, boxZoom: false })
    m.addControl(new maplibregl.NavigationControl({ showZoom: false, visualizePitch: false }), 'top-right')
    m.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-right')
    m.on('load', () => {
      m.addSource(PATH, { type: 'geojson', data: EMPTY })
      m.addLayer({ id: 'mission-path-casing', type: 'line', source: PATH, paint: { 'line-color': '#0b1b2e', 'line-width': 6, 'line-opacity': 0.6 } })
      m.addLayer({ id: 'mission-path-line', type: 'line', source: PATH, paint: { 'line-color': ALT_COLOR, 'line-width': 3 } })
      loaded.current = true
      // The draft may already exist (store is global): draw it as soon as the style is ready.
      const src = m.getSource(PATH) as { setData: (d: unknown) => void } | undefined
      src?.setData(pathGeoJson(draftRef.current.items, draftRef.current.mission.home))
    })
    m.on('click', (e) => {
      if (toolRef.current === 'add') cb.current.onAdd(e.lngLat.lat, e.lngLat.lng)
      else cb.current.onBackgroundClick()
      cb.current.onContext(null)
    })
    map.current = m
    return () => {
      m.remove()
      map.current = null
      loaded.current = false
      badges.current = new Map()
      handles.current = []
      vehicleMarker.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Path
  useEffect(() => {
    if (!loaded.current) return
    const src = map.current?.getSource(PATH) as { setData: (d: unknown) => void } | undefined
    src?.setData(pathGeoJson(draft.items, draft.mission.home))
  }, [draft])

  // Badges (one per positioned item), reconciled in place
  useEffect(() => {
    const m = map.current
    if (!m) return
    const seen = new Set<number>()
    draft.items.forEach((it, i) => {
      if (!hasPosition(it)) return
      seen.add(it.uid)
      const seq = i + 1
      const existing = badges.current.get(it.uid)
      if (existing) {
        existing.marker.setLngLat([it.lon, it.lat])
        updateBadgeEl(existing.el, seq, selected.has(it.uid), cmdKey(it))
        return
      }
      const el = badgeEl(seq, selected.has(it.uid), cmdKey(it))
      const marker = new maplibregl.Marker({ element: el, draggable: true, anchor: 'center' }).setLngLat([it.lon, it.lat]).addTo(m)
      attachBadge(marker, el, it.uid, cb, selectedRef)
      badges.current.set(it.uid, { marker, el })
    })
    for (const [uid, b] of badges.current) {
      if (!seen.has(uid)) {
        b.marker.remove()
        badges.current.delete(uid)
      }
    }
  }, [draft, selected])

  // Mid-leg handles are rebuilt on every draft change (cheap: ≤ 700)
  useEffect(() => {
    const m = map.current
    if (!m) return
    handles.current.forEach((h) => h.remove())
    handles.current = midHandles(draft).map((h) => {
      const el = handleEl()
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        cb.current.onInsertAfter(h.afterUid, h.lat, h.lon)
      })
      return new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([h.lon, h.lat]).addTo(m)
    })
  }, [draft])

  // The selected vehicle, for context
  useEffect(() => {
    const m = map.current
    if (!m) return
    if (!vehicle || !vehicleHasPosition(vehicle)) {
      vehicleMarker.current?.marker.remove()
      vehicleMarker.current = null
      return
    }
    if (vehicleMarker.current) {
      vehicleMarker.current.marker.setLngLat([vehicle.lon, vehicle.lat])
      updateMarkerEl(vehicleMarker.current.el, vehicle, false)
    } else {
      const el = markerEl(vehicle, false)
      const marker = new maplibregl.Marker({ element: el, anchor: 'left', offset: [-17, 0] }).setLngLat([vehicle.lon, vehicle.lat]).addTo(m)
      vehicleMarker.current = { marker, el }
    }
  }, [vehicle])

  useEffect(() => {
    const m = map.current
    if (!m || fitRequest === 0) return
    const pts = draft.items.filter(hasPosition)
    if (pts.length === 0) return
    const bounds = pts.reduce((b, it) => b.extend([it.lon, it.lat]), new maplibregl.LngLatBounds([pts[0]!.lon, pts[0]!.lat], [pts[0]!.lon, pts[0]!.lat]))
    m.fitBounds(bounds, { padding: 80, maxZoom: 17, duration: 300 })
    // Only the request counter triggers a fit; the draft is read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitRequest])

  return <div ref={container} className={`map mission-map tool-${tool}`} data-testid="mission-map" />
}

function attachBadge(marker: Marker, el: HTMLDivElement, uid: number, cb: React.RefObject<Callbacks>, selected: React.RefObject<ReadonlySet<number>>): void {
  let start: { lat: number; lon: number } | null = null
  let multi = false
  marker.on('dragstart', () => {
    const p = marker.getLngLat()
    start = { lat: p.lat, lon: p.lng }
    multi = selected.current.has(uid) && selected.current.size > 1
  })
  marker.on('dragend', () => {
    const p = marker.getLngLat()
    if (multi && start) {
      const d = dragDelta(start, { lat: p.lat, lon: p.lng })
      cb.current.onMoveSelected(d.dLat, d.dLon)
    } else {
      cb.current.onMove(uid, p.lat, p.lng)
    }
    start = null
  })
  el.addEventListener('click', (e) => {
    e.stopPropagation()
    cb.current.onSelect(uid, e.shiftKey, e.metaKey || e.ctrlKey)
  })
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    e.stopPropagation()
    cb.current.onContext({ uid, x: e.clientX, y: e.clientY })
  })
}
