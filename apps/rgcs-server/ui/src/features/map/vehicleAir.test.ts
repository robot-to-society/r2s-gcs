import { describe, expect, it } from 'vitest'
import type { VehicleState } from '../../shared/api/types'
import { vehicleAirData } from './vehicleAir'

const v = (sysid: number, alt_rel: number, lon = 139.37, lat = 36.16) => ({ sysid, lat, lon, alt_rel }) as unknown as VehicleState

describe('vehicleAirData', () => {
  const homes = new Map([[1, { lat: 36.16, lon: 139.37 }]])
  it('gives a flying vehicle a post from the ground to its altitude, amber when selected', () => {
    const d = vehicleAirData(new Map([[1, v(1, 30)]]), 1, homes, new Map(), () => 100)
    expect(d.posts).toHaveLength(1)
    expect(d.posts[0]![1]!.z).toBeGreaterThan(d.posts[0]![0]!.z)
    expect(d.posts[0]![0]!.c).toEqual([0xf2 / 255, 0xb5 / 255, 0x44 / 255])
    expect(d.discs.features).toHaveLength(1)
    expect(d.alts.get(1)).toBe(130)
  })
  it('a landed vehicle has an altitude but no post', () => {
    const d = vehicleAirData(new Map([[1, v(1, 0.4)]]), null, homes, new Map(), () => 100)
    expect(d.posts).toHaveLength(0)
    expect(d.alts.get(1)).toBeCloseTo(100.4)
  })
  it('falls back to the first track point for home, and to the ground while the DEM is missing', () => {
    const tracks = new Map([[2, [[139.36, 36.15, 0, 0]] as const]])
    expect(vehicleAirData(new Map([[2, v(2, 20)]]), null, new Map(), tracks, () => 50).alts.get(2)).toBe(70)
    const none = vehicleAirData(new Map([[2, v(2, 20)]]), null, new Map(), tracks, () => null)
    expect(none.alts.get(2)).toBeNull()
    expect(none.posts).toHaveLength(0)
  })
})
