import { describe, expect, it } from 'vitest'
import { LAYER_ORDER, orderLayers } from './layers'

/** A stand-in for MapLibre's style stack: `moveLayer(id)` without `beforeId` moves it to the top. */
function fakeMap(ids: string[]) {
  const stack = [...ids]
  return {
    stack,
    getLayer: (id: string) => (stack.includes(id) ? { id } : undefined),
    moveLayer: (id: string) => {
      stack.splice(stack.indexOf(id), 1)
      stack.push(id)
    },
  }
}

describe('map layer order', () => {
  it('layer_order_puts_mission_below_tracks_below_sight', () => {
    const m = fakeMap(['guided-line', 'tracks-selected', 'osm', 'mission-path-line', 'tracks-others'])
    orderLayers(m)
    expect(m.stack).toEqual(['osm', 'mission-path-line', 'tracks-others', 'tracks-selected', 'guided-line'])
    expect(LAYER_ORDER.indexOf('mission-path-line')).toBeLessThan(LAYER_ORDER.indexOf('tracks-others'))
  })

  it('skips layers the map does not have', () => {
    const m = fakeMap(['osm', 'tracks-others'])
    orderLayers(m)
    expect(m.stack).toEqual(['osm', 'tracks-others'])
  })
})
