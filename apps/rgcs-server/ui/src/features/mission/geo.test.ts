import { describe, expect, it } from 'vitest'
import type { MissionItem } from '../../shared/api/types'
import { haversineM, midpoint, pathGeoJson, remainingDistanceM } from './geo'

const item = (command: number, lat: number, lon: number, alt: number): MissionItem => ({ command, frame: 'rel', params: [0, 0, 0, 0], lat, lon, alt, autocontinue: true })

describe('geo', () => {
  it('path_geojson_normalises_altitude_between_min_and_max', () => {
    const items = [item(22, 36.162, 139.372, 30), item(178, 0, 0, 0), item(16, 36.163, 139.373, 80), item(16, 36.164, 139.374, 55), item(20, 0, 0, 0)]
    const fc = pathGeoJson(items, null)
    expect(fc.features).toHaveLength(2)
    expect(fc.features[0]?.properties).toEqual({ seq: 3, alt_t: 1 })
    expect(fc.features[1]?.properties).toEqual({ seq: 4, alt_t: 0.5 })
    expect(fc.features[0]?.geometry).toEqual({ type: 'LineString', coordinates: [[139.372, 36.162], [139.373, 36.163]] })
    const withHome = pathGeoJson(items, { lat: 36.16, lon: 139.37, alt: 0 })
    expect(withHome.features).toHaveLength(3)
    expect(withHome.features[0]?.properties.seq).toBe(1)
    expect(pathGeoJson([item(22, 36.1, 139.1, 30)], null).features).toEqual([])
    expect(midpoint({ lat: 36, lon: 139 }, { lat: 37, lon: 140 })).toEqual({ lat: 36.5, lon: 139.5 })
    expect(haversineM(36.162, 139.372, 36.162, 139.3831)).toBeCloseTo(1000, -2)
  })

  it('remaining_distance_sums_vehicle_to_current_plus_rest', () => {
    const items = [item(22, 36.162, 139.372, 30), item(16, 36.162, 139.3831, 60), item(16, 36.162, 139.3942, 60), item(20, 0, 0, 0)]
    const vehicle = { lat: 36.162, lon: 139.37755 }
    const r = remainingDistanceM(items, 2, vehicle)
    expect(r).not.toBeNull()
    expect(r!).toBeGreaterThan(1450)
    expect(r!).toBeLessThan(1550)
    expect(remainingDistanceM(items, 2, null)).toBeCloseTo(1000, -2)
    expect(remainingDistanceM(items, 0, vehicle)).toBeNull()
    expect(remainingDistanceM(items, 9, vehicle)).toBeNull()
    expect(remainingDistanceM(items, 4, vehicle)).toBe(0)
  })
})
