import { describe, expect, it } from 'vitest'
import type { VehicleState } from '../../shared/api/types'
import { followTarget, padding } from './follow'

describe('map padding (spec 20 §4)', () => {
  it('matches the panel widths', () => {
    expect(padding('full', true)).toEqual({ top: 72, left: 320, right: 396, bottom: 60 })
    expect(padding('full', false)).toEqual({ top: 72, left: 320, right: 0, bottom: 60 })
    expect(padding('rail', true)).toEqual({ top: 72, left: 84, right: 396, bottom: 60 })
    expect(padding('none', false)).toEqual({ top: 72, left: 0, right: 0, bottom: 60 })
  })
})

describe('followTarget', () => {
  const v = (sysid: number, fix: number): VehicleState => ({
    sysid, name: 'x', kind: 'copter', mode: '', armed: false, lat: 36, lon: 139, alt_rel: 0, alt_msl: 0, hdg: null,
    ground_speed: 0, climb: 0, battery: { pct: null, volt: 0, current: null }, link: 'ok', last_rx_ms: 0,
    gps: { fix, sats: 0, hdop: null }, warn: false, unread: 0,
  })
  it('returns the followed vehicle position only when it has one', () => {
    const vehicles = new Map([[1, v(1, 3)], [2, v(2, 0)]])
    expect(followTarget(vehicles, 1)).toEqual([139, 36])
    expect(followTarget(vehicles, 2)).toBeNull()
    expect(followTarget(vehicles, 9)).toBeNull()
    expect(followTarget(vehicles, null)).toBeNull()
  })
})
