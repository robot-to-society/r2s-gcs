import { describe, expect, it } from 'vitest'
import type { VehicleState } from '../../shared/api/types'
import { FOLLOW_DEADBAND_PX, follow3dCamera, followTarget, needsRecenter, padding } from './follow'

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

describe('needsRecenter', () => {
  it('ignores GPS jitter of a hovering vehicle (a few pixels) and follows real movement', () => {
    expect(needsRecenter({ x: 500, y: 400 }, { x: 501, y: 401 })).toBe(false)
    expect(needsRecenter({ x: 500, y: 400 }, { x: 500 + FOLLOW_DEADBAND_PX + 1, y: 400 })).toBe(true)
    expect(needsRecenter({ x: 500, y: 400 }, { x: 500, y: 380 })).toBe(true)
  })
})

describe('follow3dCamera (3D: from behind and above, the vehicle in the air at the centre)', () => {
  const veh = (over: Partial<VehicleState> = {}) => ({ sysid: 1, lat: 36.25, lon: 137.64, hdg: 90, cog: 80, gps: { fix: 3 }, ...over }) as unknown as VehicleState
  const cam = { lng: 137.64, lat: 36.25, bearing: 90, elevation: 1600 }
  it('centres on the vehicle at its altitude, looking along its heading', () => {
    expect(follow3dCamera(veh(), 1650, null)).toEqual({ center: [137.64, 36.25], bearing: 90, elevation: 1650 })
  })
  it('falls back to the course when there is no heading', () => {
    expect(follow3dCamera(veh({ hdg: null }), 1650, null)?.bearing).toBe(80)
  })
  it('ignores GPS / yaw / altitude noise inside the dead bands, and moves past them', () => {
    expect(follow3dCamera(veh({ lon: 137.640001, hdg: 91 }), 1600.5, cam)).toBeNull()
    expect(follow3dCamera(veh({ lon: 137.6402 }), 1600, cam)?.center).toEqual([137.6402, 36.25])
    expect(follow3dCamera(veh({ hdg: 100 }), 1600, cam)?.bearing).toBe(100)
    expect(follow3dCamera(veh(), 1605, cam)?.elevation).toBe(1605)
  })
  it('treats 359° and 1° as 2° apart', () => {
    expect(follow3dCamera(veh({ hdg: 1 }), 1600, { ...cam, bearing: -1 })).toBeNull()
  })
})
