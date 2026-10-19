import { describe, expect, it } from 'vitest'
import type { AirVertex } from './air'
import { buildStrip, FLOATS_PER_VERTEX } from './airLayer'

const p = (x: number, y: number, z = 0): AirVertex => ({ x, y, z, c: [1, 0.5, 0] })

describe('buildStrip', () => {
  it('is empty without lines', () => {
    expect(buildStrip([], [])).toEqual({ data: new Float32Array(0), pathCount: 0, postCount: 0, origin: [0, 0, 0] })
  })
  it('emits two vertices (both sides) per point, relative to the first point', () => {
    const s = buildStrip([[p(10, 20, 1), p(11, 20, 1)]], [])
    expect(s.pathCount).toBe(4)
    expect(s.postCount).toBe(0)
    expect(s.origin).toEqual([10, 20, 1])
    expect(s.data.length).toBe(4 * FLOATS_PER_VERTEX)
    // first vertex: pos 0,0,0 · prev = itself · next = (1,0,0) · side -1 · colour
    expect([...s.data.slice(0, FLOATS_PER_VERTEX)]).toEqual([0, 0, 0, 0, 0, 0, 1, 0, 0, -1, 1, 0.5, 0])
    expect(s.data[FLOATS_PER_VERTEX + 9]).toBe(1)
  })
  it('joins several lines with degenerate vertices and puts posts after the path', () => {
    const s = buildStrip([[p(0, 0), p(1, 0)], [p(2, 0), p(3, 0)]], [[p(0, 0, 0), p(0, 0, 1)]])
    expect(s.pathCount).toBe(4 + 4 + 2)
    expect(s.postCount).toBe(4)
    expect(s.data.length).toBe((s.pathCount + s.postCount) * FLOATS_PER_VERTEX)
  })
  it('drops lines with fewer than two points', () => {
    expect(buildStrip([[p(0, 0)]], [[p(0, 0)]]).pathCount).toBe(0)
  })
})
