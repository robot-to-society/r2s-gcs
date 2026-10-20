import { describe, expect, it } from 'vitest'
import { FLOATS, meshFor } from './meshes'

const bounds = (data: Float32Array) => {
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < data.length; i += FLOATS) for (let k = 0; k < 3; k++) (lo[k] = Math.min(lo[k]!, data[i + k]!)), (hi[k] = Math.max(hi[k]!, data[i + k]!))
  return { lo, hi }
}

describe('low-poly vehicle meshes (model units: +y forward, +z up, about 1 long)', () => {
  it('every kind is whole triangles with unit normals', () => {
    for (const kind of ['copter', 'plane', 'rover', 'other'] as const) {
      const m = meshFor(kind)
      expect(m.length % (FLOATS * 3)).toBe(0)
      expect(m.length).toBeGreaterThan(FLOATS * 36)
      for (let i = 0; i < m.length; i += FLOATS) expect(Math.hypot(m[i + 3]!, m[i + 4]!, m[i + 5]!)).toBeCloseTo(1, 5)
    }
  })

  it('the plane is longer than tall and its wings span across (x), nose forward (+y)', () => {
    const { lo, hi } = bounds(meshFor('plane'))
    expect(hi[0]! - lo[0]!).toBeGreaterThan(0.9)
    expect(hi[1]! - lo[1]!).toBeGreaterThan(0.6)
    expect(hi[2]! - lo[2]!).toBeLessThan(0.4)
    expect(hi[1]!).toBeGreaterThan(-lo[1]! * 0.8)
  })

  it('the copter is square in plan; the rover sits on the ground (z ≥ 0)', () => {
    const c = bounds(meshFor('copter'))
    expect(c.hi[0]! - c.lo[0]!).toBeCloseTo(c.hi[1]! - c.lo[1]!, 1)
    expect(bounds(meshFor('rover')).lo[2]!).toBeGreaterThanOrEqual(-1e-6)
  })
})
