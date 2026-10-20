import maplibregl, { type ExpressionSpecification, type Map as MlMap, type Marker, type StyleSpecification } from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { VehicleState } from '../../shared/api/types'
import { hasPosition as vehicleHasPosition, markerEl, updateMarkerEl } from '../map/markers'
import { hasPosition, pathGeoJson, placeTakeoffs, takeoffAnchor } from './geo'
import { badgeEl, dragDelta, handleEl, midHandles, updateBadgeEl, type ContextMenu } from './mapEdit'
import { cmdKey, isTakeoff, moveItem, moveItems, setArc, shiftAlts, type Draft, type DraftItem } from './model'
import type { Tool } from './store'
import { useBasemapSwap } from '../map/basemaps'
import type { Basemap } from '../../shared/api/types'
import { KEEP_ELEVATION, type MapMode } from '../map/mapMode'
import { altChip, useMissionAir, type MissionAir3d, type Predicted } from './missionAir'
import { attachAltDrag } from './altDrag'
import { useMissionFeet, type FeetCallbacks } from './missionFeet'
import { useBoxSelect } from './boxSelect'
import { attachArcDrag } from './arcDrag'
import { useFenceRally, type FenceEdit, type PlanTab } from './fenceMap'

interface Props {
  readonly draft: Draft
  readonly selected: ReadonlySet<number>
  readonly tool: Tool
  readonly style: StyleSpecification
  /** The picked base map; a change swaps the base tiles in place. */
  readonly basemap?: Basemap
  /** 2D / 3D; 3D needs `terrainTiles`. */
  readonly mode?: MapMode
  readonly terrainTiles?: string | null
  readonly vehicle: VehicleState | null
  /** Bump to fit the view to the mission (after loading / importing). */
  readonly fitRequest: number
  readonly onAdd: (lat: number, lon: number) => void
  readonly onInsertAfter: (uid: number, lat: number, lon: number) => void
  readonly onMove: (uid: number, lat: number, lon: number) => void
  readonly onMoveSelected: (dLat: number, dLon: number) => void
  /** 3D altitude drag: add `dAlt` metres to these items. */
  readonly onShiftAlt: (uids: ReadonlySet<number>, dAlt: number) => void
  /** Shift-drag box on the map: these items join the selection. */
  readonly onBoxSelect: (uids: number[]) => void
  /** Long press + drag on a "+": the leg into `uid` becomes an arc of `angle`° (0 = straight). */
  readonly onArc: (uid: number, angle: number) => void
  /** Mission / Fence / Rally: only the mission tab edits waypoints. */
  readonly tab?: PlanTab
  /** A map click in the fence or rally tab. */
  readonly onPlanClick: (tab: Exclude<PlanTab, 'mission'>, lat: number, lon: number) => void
  readonly onFenceEdit: (e: FenceEdit) => void
  readonly onRallyMove: (index: number, lat: number, lon: number) => void
  /** FENCE_ALT_MAX (m above home): the 3D fence walls reach it; null = no walls. */
  readonly ceiling?: number | null
  /** Move the view here (place search, 機体の位置へ); a new `seq` repeats the move. */
  readonly focus?: { readonly lat: number; readonly lon: number; readonly seq: number } | null
  /** The path the target vehicle is expected to fly for a draft (null = not predicted for it). */
  readonly predict?: ((d: Draft) => Predicted | null) | undefined
  readonly onSelect: (uid: number, additive: boolean, range: boolean) => void
  readonly onBackgroundClick: () => void
  readonly onContext: (menu: ContextMenu | null) => void
}

const HOME: [number, number] = [139.372, 36.162]
const FOCUS_ZOOM = 16
/** The `.vmk` disc centre on the position (34 px disc at the element's left edge). */
const VEHICLE_OFFSET = [-17, 0] as const
const PATH = 'mission-path'
const PREDICTED = 'mission-predicted'
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }
/** `--accent` → `--alt-hi` (spec 10 §6: the path is coloured by altitude). */
const ALT_COLOR: ExpressionSpecification = ['interpolate', ['linear'], ['get', 'alt_t'], 0, '#9cc9ff', 1, '#d8a8ff']

interface Badge {
  readonly marker: Marker
  readonly el: HTMLDivElement
}

type Callbacks = Omit<Props, 'draft' | 'selected' | 'tool' | 'style' | 'basemap' | 'vehicle' | 'fitRequest' | 'mode' | 'terrainTiles' | 'tab' | 'ceiling' | 'predict' | 'focus'>

const predictedGeoJson = (p: Predicted | null): FeatureCollection =>
  p && p.points.length > 1 ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: p.points.map((q) => [q.lon, q.lat]) } }] } : EMPTY

/** Mission editing map (2D, and 3D with altitude / position drags) (spec 10 §6, addendum §5.2): path, draggable badges, mid-leg inserts. */
export function MissionMap(props: Props) {
  const { draft, selected, tool, style, vehicle, fitRequest } = props
  const tab = props.tab ?? 'mission'
  const tabRef = useRef(tab)
  tabRef.current = tab
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<MlMap | null>(null)
  const loaded = useRef(false)
  useBasemapSwap(map, loaded, props.basemap)
  const badges = useRef(new Map<number, Badge>())
  const handles = useRef<Marker[]>([])
  const vehicleMarker = useRef<Badge | null>(null)
  /** The vehicle the view last opened over (null: none yet / the map was rebuilt). */
  const centredOn = useRef<number | null>(null)
  const cb = useRef<Callbacks>(props)
  cb.current = props
  const toolRef = useRef(tool)
  toolRef.current = tool
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const draftRef = useRef(draft)
  draftRef.current = draft
  // A drag in progress shows its result before it is committed to the draft (and the undo history).
  const [preview, setPreview] = useState<((d: Draft) => Draft) | null>(null)
  // the takeoff has no coordinates: it is drawn above the home (the plan's, else the vehicle's)
  const anchor = takeoffAnchor(draft.mission.home, vehicle)
  const [aLat, aLon] = [anchor?.lat, anchor?.lon]
  const shown = useMemo(() => {
    const d = preview ? preview(draft) : draft
    return aLat === undefined || aLon === undefined ? d : { ...d, items: placeTakeoffs(d.items, { lat: aLat, lon: aLon }) }
  }, [draft, preview, aLat, aLon])
  const air = useRef<MissionAir3d>({ is3d: false, pxPerMetre: () => null, floatVehicle: () => {} })

  useEffect(() => {
    if (!container.current) return
    const m = new maplibregl.Map({ container: container.current, style, center: HOME, zoom: 14, attributionControl: { compact: true }, boxZoom: false })
    m.addControl(new maplibregl.NavigationControl({ showZoom: false, visualizePitch: false }), 'top-right')
    m.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-right')
    m.on('load', () => {
      m.addSource(PATH, { type: 'geojson', data: EMPTY })
      m.addLayer({ id: 'mission-path-casing', type: 'line', source: PATH, paint: { 'line-color': '#0b1b2e', 'line-width': 6, 'line-opacity': 0.6 } })
      m.addLayer({ id: 'mission-path-line', type: 'line', source: PATH, paint: { 'line-color': ALT_COLOR, 'line-width': 3 } })
      // the expected flight (loiter circles, cut corners): thin, dashed and translucent over the plan
      m.addSource(PREDICTED, { type: 'geojson', data: EMPTY })
      m.addLayer({ id: 'mission-predicted-line', type: 'line', source: PREDICTED, layout: { 'line-join': 'round' }, paint: { 'line-color': '#ece6ff', 'line-width': 2, 'line-opacity': 0.75, 'line-dasharray': [2, 1.5] } })
      loaded.current = true
      // The draft may already exist (store is global): draw it as soon as the style is ready.
      const src = m.getSource(PATH) as { setData: (d: unknown) => void } | undefined
      src?.setData(pathGeoJson(draftRef.current.items, draftRef.current.mission.home))
      ;(m.getSource(PREDICTED) as { setData: (d: unknown) => void } | undefined)?.setData(predictedGeoJson(predictedRef.current))
    })
    m.on('click', (e) => {
      const t = tabRef.current
      if (t !== 'mission') return cb.current.onPlanClick(t, e.lngLat.lat, e.lngLat.lng)
      if (toolRef.current === 'add') cb.current.onAdd(e.lngLat.lat, e.lngLat.lng)
      else cb.current.onBackgroundClick()
      cb.current.onContext(null)
    })
    map.current = m
    // Live checks read the camera from the dev build only (like `__rgcsMap` on the operations map).
    if (import.meta.env.DEV) (window as unknown as { __rgcsMissionMap?: MlMap }).__rgcsMissionMap = m
    return () => {
      m.remove()
      map.current = null
      loaded.current = false
      badges.current = new Map()
      handles.current = []
      vehicleMarker.current = null
      centredOn.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const is3d = props.mode === '3d' && (props.terrainTiles ?? null) !== null

  // Path
  useEffect(() => {
    if (!loaded.current) return
    const src = map.current?.getSource(PATH) as { setData: (d: unknown) => void } | undefined
    src?.setData(pathGeoJson(shown.items, shown.mission.home))
  }, [shown])

  const predict = props.predict
  const predicted = useMemo(() => (predict ? predict(shown) : null), [predict, shown])
  const predictedRef = useRef(predicted)
  predictedRef.current = predicted
  useEffect(() => {
    if (!loaded.current) return
    const src = map.current?.getSource(PREDICTED) as { setData: (d: unknown) => void } | undefined
    src?.setData(predictedGeoJson(predicted))
  }, [predicted])

  // Badges (one per positioned item), reconciled in place
  useEffect(() => {
    const m = map.current
    if (!m) return
    const seen = new Set<number>()
    // 3D moves position with the ground foot; the TAKEOFF never moves (ArduCopter climbs in place)
    const movable = (it: DraftItem) => tab === 'mission' && !is3d && !isTakeoff(it)
    shown.items.forEach((it, i) => {
      if (!hasPosition(it)) return
      seen.add(it.uid)
      const seq = i + 1
      const existing = badges.current.get(it.uid)
      if (existing) {
        existing.marker.setLngLat([it.lon, it.lat]).setDraggable(movable(it))
        updateBadgeEl(existing.el, seq, selected.has(it.uid), cmdKey(it), is3d ? altChip(it) : null)
        return
      }
      const el = updateBadgeEl(badgeEl(seq, selected.has(it.uid), cmdKey(it)), seq, selected.has(it.uid), cmdKey(it), is3d ? altChip(it) : null)
      const marker = new maplibregl.Marker({ element: el, draggable: movable(it), anchor: 'center' }).setLngLat([it.lon, it.lat]).addTo(m)
      attachBadge(marker, el, it.uid, cb, selectedRef, draftRef)
      attachAltDrag(el, altDeps(it.uid))
      badges.current.set(it.uid, { marker, el })
    })
    for (const [uid, b] of badges.current) {
      if (!seen.has(uid)) {
        b.marker.remove()
        badges.current.delete(uid)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, selected, is3d, tab])

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
      attachArcDrag(el, h, arcDeps)
      return new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([h.lon, h.lat]).addTo(m)
    })
    // arcDeps only reads refs and setPreview: the handles need rebuilding for a new draft only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft])

  // After the map, the badges and the handles exist: effects run in declaration order.
  air.current = useMissionAir({ map, loaded, mode: props.mode ?? '2d', terrainTiles: props.terrainTiles ?? null, draft: shown, selected, badges, handles, ceiling: props.ceiling ?? null, vehicleHome: vehicleHomeOf(vehicle), predicted })
  const feetCb = useRef<FeetCallbacks>(null!)
  feetCb.current = {
    onPreview: (uid, multi, from, to) => setPreview(() => (d: Draft) => (multi ? moveItems(d, selectedRef.current, to.lat - from.lat, to.lon - from.lon) : moveItem(d, uid, to.lat, to.lon))),
    onEnd: () => setPreview(null),
    onMove: (uid, lat, lon) => cb.current.onMove(uid, lat, lon),
    onMoveSelected: (dLat, dLon) => cb.current.onMoveSelected(dLat, dLon),
    onSelect: (uid, additive, range) => cb.current.onSelect(uid, additive, range),
    origin: (uid) => itemPos(draftRef.current, uid),
  }
  // a drag cut short by the 2D / 3D switch never reports its end
  useEffect(() => setPreview(null), [is3d])
  useMissionFeet({ map, is3d, draft: shown, selected: selectedRef, cb: feetCb })
  const onFenceEdit = useRef((e: FenceEdit) => cb.current.onFenceEdit(e))
  const onRallyMove = useRef((i: number, lat: number, lon: number) => cb.current.onRallyMove(i, lat, lon))
  useFenceRally({ map, loaded, draft: shown, tab, onFenceEdit, onRallyMove })
  const onBox = useRef((uids: number[]) => cb.current.onBoxSelect(uids))
  const boxActive = useRef(tab === 'mission')
  boxActive.current = tab === 'mission'
  useBoxSelect(container, badges, onBox, boxActive)

  // The selected vehicle, for context
  useEffect(() => {
    const m = map.current
    if (!m) return
    if (!vehicle || !vehicleHasPosition(vehicle)) {
      vehicleMarker.current?.marker.remove()
      vehicleMarker.current = null
      air.current.floatVehicle(null, null, VEHICLE_OFFSET)
      return
    }
    // The planner opens over the target vehicle, and moves over another one when the target changes
    // (2026-10-20); the vehicle flying about afterwards leaves the view alone.
    if (centredOn.current !== vehicle.sysid) {
      centredOn.current = vehicle.sysid
      m.jumpTo({ center: [vehicle.lon, vehicle.lat] })
    }
    if (vehicleMarker.current) {
      vehicleMarker.current.marker.setLngLat([vehicle.lon, vehicle.lat])
      updateMarkerEl(vehicleMarker.current.el, vehicle, false)
    } else {
      const el = markerEl(vehicle, false)
      const marker = new maplibregl.Marker({ element: el, anchor: 'left', offset: [...VEHICLE_OFFSET] }).setLngLat([vehicle.lon, vehicle.lat]).addTo(m)
      vehicleMarker.current = { marker, el }
    }
    air.current.floatVehicle(vehicleMarker.current.marker, vehicle, VEHICLE_OFFSET)
  }, [vehicle])

  // Place search / 機体の位置へ
  const focusSeq = props.focus?.seq ?? 0
  useEffect(() => {
    const f = props.focus
    if (!map.current || !f) return
    map.current.jumpTo({ center: [f.lon, f.lat], zoom: FOCUS_ZOOM })
    // only a new request moves the view
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSeq])

  useEffect(() => {
    const m = map.current
    if (!m || fitRequest === 0) return
    const pts = draft.items.filter(hasPosition)
    if (pts.length === 0) return
    const bounds = pts.reduce((b, it) => b.extend([it.lon, it.lat]), new maplibregl.LngLatBounds([pts[0]!.lon, pts[0]!.lat], [pts[0]!.lon, pts[0]!.lat]))
    m.fitBounds(bounds, { padding: 80, maxZoom: 17, duration: 300, ...KEEP_ELEVATION })
    // Only the request counter triggers a fit; the draft is read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitRequest])

  const arcDeps = {
    toLatLon: (x: number, y: number) => {
      const m = map.current
      const box = container.current?.getBoundingClientRect()
      if (!m || !box) return null
      const p = m.unproject([x - box.left, y - box.top])
      return { lat: p.lat, lon: p.lng }
    },
    end: (uid: number) => {
      const it = draftRef.current.items.find((x) => x.uid === uid)
      return it ? { lat: it.lat, lon: it.lon } : null
    },
    onPreview: (uid: number, angle: number) => setPreview(() => (d: Draft) => setArc(d, uid, angle)),
    onCommit: (uid: number, angle: number) => {
      setPreview(null)
      cb.current.onArc(uid, angle)
    },
    onCancel: () => setPreview(null),
  }

  function altDeps(uid: number) {
    return {
      active: () => air.current.is3d,
      targets: () => (selectedRef.current.has(uid) && selectedRef.current.size > 1 ? selectedRef.current : new Set([uid])),
      alt: () => draftRef.current.items.find((x) => x.uid === uid)?.alt ?? 0,
      pxPerMetre: () => air.current.pxPerMetre(uid),
      onPreview: (uids: ReadonlySet<number>, dAlt: number) => setPreview(() => (d: Draft) => shiftAlts(d, uids, dAlt)),
      onCommit: (uids: ReadonlySet<number>, dAlt: number) => {
        setPreview(null)
        if (dAlt !== 0) cb.current.onShiftAlt(uids, dAlt)
      },
    }
  }

  return <div ref={container} className={`map mission-map tool-${tool} tab-${tab}${is3d ? ' is-3d' : ''}`} data-testid="mission-map" />
}

/** The vehicle's home (else its position): where FENCE_ALT_MAX is measured from. */
function vehicleHomeOf(v: VehicleState | null): { lat: number; lon: number } | null {
  if (!v) return null
  if (v.home && !(v.home.lat === 0 && v.home.lon === 0)) return { lat: v.home.lat, lon: v.home.lon }
  return v.lat === 0 && v.lon === 0 ? null : { lat: v.lat, lon: v.lon }
}

function itemPos(d: Draft, uid: number): { lat: number; lon: number } | null {
  const it = d.items.find((x) => x.uid === uid)
  return it ? { lat: it.lat, lon: it.lon } : null
}

function attachBadge(marker: Marker, el: HTMLDivElement, uid: number, cb: React.RefObject<Callbacks>, selected: React.RefObject<ReadonlySet<number>>, draft: React.RefObject<Draft>): void {
  let start: { lat: number; lon: number } | null = null
  let multi = false
  marker.on('dragstart', () => {
    // MapLibre has already moved the marker by the first step: count from the item itself
    const p = marker.getLngLat()
    start = itemPos(draft.current, uid) ?? { lat: p.lat, lon: p.lng }
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
    cb.current.onSelect(uid, e.metaKey || e.ctrlKey, e.shiftKey)
  })
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    e.stopPropagation()
    cb.current.onContext({ uid, x: e.clientX, y: e.clientY })
  })
}
