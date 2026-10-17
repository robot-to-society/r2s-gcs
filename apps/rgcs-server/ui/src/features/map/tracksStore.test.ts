import { describe, expect, it, vi } from 'vitest'
import type { VehicleState } from '../../shared/api/types'
import { TracksStore } from './tracksStore'

const v = (sysid: number, lon: number, fix = 3): VehicleState => ({
  sysid, name: 'x', kind: 'copter', mode: '', armed: false, lat: 36, lon, alt_rel: 0, alt_msl: 0, hdg: null,
  ground_speed: 0, climb: 0, battery: { pct: null, volt: 0, current: null }, link: 'ok', last_rx_ms: 0,
  gps: { fix, sats: 0, hdop: null }, warn: false, unread: 0,
})

describe('TracksStore', () => {
  it('accumulates positioned vehicles across ingests and notifies only on change', () => {
    const s = new TracksStore()
    const listener = vi.fn()
    s.subscribe(listener)
    s.ingest(new Map([[1, v(1, 139)], [2, v(2, 140, 0)]]))
    s.ingest(new Map([[1, v(1, 139.001)]]))
    s.ingest(new Map([[1, v(1, 139.001)]])) // jitter-free repeat: no change
    expect(s.getState().get(1)).toEqual([[139, 36], [139.001, 36]])
    expect(s.getState().has(2)).toBe(false)
    expect(listener).toHaveBeenCalledTimes(2)
  })
})
