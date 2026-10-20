import { describe, expect, it } from 'vitest'
import { toMercator } from '../air'
import { modelMatrix, screenSizeMerc } from './placement'

const apply = (m: Float64Array, v: [number, number, number]) => [0, 1, 2].map((r) => m[r]! * v[0] + m[4 + r]! * v[1] + m[8 + r]! * v[2] + m[12 + r]!)

describe('model placement', () => {
  const at = { lon: 137.6385, lat: 36.2509, amsl: 1600 }
  it('puts the model origin at the vehicle (mercator, altitude in metres)', () => {
    const m = modelMatrix(at, 0, 1e-6)
    const o = toMercator(at.lon, at.lat, at.amsl)
    const p = apply(m, [0, 0, 0])
    expect(p[0]).toBeCloseTo(o.x, 12)
    expect(p[1]).toBeCloseTo(o.y, 12)
    expect(p[2]).toBeCloseTo(o.z, 12)
  })

  it('the nose (+y) points north at heading 0 and east at 90 (mercator y grows southwards)', () => {
    const o = apply(modelMatrix(at, 0, 1e-6), [0, 0, 0])
    const n0 = apply(modelMatrix(at, 0, 1e-6), [0, 1, 0])
    expect(n0[1]! - o[1]!).toBeCloseTo(-1e-6, 12)
    const n90 = apply(modelMatrix(at, 90, 1e-6), [0, 1, 0])
    expect(n90[0]! - o[0]!).toBeCloseTo(1e-6, 12)
    expect(n90[1]! - o[1]!).toBeCloseTo(0, 12)
    // up stays up (z), scaled the same
    const up = apply(modelMatrix(at, 90, 1e-6), [0, 0, 1])
    expect(up[2]! - o[2]!).toBeCloseTo(1e-6, 12)
  })

  it('keeps a constant on-screen size: px / (512·2^zoom) mercator units, never below the real size', () => {
    expect(screenSizeMerc(40, 15, 0)).toBeCloseTo(40 / (512 * 2 ** 15), 15)
    const real = toMercator(0, 36, 2).z
    expect(screenSizeMerc(40, 22, real)).toBe(real)
  })
})
