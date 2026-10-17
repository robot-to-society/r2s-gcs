import { describe, expect, it } from 'vitest'
import type { VehicleState } from '../../shared/api/types'
import { CATALOG, COPTER_MODES, REQUIRES_CONFIRM, catalogGroups, commandName } from './catalog'

const v = (armed: boolean): VehicleState => ({
  sysid: 1, name: 'UAV-01', kind: 'copter', mode: 'LOITER', armed, lat: 0, lon: 0, alt_rel: 0, alt_msl: 0, hdg: null,
  ground_speed: 0, climb: 0, battery: { pct: 50, volt: 22, current: null }, link: 'ok', last_rx_ms: 0,
  gps: { fix: 3, sats: 9, hdop: 1 }, warn: false, unread: 0,
})

describe('command catalog', () => {
  it('confirm set matches the server (rgcs-core VehicleCommand::requires_confirm)', () => {
    expect([...REQUIRES_CONFIRM].sort()).toEqual(['arm', 'disarm', 'land', 'mission_start', 'rtl', 'set_mode'])
  })

  it('every item is a known VehicleCommand name or opens a modal', () => {
    const names = ['pause', 'resume', 'rtl', 'land', 'change_alt', 'change_speed', 'set_mode', 'mission_start', 'mission_resume', 'arm', 'disarm']
    for (const item of CATALOG) {
      expect(names.includes(item.name) || item.opens !== undefined, item.name).toBe(true)
    }
    expect(catalogGroups().map((g) => g.group)).toEqual(['flight', 'move', 'mode', 'payload'])
  })

  it('ARM is disabled when armed, DISARM when disarmed, camera always in P1', () => {
    const by = (n: string) => CATALOG.find((i) => i.name === n)!
    expect(by('arm').enabled(v(true))).toBe(false)
    expect(by('arm').enabled(v(false))).toBe(true)
    expect(by('disarm').enabled(v(false))).toBe(false)
    expect(by('camera').enabled(v(false))).toBe(false)
  })

  it('builds parameterised commands in the real serde shape', () => {
    const by = (n: string) => CATALOG.find((i) => i.name === n)!
    expect(by('set_mode').build!({ mode: 'AUTO' })).toEqual({ cmd: 'set_mode', args: { mode: 'AUTO' } })
    expect(by('change_alt').build!({ value: 50 })).toEqual({ cmd: 'change_alt', args: { alt_rel: 50 } })
    expect(by('arm').build!({})).toEqual({ cmd: 'arm' })
    expect(commandName({ cmd: 'change_speed', args: { mps: 3 } })).toBe('change_speed')
    expect(COPTER_MODES).toContain('GUIDED')
  })
})
