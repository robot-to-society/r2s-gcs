import { describe, expect, it } from 'vitest'
import { applyBasemap } from '../map/basemaps'
import { orderLayers } from '../map/layers'
import { area, stack } from './testArea'
import { LTE_LAYER, LTE_SOURCE, addLte, lteBounds, lteNoticeDates, lteVersion, removeLte, setLteOpacity } from './layer'

describe('LTE overlay bounds and dates', () => {
  it('bounds_are_the_union_of_the_areas_with_fetched_tiles', () => {
    const areas = [area(), area({ id: 2, south: 33.5, west: 136, north: 33.65, east: 136.1, status: 'partial' }), area({ id: 3, south: 10, west: 10, north: 11, east: 11, status: 'failed' }), area({ id: 4, south: 0, west: 0, north: 1, east: 1, status: 'fetching', fetched_at: null })]
    expect(lteBounds(areas)).toEqual([135.85, 33.5, 136.1, 33.7])
  })

  it('a_refetch_keeps_the_tiles_already_fetched_on_the_map', () => {
    expect(lteBounds([area({ status: 'fetching' })])).toEqual([135.85, 33.6, 135.95, 33.7])
  })

  it('no_fetched_area_means_no_bounds', () => {
    expect(lteBounds([])).toBeNull()
    expect(lteBounds([area({ status: 'idle', fetched_at: null }), area({ status: 'failed' })])).toBeNull()
  })

  it('the_version_changes_when_a_fetch_completes', () => {
    const a = lteVersion([area()])
    expect(lteVersion([area()])).toBe(a)
    expect(lteVersion([area({ fetched_at: Date.UTC(2026, 9, 31, 4) })])).not.toBe(a)
  })

  it('notice_dates_are_the_newest_fetch_and_the_newest_data_date', () => {
    const areas = [area(), area({ id: 2, fetched_at: Date.UTC(2026, 9, 20, 3), data_modified: Date.UTC(2026, 9, 5, 3) })]
    expect(lteNoticeDates(areas)).toEqual({ fetched: '2026-10-31', data: '2026-10-05' })
    expect(lteNoticeDates([area({ data_modified: null })])).toEqual({ fetched: '2026-10-31', data: null })
    expect(lteNoticeDates([area({ status: 'failed' })])).toBeNull()
  })
})

describe('LTE overlay layer', () => {
  it('goes_above_the_base_map_and_its_labels_and_below_every_app_layer', () => {
    const m = stack(['base', 'labels', 'mission-path-casing', 'mission-path-line', 'tracks-others'])
    addLte(m, [135.85, 33.6, 135.95, 33.7], 'v1', 60)
    expect(m.layers).toEqual(['base', 'labels', LTE_LAYER, 'mission-path-casing', 'mission-path-line', 'tracks-others'])
    expect(m.sources.get(LTE_SOURCE)).toEqual({ type: 'raster', tiles: ['/api/lte/tiles/{z}/{x}/{y}.gif?v=v1'], tileSize: 256, minzoom: 8, maxzoom: 14, bounds: [135.85, 33.6, 135.95, 33.7] })
    // below zoom 8 the z8 tiles would only show as a coarse blur: hidden there
    expect(m.layerObjs.get(LTE_LAYER)).toMatchObject({ type: 'raster', source: LTE_SOURCE, minzoom: 8, paint: { 'raster-opacity': 0.6 } })
  })

  it('stays_below_the_app_layers_after_a_restack_and_a_base_map_swap', () => {
    const m = stack(['base', 'mission-path-line', 'tracks-others', 'sight'])
    addLte(m, [0, 0, 1, 1], 'v', 60)
    orderLayers(m)
    applyBasemap(m, { id: 'sat', label: 'sat', tiles: ['x'], attribution: '', max_zoom: 18, overlay: ['y'] })
    expect(m.layers.slice(0, 3)).toEqual(['base', 'labels', LTE_LAYER])
  })

  it('is_added_on_top_when_the_map_has_only_the_base', () => {
    const m = stack(['base'])
    addLte(m, [0, 0, 1, 1], 'v', 100)
    expect(m.layers).toEqual(['base', LTE_LAYER])
  })

  it('removes_cleanly_and_twice', () => {
    const m = stack(['base', 'mission-path-line'])
    addLte(m, [0, 0, 1, 1], 'v', 60)
    removeLte(m)
    removeLte(m)
    expect(m.layers).toEqual(['base', 'mission-path-line'])
    expect(m.sources.has(LTE_SOURCE)).toBe(false)
  })

  it('opacity_goes_to_the_raster_paint_only_when_the_layer_exists', () => {
    const m = stack(['base'])
    setLteOpacity(m, 30)
    expect(m.paint.size).toBe(0)
    addLte(m, [0, 0, 1, 1], 'v', 60)
    setLteOpacity(m, 30)
    expect(m.paint.get(`${LTE_LAYER}.raster-opacity`)).toBe(0.3)
  })
})
