// Test helpers: an LTE area row (the Nachikatsuura check rectangle, fetched 2026-10-31) and a style stack.
import type { LteArea } from '../../shared/api/types'

export const area = (p: Partial<LteArea> = {}): LteArea => ({ id: 1, name: 'Nachi', south: 33.6, west: 135.85, north: 33.7, east: 135.95, status: 'ready', tiles_total: 10, tiles_ok: 10, tiles_failed: 0, fetched_at: Date.UTC(2026, 9, 31, 3), data_modified: Date.UTC(2026, 9, 1, 3), last_error: null, created_at: 0, ...p })

/** A style stack like MapLibre's: `addLayer(l, before)` inserts below `before`, `moveLayer(id)` moves to the top. */
export function stack(ids: string[]) {
  const s = {
    layers: [...ids],
    sources: new Map<string, unknown>(),
    layerObjs: new Map<string, unknown>(),
    paint: new Map<string, unknown>(),
    getStyle: () => ({ layers: s.layers.map((id) => ({ id })) }),
    getLayer: (id: string) => (s.layers.includes(id) ? { id } : undefined),
    getSource: (id: string) => s.sources.get(id),
    addSource: (id: string, src: unknown) => void s.sources.set(id, src),
    removeSource: (id: string) => void s.sources.delete(id),
    addLayer: (l: { id: string }, before?: string) => {
      s.layerObjs.set(l.id, l)
      if (before && s.layers.includes(before)) s.layers.splice(s.layers.indexOf(before), 0, l.id)
      else s.layers.push(l.id)
    },
    removeLayer: (id: string) => void (s.layers = s.layers.filter((x) => x !== id)),
    moveLayer: (id: string) => void (s.layers = [...s.layers.filter((x) => x !== id), id]),
    setPaintProperty: (id: string, k: string, v: unknown) => void s.paint.set(`${id}.${k}`, v),
  }
  return s
}
