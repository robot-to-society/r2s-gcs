import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VehicleState } from '../../shared/api/types'

const created = { maps: [] as FakeMap[], markers: [] as FakeMarker[] }

class FakeMarker {
  el: HTMLElement
  lngLat: [number, number] | null = null
  removed = false
  constructor(opts: { element: HTMLElement }) {
    this.el = opts.element
    created.markers.push(this)
  }
  setLngLat(ll: [number, number]) {
    this.lngLat = ll
    return this
  }
  addTo() {
    return this
  }
  remove() {
    this.removed = true
  }
}

class FakeMap {
  handlers = new Map<string, (() => void)[]>()
  padding: unknown = null
  eased: unknown[] = []
  sources = new Map<string, { setData: ReturnType<typeof vi.fn> }>()
  constructor() {
    created.maps.push(this)
  }
  on(ev: string, cb: () => void) {
    this.handlers.set(ev, [...(this.handlers.get(ev) ?? []), cb])
    if (ev === 'load') cb()
  }
  fire(ev: string) {
    this.handlers.get(ev)?.forEach((cb) => cb())
  }
  addControl() {}
  addSource(id: string) {
    this.sources.set(id, { setData: vi.fn() })
  }
  addLayer() {}
  getSource(id: string) {
    return this.sources.get(id)
  }
  setPadding(p: unknown) {
    this.padding = p
  }
  easeTo(o: unknown) {
    this.eased.push(o)
  }
  remove() {}
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
    expect(map.eased.at(-1)).toMatchObject({ center: [139.37, 36.16], duration: 200 })
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
})
