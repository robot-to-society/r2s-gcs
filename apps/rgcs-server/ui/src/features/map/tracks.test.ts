import { describe, expect, it } from 'vitest'
import { MAX_TRACK_POINTS, appendPoint, tracksGeoJson, type Tracks } from './tracks'

describe('tracks', () => {
  it('appends points immutably and ignores sub-metre jitter', () => {
    const t0: Tracks = new Map()
    const t1 = appendPoint(t0, 1, 139.372, 36.162)
    expect(t0.size).toBe(0)
    expect(t1.get(1)).toEqual([[139.372, 36.162]])
    const t2 = appendPoint(t1, 1, 139.372000001, 36.162000001)
    expect(t2).toBe(t1)
    const t3 = appendPoint(t2, 1, 139.3721, 36.162)
    expect(t3.get(1)).toHaveLength(2)
    expect(t1.get(1)).toHaveLength(1)
  })

  it('caps each track at MAX_TRACK_POINTS keeping the newest', () => {
    let t: Tracks = new Map()
    for (let i = 0; i <= MAX_TRACK_POINTS + 5; i++) t = appendPoint(t, 1, 139 + i * 0.001, 36)
    expect(t.get(1)).toHaveLength(MAX_TRACK_POINTS)
    expect(t.get(1)?.at(-1)?.[0]).toBeCloseTo(139 + (MAX_TRACK_POINTS + 5) * 0.001)
  })

  it('produces one LineString per vehicle with a selected flag', () => {
    let t: Tracks = new Map()
    t = appendPoint(t, 1, 139, 36)
    t = appendPoint(t, 1, 139.001, 36)
    t = appendPoint(t, 2, 140, 36)
    const fc = tracksGeoJson(t, 1)
    expect(fc.type).toBe('FeatureCollection')
    expect(fc.features).toHaveLength(1) // a single point is not a line
    expect(fc.features[0]?.properties).toEqual({ sysid: 1, selected: true })
    expect(fc.features[0]?.geometry).toEqual({ type: 'LineString', coordinates: [[139, 36], [139.001, 36]] })
  })
})
