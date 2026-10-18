import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (e?: unknown) => void
const created = { maps: [] as FakeMap[], markers: [] as FakeMarker[], deferLoad: false }

class FakeMarker {
  el: HTMLElement
  lngLat: [number, number] = [0, 0]
  draggable: boolean
  removed = false
  handlers = new Map<string, Handler[]>()
  constructor(opts: { element: HTMLElement; draggable?: boolean }) {
    this.el = opts.element
    this.draggable = opts.draggable ?? false
    created.markers.push(this)
  }
  setLngLat(ll: [number, number]) {
    this.lngLat = ll
    return this
  }
  getLngLat() {
    return { lng: this.lngLat[0], lat: this.lngLat[1] }
  }
  addTo() {
    return this
  }
  remove() {
    this.removed = true
  }
  on(ev: string, cb: Handler) {
    this.handlers.set(ev, [...(this.handlers.get(ev) ?? []), cb])
    return this
  }
  fire(ev: string, e?: unknown) {
    this.handlers.get(ev)?.forEach((cb) => cb(e))
  }
}

class FakeMap {
  handlers = new Map<string, Handler[]>()
  sources = new Map<string, { setData: ReturnType<typeof vi.fn> }>()
  options: unknown
  fitted: unknown[] = []
  constructor(options: unknown) {
    this.options = options
    created.maps.push(this)
  }
  on(ev: string, cb: Handler) {
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
  addLayer() {}
  getSource(id: string) {
    return this.sources.get(id)
  }
  fitBounds(b: unknown) {
    this.fitted.push(b)
  }
  getCanvas() {
    return document.createElement('canvas')
  }
  remove() {}
}

vi.mock('maplibre-gl', () => ({
  default: { Map: FakeMap, Marker: FakeMarker, NavigationControl: class {}, ScaleControl: class {}, LngLatBounds: class { extend() { return this } } },
}))

const { MissionMap } = await import('./MissionMap')
const { appendWaypoint, emptyDraft } = await import('./model')
const { rasterStyle } = await import('../map/style')

const style = rasterStyle('https://t/{z}/{x}/{y}.png', 'x')
const draft3 = () => appendWaypoint(appendWaypoint(appendWaypoint(emptyDraft(), 36.1, 139.1), 36.2, 139.2), 36.3, 139.3)
const badges = () => created.markers.filter((m) => m.el.classList.contains('rg-wp') && !m.removed)
const handles = () => created.markers.filter((m) => m.el.classList.contains('rg-mid') && !m.removed)

function renderMap(over: Partial<React.ComponentProps<typeof MissionMap>> = {}) {
  const props = {
    draft: draft3(),
    selected: new Set<number>(),
    tool: 'add' as const,
    style,
    vehicle: null,
    fitRequest: 0,
    onAdd: vi.fn(),
    onInsertAfter: vi.fn(),
    onMove: vi.fn(),
    onMoveSelected: vi.fn(),
    onSelect: vi.fn(),
    onBackgroundClick: vi.fn(),
    onContext: vi.fn(),
    ...over,
  }
  const utils = render(<MissionMap {...props} />)
  return { ...utils, props }
}

describe('MissionMap', () => {
  beforeEach(() => {
    created.maps = []
    created.markers = []
    created.deferLoad = false
  })

  it('path_is_set_when_the_style_loads_after_mount_with_an_existing_draft', () => {
    created.deferLoad = true
    renderMap()
    const map = created.maps[0]!
    expect(map.sources.size).toBe(0)
    act(() => map.fire('load'))
    const path = map.sources.get('mission-path')!
    const last = path.setData.mock.calls.at(-1)![0] as { features: unknown[] }
    expect(last.features).toHaveLength(2)
  })

  it('renders_one_badge_per_item_and_a_handle_per_leg', () => {
    renderMap({ selected: new Set([2]) })
    expect(created.maps).toHaveLength(1)
    expect((created.maps[0]!.options as { boxZoom: boolean }).boxZoom).toBe(false)
    expect(badges()).toHaveLength(3)
    expect(handles()).toHaveLength(2)
    expect(badges()[1]!.el.className).toBe('rg-wp sel')
    expect(badges()[0]!.lngLat).toEqual([139.1, 36.1])
    expect(badges().every((m) => m.draggable)).toBe(true)
    const path = created.maps[0]!.sources.get('mission-path')!
    const last = path.setData.mock.calls.at(-1)![0] as { features: unknown[] }
    expect(last.features).toHaveLength(2)
  })

  it('click_in_add_tool_calls_onAdd_with_lnglat_and_select_tool_clears', () => {
    const { props, rerender } = renderMap()
    act(() => created.maps[0]!.fire('click', { lngLat: { lat: 36.5, lng: 139.5 }, originalEvent: {} }))
    expect(props.onAdd).toHaveBeenCalledWith(36.5, 139.5)
    rerender(<MissionMap {...props} tool="select" />)
    act(() => created.maps[0]!.fire('click', { lngLat: { lat: 36.6, lng: 139.6 }, originalEvent: {} }))
    expect(props.onAdd).toHaveBeenCalledTimes(1)
    expect(props.onBackgroundClick).toHaveBeenCalledTimes(1)
  })

  it('dragend_calls_onMove_with_the_marker_position_and_multi_drag_moves_the_selection', () => {
    const { props, rerender } = renderMap()
    const b = badges()[1]!
    act(() => {
      b.fire('dragstart')
      b.setLngLat([139.25, 36.25])
      b.fire('dragend')
    })
    expect(props.onMove).toHaveBeenCalledWith(2, 36.25, 139.25)
    expect(props.onMoveSelected).not.toHaveBeenCalled()
    rerender(<MissionMap {...props} selected={new Set([1, 2])} />)
    const a = badges()[0]!
    act(() => {
      a.fire('dragstart')
      a.setLngLat([139.15, 36.15])
      a.fire('dragend')
    })
    expect(props.onMoveSelected).toHaveBeenCalledWith(expect.closeTo(0.05, 6), expect.closeTo(0.05, 6))
  })

  it('shift_click_selects_additively_and_contextmenu_reports_the_item', () => {
    const { props } = renderMap()
    const el = badges()[2]!.el
    act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })))
    expect(props.onSelect).toHaveBeenCalledWith(3, true, false)
    act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true })))
    expect(props.onSelect).toHaveBeenLastCalledWith(3, false, true)
    act(() => el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 50 })))
    expect(props.onContext).toHaveBeenCalledWith({ uid: 3, x: 40, y: 50 })
    act(() => handles()[0]!.el.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(props.onInsertAfter).toHaveBeenCalledWith(1, expect.closeTo(36.15, 9), expect.closeTo(139.15, 9))
  })

  it('fit_request_fits_the_bounds_of_the_items', () => {
    const { props, rerender } = renderMap()
    expect(created.maps[0]!.fitted).toHaveLength(0)
    rerender(<MissionMap {...props} fitRequest={1} />)
    expect(created.maps[0]!.fitted).toHaveLength(1)
  })
})
