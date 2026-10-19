import { act, render } from '@testing-library/react'
import { StrictMode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CameraSnapshot, VehicleState } from '../../shared/api/types'

const created = { maps: [] as FakeMap[], markers: [] as FakeMarker[], deferLoad: false }

class FakeMarker {
  el: HTMLElement
  lngLat: [number, number] | null = null
  removed = false
  opts: Record<string, unknown>
  constructor(opts: { element: HTMLElement }) {
    this.el = opts.element
    this.opts = opts
    created.markers.push(this)
  }
  setLngLat(ll: [number, number]) {
    this.lngLat = ll
    return this
  }
  getLngLat() {
    return { lng: this.lngLat?.[0] ?? 0, lat: this.lngLat?.[1] ?? 0 }
  }
  offset: [number, number] | null = null
  setOffset(o: [number, number]) {
    this.offset = o
    return this
  }
  map: FakeMap | null = null
  addTo(m: FakeMap) {
    this.map = m
    return this
  }
  remove() {
    this.removed = true
  }
  /** On the page: not removed, and its map not torn down (MapLibre drops a removed map's markers). */
  get live() {
    return !this.removed && !this.map?.gone
  }
}

class FakeMap {
  handlers = new Map<string, ((e?: unknown) => void)[]>()
  padding: unknown = null
  eased: unknown[] = []
  sources = new Map<string, { setData: ReturnType<typeof vi.fn> }>()
  constructor() {
    created.maps.push(this)
  }
  terrain: unknown = 'unset'
  layerObjs = new Map<string, unknown>()
  visibility = new Map<string, string>()
  once(ev: string, cb: (e?: unknown) => void) {
    this.on(ev, cb)
  }
  stop() {}
  setTerrain(t: unknown) {
    this.terrain = t
  }
  setLayoutProperty(id: string, _k: string, v: string) {
    this.visibility.set(id, v)
  }
  triggerRepaint() {}
  getContainer() {
    return { clientWidth: 800, clientHeight: 600 }
  }
  on(ev: string, cb: (e?: unknown) => void) {
    this.handlers.set(ev, [...(this.handlers.get(ev) ?? []), cb])
    if (ev === 'load' && !created.deferLoad) cb()
  }
  fire(ev: string, e?: unknown) {
    this.handlers.get(ev)?.forEach((cb) => cb(e))
  }
  addControl() {}
  addSource(id: string) {
    this.sources.set(id, { setData: vi.fn() })
  }
  layers: string[] = []
  addLayer(l: { id: string }, before?: string) {
    this.layerObjs.set(l.id, l)
    if (before && this.layers.includes(before)) this.layers.splice(this.layers.indexOf(before), 0, l.id)
    else this.layers.push(l.id)
  }
  removeLayer(id: string) {
    this.layers = this.layers.filter((x) => x !== id)
  }
  removeSource(id: string) {
    this.sources.delete(id)
  }
  getStyle() {
    return { layers: this.layers.map((id) => ({ id })) }
  }
  /** MapLibre reports false while tiles are loading, even after 'load'. */
  isStyleLoaded() {
    return false
  }
  getLayer(id: string) {
    return this.layers.includes(id) ? { id } : undefined
  }
  moveLayer(id: string) {
    this.layers = [...this.layers.filter((x) => x !== id), id]
  }
  getSource(id: string) {
    return this.sources.get(id)
  }
  paddingCalls = 0
  setPadding(p: unknown) {
    this.padding = p
    this.paddingCalls += 1
  }
  center: [number, number] = [139.372, 36.162]
  bearing = 0
  easeTo(o: { center?: [number, number]; bearing?: number }) {
    this.eased.push(o)
    if (o.center) this.center = o.center
    if (o.bearing !== undefined) this.bearing = o.bearing
  }
  getBearing() {
    return this.bearing
  }
  jumps: unknown[] = []
  jumpTo(o: unknown) {
    this.jumps.push(o)
  }
  clamped = true
  setCenterClampedToGround(c: boolean) {
    this.clamped = c
  }
  getCenter() {
    return { lng: this.center[0], lat: this.center[1] }
  }
  /** 1 px per 1e-6 degree: enough to test the follow dead band. */
  project(ll: { lng: number; lat: number } | [number, number]) {
    const [lng, lat] = Array.isArray(ll) ? ll : [ll.lng, ll.lat]
    return { x: lng * 1e6, y: -lat * 1e6 }
  }
  gone = false
  remove() {
    this.gone = true
  }
}

vi.mock('maplibre-gl', () => ({
  default: { Map: FakeMap, Marker: FakeMarker, NavigationControl: class {}, ScaleControl: class {} },
}))

const { MapView } = await import('./MapView')
const { rasterStyle } = await import('./style')

const v = (sysid: number, fix: number, lon = 139.37, lat = 36.16): VehicleState => ({
  sysid, name: `UAV-0${sysid}`, kind: 'copter', mode: 'AUTO', armed: true, lat, lon, alt_rel: 50, alt_msl: 0, hdg: 10,
  ground_speed: 0, climb: 0, battery: { pct: 50, volt: 22, current: null }, link: 'ok', last_rx_ms: 0,
  gps: { fix, sats: 10, hdop: 1 }, warn: false, unread: 0,
})

const style = rasterStyle('https://t/{z}/{x}/{y}.png', 'x')
const pad = { top: 72, left: 320, right: 0, bottom: 60 }

describe('MapView', () => {
  beforeEach(() => {
    created.maps = []
    created.markers = []
    created.deferLoad = false
  })

  it('mission_path_is_set_when_the_style_loads_late', () => {
    created.deferLoad = true
    const item = (command: number, lat: number, lon: number, alt: number) => ({ command, frame: 'rel' as const, params: [0, 0, 0, 0] as [number, number, number, number], lat, lon, alt, autocontinue: true })
    const mission = { id: 1, name: 'm', sysid: 1, default_alt: 60, default_frame: 'rel' as const, speed: 8, home: null, fence: [], rally: [], items: [item(22, 36.162, 139.372, 30), item(16, 36.163, 139.373, 60)] }
    render(
      <MapView vehicles={new Map()} tracks={new Map()} follow={null} selected={null} padding={pad} style={style} onDragStart={() => {}} onClick={() => {}} target={null} mission={mission} missionCurrent={null} />,
    )
    const map = created.maps[0]!
    act(() => map.fire('load'))
    const last = map.sources.get('mission-path')!.setData.mock.calls.at(-1)![0] as { features: unknown[] }
    expect(last.features).toHaveLength(1)
  })

  it('creates markers only for positioned vehicles and removes them when they vanish', () => {
    const vehicles = new Map([[1, v(1, 3)], [2, v(2, 0)]])
    const { rerender } = render(
      <MapView vehicles={vehicles} tracks={new Map()} follow={null} selected={1} padding={pad} style={style} onDragStart={() => {}} onClick={() => {}} target={null} />,
    )
    expect(created.maps).toHaveLength(1)
    expect(created.markers).toHaveLength(1)
    expect(created.markers[0]!.lngLat).toEqual([139.37, 36.16])
    expect(created.markers[0]!.el.className).toBe('rg-mk sel')
    rerender(
      <MapView vehicles={new Map()} tracks={new Map()} follow={null} selected={null} padding={pad} style={style} onDragStart={() => {}} onClick={() => {}} target={null} />,
    )
    expect(created.markers[0]!.removed).toBe(true)
  })

  it('applies padding changes and eases to the followed vehicle', () => {
    const vehicles = new Map([[1, v(1, 3)]])
    const { rerender } = render(
      <MapView vehicles={vehicles} tracks={new Map()} follow={1} selected={null} padding={pad} style={style} onDragStart={() => {}} onClick={() => {}} target={null} />,
    )
    const map = created.maps[0]!
    expect(map.padding).toEqual(pad)
    expect(map.eased.at(-1)).toMatchObject({ center: [139.37, 36.16], duration: 200, freezeElevation: true })
    const moved = new Map([[1, v(1, 3, 139.38, 36.17)]])
    const pad2 = { ...pad, right: 396 }
    rerender(
      <MapView vehicles={moved} tracks={new Map()} follow={1} selected={null} padding={pad2} style={style} onDragStart={() => {}} onClick={() => {}} target={null} />,
    )
    expect(map.padding).toEqual(pad2)
    expect(map.eased.at(-1)).toMatchObject({ center: [139.38, 36.17] })
  })

  it('draws the guided line from the selected vehicle to the target', () => {
    const vehicles = new Map([[1, v(1, 3)]])
    const target = { lat: 36.2, lon: 139.4 }
    render(
      <MapView vehicles={vehicles} tracks={new Map()} follow={null} selected={1} padding={pad} style={style} onDragStart={() => {}} onClick={() => {}} target={target} />,
    )
    const src = created.maps[0]!.sources.get('guided')!
    const last = src.setData.mock.calls.at(-1)![0] as { features: { geometry: { coordinates: number[][] } }[] }
    expect(last.features[0]?.geometry.coordinates).toEqual([[139.37, 36.16], [139.4, 36.2]])
    expect(created.markers.some((m) => m.el.className === 'rg-tgt')).toBe(true)
  })

  it('reports drag start so the shell can release follow', () => {
    const onDragStart = vi.fn()
    render(
      <MapView vehicles={new Map()} tracks={new Map()} follow={null} selected={null} padding={pad} style={style} onDragStart={onDragStart} onClick={() => {}} target={null} />,
    )
    act(() => created.maps[0]!.fire('dragstart'))
    expect(onDragStart).toHaveBeenCalledTimes(1)
  })

  it('map_draws_the_mission_path_and_highlights_the_current_badge', () => {
    const item = (command: number, lat: number, lon: number, alt: number) => ({ command, frame: 'rel' as const, params: [0, 0, 0, 0] as [number, number, number, number], lat, lon, alt, autocontinue: true })
    const mission = {
      id: 1, name: 'm', sysid: 1, default_alt: 60, default_frame: 'rel' as const, speed: 8, home: null, fence: [], rally: [],
      items: [item(22, 36.162, 139.372, 30), item(16, 36.163, 139.373, 60), item(16, 36.164, 139.374, 60), item(20, 0, 0, 0)],
    }
    render(
      <MapView vehicles={new Map()} tracks={new Map()} follow={null} selected={null} padding={pad} style={style} onDragStart={() => {}} onClick={() => {}} target={null} mission={mission} missionCurrent={2} />,
    )
    const src = created.maps[0]!.sources.get('mission-path')!
    const last = src.setData.mock.calls.at(-1)![0] as { features: unknown[] }
    expect(last.features).toHaveLength(2)
    const badges = created.markers.filter((m) => m.el.classList.contains('wp-mk'))
    expect(badges).toHaveLength(3)
    expect(badges.map((b) => b.el.className)).toEqual(['wp-mk small', 'wp-mk small current', 'wp-mk small'])
    expect(badges[1]!.el.textContent).toBe('2')
  })
  it('stacks the mission path below the tracks below the guided line once loaded', () => {
    render(<MapView vehicles={new Map()} tracks={new Map()} follow={null} selected={null} padding={pad} style={style} target={null} onDragStart={() => {}} onClick={() => {}} />)
    expect(created.maps.at(-1)!.layers).toEqual(['mission-path-line', 'tracks-others', 'tracks-selected', 'guided-line', 'course-nav', 'course-vector-casing', 'course-vector', 'course-target', 'gimbal-footprint', 'gimbal-footprint-line'])
  })

  it('places vehicle markers like the prototype and a home tile per known home', () => {
    const homes = new Map([[1, { lat: 36.161, lon: 139.371 }]])
    const { rerender } = render(
      <MapView vehicles={new Map([[1, v(1, 3)]])} tracks={new Map()} follow={null} selected={null} padding={pad} style={style} target={null} homes={homes} onDragStart={() => {}} onClick={() => {}} />,
    )
    const vehicle = created.markers.find((m) => m.el.classList.contains('rg-mk'))!
    expect(vehicle.opts).toMatchObject({ anchor: 'left', offset: [-17, 0], rotationAlignment: 'map', opacityWhenCovered: '1' })
    const home = created.markers.find((m) => m.el.className === 'rg-home')!
    expect(home.lngLat).toEqual([139.371, 36.161])
    rerender(<MapView vehicles={new Map([[1, v(1, 3)]])} tracks={new Map()} follow={null} selected={null} padding={pad} style={style} target={null} homes={new Map()} onDragStart={() => {}} onClick={() => {}} />)
    expect(home.removed).toBe(true)
  })
  it('draws the gimbal fan, or the ground footprint instead when projection is on', () => {
    const cam = {
      sysid: 1,
      caps: { kind: 'siyi_mt11', gimbal: { rate: true, angle: true, center: true, modes: [], attitude: true, pitch_range: [-90, 30] }, zoom: null, focus: false, photo: false, record: false, video_modes: [], hfov_deg: 62 },
      state: { connected: true, last_error: null, firmware: null, recording: 'idle', zoom: 1, zoom_max: 1, video_mode: null, gimbal: { yaw: 0, pitch: -45, roll: 0, age_ms: 0 }, gimbal_mode: null, stream: null },
    } as unknown as CameraSnapshot
    const vehicles = new Map([[1, { ...v(1, 3), alt_rel: 100 }]])
    const cameras = new Map([[1, cam]])
    const props = { vehicles, tracks: new Map(), follow: null, selected: 1, padding: pad, style, target: null, cameras, onDragStart: () => {}, onClick: () => {} }
    const { rerender } = render(<MapView {...props} />)
    const fan = () => created.markers.find((m) => m.el.classList.contains('rg-mk'))!.el.querySelector('svg.fov') as SVGElement
    const foot = created.maps.at(-1)!.sources.get('gimbal-footprint')!
    expect(fan().style.display).toBe('')
    expect(foot.setData.mock.calls.at(-1)?.[0].features).toHaveLength(0)
    rerender(<MapView {...props} groundProjection />)
    expect(fan().style.display).toBe('none')
    expect(foot.setData.mock.calls.at(-1)?.[0].features).toHaveLength(1)
  })
  it('re-renders with an equal padding do not call setPadding (it cancels a drag in progress)', () => {
    const props = { vehicles: new Map(), tracks: new Map(), follow: null, selected: null, style, target: null, onDragStart: () => {}, onClick: () => {} }
    const { rerender } = render(<MapView {...props} padding={{ ...pad }} />)
    const m = created.maps.at(-1)!
    const calls = m.paddingCalls
    rerender(<MapView {...props} padding={{ ...pad }} />)
    rerender(<MapView {...props} padding={{ ...pad }} />)
    expect(m.paddingCalls).toBe(calls)
    rerender(<MapView {...props} padding={{ ...pad, right: 400 }} />)
    expect(m.paddingCalls).toBe(calls + 1)
  })
  it('following ignores a hovering vehicle\'s GPS jitter so the map (and its waypoints) stay still', () => {
    const at = (lon: number, lat: number) => new Map([[1, v(1, 3, lon, lat)]])
    const props = { tracks: new Map(), follow: 1, selected: null, padding: pad, style, target: null, onDragStart: () => {}, onClick: () => {} }
    const { rerender } = render(<MapView {...props} vehicles={at(139.37, 36.16)} />)
    const map = created.maps.at(-1)!
    const eased = map.eased.length
    rerender(<MapView {...props} vehicles={at(139.370001, 36.160002)} />) // ~2 px
    expect(map.eased.length).toBe(eased)
    rerender(<MapView {...props} vehicles={at(139.37003, 36.16)} />) // 30 px
    expect(map.eased.length).toBe(eased + 1)
  })
  it('draws the course vector and navigation line of moving vehicles', () => {
    const moving = new Map([[1, { ...v(1, 3), cog: 45, ground_speed: 6, mode: 'AUTO', nav: { target_bearing: 45, wp_dist: 200 } }]])
    render(<MapView vehicles={moving} tracks={new Map()} follow={null} selected={1} padding={pad} style={style} target={null} onDragStart={() => {}} onClick={() => {}} />)
    const data = created.maps.at(-1)!.sources.get('course')!.setData.mock.calls.at(-1)?.[0]
    expect(data.features.map((f: { properties: { kind: string } }) => f.properties.kind)).toEqual(['nav', 'target', 'vector'])
  })
  it('switching the base map swaps the base tiles even while tiles are loading', () => {
    const osm = { id: 'map', label: '地図', tiles: ['https://osm/{z}/{x}/{y}.png'], attribution: '', max_zoom: 19, overlay: null }
    const sat = { id: 'satellite', label: '衛星写真', tiles: ['https://esri/{z}/{y}/{x}'], attribution: '', max_zoom: 19, overlay: ['https://lbl/{z}/{x}/{y}.png'] }
    const props = { vehicles: new Map(), tracks: new Map(), follow: null, selected: null, padding: pad, style, target: null, onDragStart: () => {}, onClick: () => {} }
    const { rerender } = render(<MapView {...props} basemap={osm} />)
    const m = created.maps.at(-1)!
    rerender(<MapView {...props} basemap={sat} />)
    expect(m.layers.slice(0, 2)).toEqual(['base', 'labels'])
    expect(m.sources.has('labels')).toBe(true)
  })
  it('home markers survive re-renders with equal homes (telemetry rebuilds the map every frame)', () => {
    const props = { vehicles: new Map(), tracks: new Map(), follow: null, selected: null, padding: pad, style, target: null, onDragStart: () => {}, onClick: () => {} }
    const { rerender } = render(<MapView {...props} homes={new Map([[1, { lat: 36.1, lon: 139.3 }]])} />)
    const home = created.markers.find((m) => m.el.className === 'rg-home')!
    rerender(<MapView {...props} homes={new Map([[1, { lat: 36.1, lon: 139.3 }]])} />)
    expect(home.removed).toBe(false)
    expect(created.markers.filter((m) => m.el.className === 'rg-home')).toHaveLength(1)
    rerender(<MapView {...props} homes={new Map([[1, { lat: 36.2, lon: 139.3 }]])} />)
    expect(home.lngLat).toEqual([139.3, 36.2])
  })
  it('3D adds the terrain, the vehicle posts layer and tilts the camera', () => {
    const props = { vehicles: new Map([[1, { ...v(1, 3), alt_rel: 40 }]]), tracks: new Map(), follow: null, selected: 1, padding: pad, style, target: null, onDragStart: () => {}, onClick: () => {} }
    const { rerender } = render(<MapView {...props} terrainTiles="https://dem/{z}/{x}/{y}.png" mode="2d" />)
    const m = created.maps.at(-1)!
    expect(m.sources.has('dem')).toBe(true)
    expect(m.layers).toContain('veh-air3d')
    expect(m.terrain).toBeNull()
    rerender(<MapView {...props} terrainTiles="https://dem/{z}/{x}/{y}.png" mode="3d" />)
    expect(m.terrain).toEqual({ source: 'dem', exaggeration: 1 })
    expect(m.eased.at(-1)).toMatchObject({ pitch: 60, bearing: -25 })
    expect(m.visibility.get('veh-ground')).toBe('visible')
    expect((m.layerObjs.get('veh-air3d') as { visible: boolean }).visible).toBe(true)
  })
  it('without terrain tiles there is no 3D', () => {
    render(<MapView vehicles={new Map()} tracks={new Map()} follow={null} selected={null} padding={pad} style={style} target={null} onDragStart={() => {}} onClick={() => {}} mode="3d" terrainTiles={null} />)
    const m = created.maps.at(-1)!
    expect(m.sources.has('dem')).toBe(false)
    expect(m.layers).not.toContain('veh-air3d')
  })
  it('right-click reports the point and the screen position', () => {
    const onContext = vi.fn()
    render(<MapView vehicles={new Map()} tracks={new Map()} follow={null} selected={null} padding={pad} style={style} target={null} onDragStart={() => {}} onClick={() => {}} onContext={onContext} />)
    const preventDefault = vi.fn()
    act(() => created.maps.at(-1)!.fire('contextmenu', { lngLat: { lat: 36.1, lng: 139.3 }, originalEvent: { clientX: 40, clientY: 50, preventDefault } }))
    expect(onContext).toHaveBeenCalledWith({ lat: 36.1, lon: 139.3, x: 40, y: 50 })
  })
  it('a focus request centres the map on that vehicle once per request', () => {
    const vehicles = new Map([[2, v(2, 3, 139.39, 36.17)]])
    const props = { vehicles, tracks: new Map(), follow: null, selected: null, padding: pad, style, target: null, onDragStart: () => {}, onClick: () => {} }
    const { rerender } = render(<MapView {...props} focus={null} />)
    const m = created.maps.at(-1)!
    const before = m.eased.length
    rerender(<MapView {...props} focus={{ sysid: 2, n: 1 }} />)
    expect(m.eased.at(-1)).toMatchObject({ center: [139.39, 36.17], freezeElevation: true })
    rerender(<MapView {...props} focus={{ sysid: 2, n: 1 }} vehicles={new Map([[2, v(2, 3, 139.4, 36.2)]])} />)
    expect(m.eased.length).toBe(before + 1)
  })
  it('following does not cancel the 2D → 3D camera tilt; it resumes once the tilt is done', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(1_000_000)
      const at = (lon: number) => new Map([[1, v(1, 3, lon, 36.16)]])
      const props = { tracks: new Map(), follow: 1, selected: 1, padding: pad, style, target: null, onDragStart: () => {}, onClick: () => {}, terrainTiles: 'https://dem/{z}/{x}/{y}.png' }
      const { rerender } = render(<MapView {...props} vehicles={at(139.37)} mode="2d" />)
      const m = created.maps.at(-1)!
      rerender(<MapView {...props} vehicles={at(139.37)} mode="3d" />)
      expect(m.eased.at(-1)).toMatchObject({ pitch: 60 })
      vi.setSystemTime(1_000_300)
      rerender(<MapView {...props} vehicles={at(139.3701)} mode="3d" />) // 100 px away
      expect(m.eased.at(-1)).toMatchObject({ pitch: 60 })
      vi.setSystemTime(1_001_000)
      rerender(<MapView {...props} vehicles={at(139.3702)} mode="3d" />)
      expect(m.eased.at(-1)).toMatchObject({ center: [139.3702, 36.16] })
    } finally {
      vi.useRealTimers()
    }
  })
  it('2D never downloads DEM tiles', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 404 }))
    try {
      const props = { vehicles: new Map([[1, { ...v(1, 3), alt_rel: 40 }]]), tracks: new Map(), follow: null, selected: 1, padding: pad, style, target: null, onDragStart: () => {}, onClick: () => {} }
      const { rerender } = render(<MapView {...props} terrainTiles="https://dem/{z}/{x}/{y}.png" mode="2d" homes={new Map([[1, { lat: 36.16, lon: 139.37 }]])} />)
      rerender(<MapView {...props} vehicles={new Map([[1, { ...v(1, 3, 139.371), alt_rel: 41 }]])} terrainTiles="https://dem/{z}/{x}/{y}.png" mode="2d" homes={new Map([[1, { lat: 36.16, lon: 139.37 }]])} />)
      expect(fetchSpy).not.toHaveBeenCalled()
      rerender(<MapView {...props} terrainTiles="https://dem/{z}/{x}/{y}.png" mode="3d" homes={new Map([[1, { lat: 36.16, lon: 139.37 }]])} />)
      expect(fetchSpy).toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('keeps the home tile and the Guided target on the live map under StrictMode (the first map is thrown away)', () => {
    created.markers = []
    render(
      <StrictMode>
        <MapView vehicles={new Map([[1, v(1, 3)]])} tracks={new Map()} follow={null} selected={1} padding={pad} style={style} target={{ lat: 36.17, lon: 139.38 }} homes={new Map([[1, { lat: 36.161, lon: 139.371 }]])} onDragStart={() => {}} onClick={() => {}} />
      </StrictMode>,
    )
    const live = (pred: (m: (typeof created.markers)[number]) => boolean) => created.markers.filter((m) => pred(m) && m.live)
    expect(live((m) => m.el.className === 'rg-home')).toHaveLength(1)
    expect(live((m) => m.lngLat?.[0] === 139.38 && m.lngLat?.[1] === 36.17)).toHaveLength(1)
  })

  it('3D shows the mission like the planner (badges floated, 2D route and 2D tracks hidden), display only', () => {
    const item = (command: number, lat: number, alt: number) => ({ command, frame: 'rel' as const, params: [0, 0, 0, 0] as [number, number, number, number], lat, lon: 139.372, alt, autocontinue: true })
    const mission = { id: 1, name: 'm', sysid: 1, default_alt: 60, default_frame: 'rel' as const, speed: 8, home: null, fence: [], rally: [], items: [item(22, 36.162, 30), item(16, 36.163, 60)] }
    const props = { vehicles: new Map(), tracks: new Map(), follow: null, selected: 1, padding: pad, style, target: null, onDragStart: () => {}, onClick: () => {}, mission, missionCurrent: 2 }
    const { rerender } = render(<MapView {...props} terrainTiles="https://dem/{z}/{x}/{y}.png" mode="3d" />)
    const m = created.maps.at(-1)!
    expect(m.visibility.get('mission-path-line')).toBe('none')
    expect(m.visibility.get('tracks-others')).toBe('none')
    expect(m.visibility.get('tracks-selected')).toBe('none')
    // a new mission rebuilds the badges: they float too
    rerender(<MapView {...props} mission={{ ...mission, items: [...mission.items, item(16, 36.164, 60)] }} terrainTiles="https://dem/{z}/{x}/{y}.png" mode="3d" />)
    const layer = m.layerObjs.get('veh-air3d') as { onFrame: (mx: number[]) => void }
    layer.onFrame([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
    const badges = created.markers.filter((mk) => mk.el.classList.contains('wp-mk') && mk.live)
    expect(badges).toHaveLength(3)
    expect(badges.every((b) => b.offset !== null)).toBe(true)
    expect(badges.every((b) => !b.opts.draggable)).toBe(true)
    rerender(<MapView {...props} terrainTiles="https://dem/{z}/{x}/{y}.png" mode="2d" />)
    expect(m.visibility.get('mission-path-line')).toBe('visible')
  })

  it('3D follow looks from behind and above: the camera centre rises to the vehicle and turns with its heading', () => {
    const flying = { ...v(1, 3), alt_rel: 120, alt_msl: 1625, hdg: 135 }
    const props = { tracks: new Map(), follow: 1, selected: 1, padding: pad, style, target: null, onDragStart: () => {}, onClick: () => {}, terrainTiles: 'https://dem/{z}/{x}/{y}.png' }
    const { rerender } = render(<MapView {...props} vehicles={new Map([[1, flying]])} mode="3d" />)
    const m = created.maps.at(-1)!
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 5000) // past the 2D / 3D tilt
    rerender(<MapView {...props} vehicles={new Map([[1, { ...flying, lon: 139.3705 }]])} mode="3d" />)
    expect(m.clamped).toBe(false)
    // no DEM tile yet: the reported MSL altitude stands in
    expect(m.jumps.at(-1)).toEqual({ elevation: 1625 })
    expect(m.eased.at(-1)).toMatchObject({ center: [139.3705, 36.16], bearing: 135, freezeElevation: true })
    rerender(<MapView {...props} vehicles={new Map([[1, { ...flying, lon: 139.3705 }]])} mode="3d" follow={null} />)
    expect(m.clamped).toBe(true)
    vi.restoreAllMocks()
  })
})
