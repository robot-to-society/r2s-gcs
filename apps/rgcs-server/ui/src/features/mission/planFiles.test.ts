import { describe, expect, it } from 'vitest'
import type { FenceZone, RallyPoint } from '../../shared/api/types'
import { fenceToWpl, parseFenceFile, parseRallyFile, rallyToWpl } from './planFiles'

const zones: FenceZone[] = [
  { kind: 'polygon', inclusion: true, vertices: [{ lat: 36.25, lon: 137.63 }, { lat: 36.26, lon: 137.63 }, { lat: 36.26, lon: 137.65 }] },
  { kind: 'polygon', inclusion: true, vertices: [{ lat: 36.3, lon: 137.7 }, { lat: 36.31, lon: 137.7 }, { lat: 36.31, lon: 137.71 }] },
  { kind: 'circle', inclusion: false, center: { lat: 36.255, lon: 137.64 }, radius: 80 },
]
const rally: RallyPoint[] = [{ lat: 36.251, lon: 137.639, alt: 40 }]

describe('fence / rally files', () => {
  it('writes the fence as QGC WPL 110 (Mission Planner) with MAV_CMD_NAV_FENCE_* items, vertex count in param1', () => {
    const text = fenceToWpl(zones)
    const lines = text.trim().split('\n')
    expect(lines[0]).toBe('QGC WPL 110')
    const cols = lines.slice(1).map((l) => l.split('\t'))
    expect(cols.map((c) => c[3])).toEqual(['5001', '5001', '5001', '5001', '5001', '5001', '5004'])
    expect(cols.map((c) => Number(c[4]))).toEqual([3, 3, 3, 3, 3, 3, 80])
    expect(cols[0]![8]).toBe('36.25000000')
  })

  it('reads its own fence back, keeping two adjacent polygons of the same kind apart', () => {
    expect(parseFenceFile(fenceToWpl(zones))).toEqual(zones)
  })

  it('writes and reads rally points (MAV_CMD_NAV_RALLY_POINT, altitude relative to home)', () => {
    const text = rallyToWpl(rally)
    expect(text.split('\n')[1]!.split('\t').slice(2, 4)).toEqual(['3', '5100'])
    expect(parseRallyFile(text)).toEqual(rally)
  })

  it('reads a QGroundControl .plan (geoFence polygons / circles, rallyPoints)', () => {
    const plan = JSON.stringify({
      fileType: 'Plan',
      geoFence: { version: 2, polygons: [{ inclusion: false, version: 1, polygon: [[36.1, 137.1], [36.2, 137.1], [36.2, 137.2]] }], circles: [{ inclusion: true, version: 1, circle: { center: [36.15, 137.15], radius: 500 } }] },
      rallyPoints: { version: 2, points: [[36.12, 137.12, 30]] },
    })
    expect(parseFenceFile(plan)).toEqual([
      { kind: 'polygon', inclusion: false, vertices: [{ lat: 36.1, lon: 137.1 }, { lat: 36.2, lon: 137.1 }, { lat: 36.2, lon: 137.2 }] },
      { kind: 'circle', inclusion: true, center: { lat: 36.15, lon: 137.15 }, radius: 500 },
    ])
    expect(parseRallyFile(plan)).toEqual([{ lat: 36.12, lon: 137.12, alt: 30 }])
  })

  it('rejects files that are neither, and coordinates out of range', () => {
    expect(() => parseFenceFile('hello')).toThrow()
    expect(() => parseRallyFile('QGC WPL 110\n0\t0\t3\t5100\t0\t0\t0\t0\t95\t137\t30\t1\n')).toThrow()
    // a mission file has no fence items: nothing to load
    expect(() => parseFenceFile('QGC WPL 110\n0\t1\t0\t16\t0\t0\t0\t0\t36\t137\t0\t1\n')).toThrow()
  })
})
