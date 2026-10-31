import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LteAreasStore } from './areasStore'
import { LTE_LAYER, LTE_SOURCE } from './layer'
import { lteViewRect } from './mapRegistry'
import { LteOverlayStore } from './prefs'
import { area, stack } from './testArea'
import { useLteOverlay } from './useLteOverlay'

const memory = () => {
  const items: Record<string, string> = {}
  return { getItem: (k: string) => items[k] ?? null, setItem: (k: string, v: string) => void (items[k] = v) }
}

function setup(load: () => Promise<ReturnType<typeof area>[]>) {
  const m = Object.assign(stack(['base', 'mission-path-line']), { once: vi.fn(), getBounds: () => ({ getSouth: () => 33.6, getWest: () => 135.8, getNorth: () => 33.7, getEast: () => 135.9 }) })
  const prefs = new LteOverlayStore(memory())
  const areas = new LteAreasStore(load)
  const hook = renderHook(() => useLteOverlay({ current: m }, { current: true }, 'ops', { prefs, areas }))
  return { m, prefs, areas, hook }
}

describe('useLteOverlay', () => {
  it('adds_nothing_and_reads_nothing_while_off', async () => {
    const load = vi.fn(async () => [area()])
    const { m } = setup(load)
    await act(async () => {})
    expect(load).not.toHaveBeenCalled()
    expect(m.layers).toEqual(['base', 'mission-path-line'])
  })

  it('switching_on_adds_the_layer_under_the_mission_path', async () => {
    const { m, prefs } = setup(async () => [area()])
    act(() => prefs.toggle())
    await waitFor(() => expect(m.layers).toEqual(['base', LTE_LAYER, 'mission-path-line']))
    act(() => prefs.setOpacity(30))
    expect(m.paint.get(`${LTE_LAYER}.raster-opacity`)).toBe(0.3)
    act(() => prefs.toggle())
    expect(m.layers).toEqual(['base', 'mission-path-line'])
    expect(m.sources.has(LTE_SOURCE)).toBe(false)
  })

  it('no_fetched_area_adds_no_source', async () => {
    const { m, prefs, areas } = setup(async () => [area({ status: 'fetching', fetched_at: null })])
    act(() => prefs.toggle())
    await waitFor(() => expect(areas.getState().loaded).toBe(true))
    expect(m.sources.has(LTE_SOURCE)).toBe(false)
  })

  it('a_completed_fetch_renews_the_source_so_the_new_tiles_show', async () => {
    let reply = [area({ status: 'fetching', fetched_at: null })]
    const { m, prefs, areas } = setup(async () => reply)
    act(() => prefs.toggle())
    await waitFor(() => expect(areas.getState().loaded).toBe(true))
    reply = [area({ fetched_at: 5000 })]
    await act(() => areas.reload())
    expect(m.sources.get(LTE_SOURCE)).toMatchObject({ tiles: ['/api/lte/tiles/{z}/{x}/{y}.gif?v=5000'] })
    reply = [area({ fetched_at: 9000 })]
    await act(() => areas.reload())
    expect(m.sources.get(LTE_SOURCE)).toMatchObject({ tiles: ['/api/lte/tiles/{z}/{x}/{y}.gif?v=9000'] })
    expect(m.layers.filter((l) => l === LTE_LAYER)).toHaveLength(1)
  })

  it('a_map_error_never_escapes', async () => {
    const { m, prefs } = setup(async () => [area()])
    m.addLayer = () => {
      throw new Error('style not ready')
    }
    act(() => prefs.toggle())
    await act(async () => {})
    expect(m.layers).toEqual(['base', 'mission-path-line'])
  })

  it('registers_the_map_for_the_area_in_view', () => {
    const { hook } = setup(async () => [])
    expect(lteViewRect('ops')).toEqual({ south: 33.6, west: 135.8, north: 33.7, east: 135.9 })
    hook.unmount()
    expect(lteViewRect('ops')).toBeNull()
  })
})
