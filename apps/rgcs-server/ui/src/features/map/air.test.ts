import { describe, expect, it } from 'vitest'
import type { MissionItem, VehicleState } from '../../shared/api/types'
import { altColor, itemAmsl, mercatorLine, vehicleAmsl, type ElevAt } from './air'

const flat = (h: number): ElevAt => () => h
const none: ElevAt = () => null
const v = (over: Partial<VehicleState> = {}) => ({ sysid: 1, lat: 36.16, lon: 139.37, alt_rel: 30, alt_msl: 430 }) as unknown as VehicleState & typeof over
const item = (frame: MissionItem['frame'], alt: number): MissionItem => ({ command: 16, frame, params: [0, 0, 0, 0], lat: 36.17, lon: 139.38, alt, autocontinue: true })
const HOME = { lat: 36.16, lon: 139.37 }

describe('vehicleAmsl', () => {
  it('is the ground at home plus the relative altitude (not alt_msl)', () => {
    expect(vehicleAmsl(v(), HOME, flat(100))).toEqual({ ground: 100, amsl: 130 })
  })
  it('uses the ground under the vehicle for its post', () => {
    const elev: ElevAt = (lon) => (lon === HOME.lon ? 100 : 120)
    expect(vehicleAmsl({ ...v(), lon: 139.4 } as VehicleState, HOME, elev)).toEqual({ ground: 120, amsl: 130 })
  })
  it('falls back to the home ground when the tile under the vehicle is missing', () => {
    const elev: ElevAt = (lon) => (lon === HOME.lon ? 100 : null)
    expect(vehicleAmsl({ ...v(), lon: 139.4 } as VehicleState, HOME, elev)).toEqual({ ground: 100, amsl: 130 })
  })
  it('is null without a home, without ground at home, or without a position', () => {
    expect(vehicleAmsl(v(), null, flat(100))).toBeNull()
    expect(vehicleAmsl(v(), HOME, none)).toBeNull()
    expect(vehicleAmsl({ ...v(), lat: 0, lon: 0 } as VehicleState, HOME, flat(100))).toBeNull()
  })
  it('never returns NaN', () => {
    expect(vehicleAmsl({ ...v(), alt_rel: Number.NaN } as VehicleState, HOME, flat(100))).toBeNull()
  })
})

describe('itemAmsl', () => {
  it('Rel adds the home ground, Abs is absolute, Ter adds the ground under the item', () => {
    const elev: ElevAt = (lon) => (lon === HOME.lon ? 100 : 150)
    expect(itemAmsl(item('rel', 80), HOME, elev)).toBe(180)
    expect(itemAmsl(item('abs', 480), HOME, elev)).toBe(480)
    expect(itemAmsl(item('ter', 40), HOME, elev)).toBe(190)
  })
  it('is null when the ground it needs is unknown', () => {
    expect(itemAmsl(item('rel', 80), null, flat(100))).toBeNull()
    expect(itemAmsl(item('ter', 40), HOME, none)).toBeNull()
    expect(itemAmsl(item('abs', 480), null, none)).toBe(480)
  })
})

describe('altColor', () => {
  it('runs from cyan to violet and clamps', () => {
    expect(altColor(0)).toEqual([0x9c / 255, 0xc9 / 255, 1])
    expect(altColor(1)).toEqual([0xd8 / 255, 0xa8 / 255, 1])
    expect(altColor(2)).toEqual(altColor(1))
    expect(altColor(-1)).toEqual(altColor(0))
  })
})

describe('mercatorLine', () => {
  it('converts to mercator units with the altitude in z', () => {
    const [a, b] = mercatorLine([
      { lon: 0, lat: 0, amsl: 0, color: [1, 0, 0] },
      { lon: 0, lat: 0, amsl: 1000, color: [0, 1, 0] },
    ])
    expect(a!.x).toBeCloseTo(0.5)
    expect(a!.y).toBeCloseTo(0.5)
    expect(a!.z).toBe(0)
    expect(b!.z).toBeGreaterThan(0)
    expect(b!.c).toEqual([0, 1, 0])
  })
})
