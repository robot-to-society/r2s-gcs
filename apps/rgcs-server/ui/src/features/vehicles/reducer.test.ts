import { describe, expect, it } from 'vitest'
import type { VehicleState } from '../../shared/api/types'
import { initialState, reduce, setLink } from './reducer'

const uav: VehicleState = {
  sysid: 1,
  name: 'UAV-01',
  kind: 'copter',
  mode: 'AUTO',
  armed: true,
  lat: 36.16,
  lon: 139.37,
  alt_rel: 80,
  alt_msl: 412,
  hdg: 15,
  ground_speed: 8.1,
  climb: 0,
  battery: { pct: 62, volt: 22.8, current: 12.5 },
  link: 'ok',
  last_rx_ms: 0,
  gps: { fix: 3, sats: 14, hdop: 1.2 },
  warn: false,
  unread: 0,
}

describe('vehicles reducer', () => {
  it('snapshot replaces the vehicle map', () => {
    const s = reduce(initialState, { t: 'snapshot', vehicles: [uav] })
    expect(s.vehicles.get(1)?.name).toBe('UAV-01')
    expect(initialState.vehicles.size).toBe(0)
  })

  it('telemetry applies a diff to a known vehicle and creates unknown ones', () => {
    const s0 = reduce(initialState, { t: 'snapshot', vehicles: [uav] })
    const s1 = reduce(s0, { t: 'telemetry', sysid: 1, diff: { alt_rel: 90 } })
    expect(s1.vehicles.get(1)?.alt_rel).toBe(90)
    expect(s0.vehicles.get(1)?.alt_rel).toBe(80)
    const s2 = reduce(s1, { t: 'telemetry', sysid: 7, diff: { name: 'UAV-07', mode: 'HOLD' } })
    expect(s2.vehicles.get(7)?.mode).toBe('HOLD')
    expect(s2.vehicles.get(7)?.kind).toBe('other')
  })

  it('discovered / lost add and remove placeholders', () => {
    const s1 = reduce(initialState, { t: 'vehicle_discovered', sysid: 3 })
    expect(s1.vehicles.get(3)?.name).toBe('UAV-03')
    const s2 = reduce(s1, { t: 'vehicle_lost', sysid: 3 })
    expect(s2.vehicles.has(3)).toBe(false)
  })

  it('messages are kept newest first', () => {
    const m = { sysid: 1, id: 1, severity: 4, text: 'PreArm', ts: 1 }
    const s1 = reduce(initialState, { t: 'vehicle_message', ...m })
    const s2 = reduce(s1, { t: 'vehicle_message', ...m, id: 2, text: 'Armed' })
    expect(s2.messages.map((x) => x.id)).toEqual([2, 1])
  })

  it('link state changes produce a new object only when different', () => {
    const s1 = setLink(initialState, 'open')
    expect(s1.link).toBe('open')
    expect(setLink(s1, 'open')).toBe(s1)
  })
})
