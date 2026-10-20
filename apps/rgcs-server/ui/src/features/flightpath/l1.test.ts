import { describe, expect, it } from 'vitest'
import { dist, polar, type Xy } from './geom'
import { captureLoiter } from './l1'

const l1 = { period: 14, damping: 0.75, rollLimitDeg: 65 }
const heading = (deg: number): Xy => ({ x: Math.sin(deg * (Math.PI / 180)), y: Math.cos(deg * (Math.PI / 180)) })

describe('L1 loiter capture (AP_L1_Control::update_loiter)', () => {
  it('ends on the circle, travelling the loiter way round', () => {
    const c = { x: 0, y: 0 }
    const { pts, phi } = captureLoiter({ x: -400, y: 0 }, heading(0), c, 80, true, 27, l1)
    const end = pts.at(-1)!
    expect(Math.abs(dist(end, c) - 80)).toBeLessThan(3)
    expect(phi).toBeCloseTo(polar(c, end))
    // clockwise: the last step moves the polar angle downwards
    const before = pts.at(-2)!
    expect(Math.sin(polar(c, end) - polar(c, before))).toBeLessThan(0)
  })

  it('swings wide like the SITL QuadPlane (2026-10-20): from heading 320° the centre lies 105° off to the right', () => {
    // track sampled at 1 Hz: after leaving the leg at (-88, 363) the plane went as far north as 438 m
    const { pts } = captureLoiter({ x: -88, y: 363 }, heading(-40), { x: 31, y: 332 }, 74, true, 27, l1)
    const north = Math.max(...pts.map((p) => p.y))
    expect(north).toBeGreaterThan(420)
    expect(north).toBeLessThan(455)
  })

  it('starting on the circle there is nothing to capture', () => {
    const { pts } = captureLoiter({ x: 80, y: 0 }, heading(180), { x: 0, y: 0 }, 80, true, 27, l1)
    expect(pts.length).toBeLessThanOrEqual(2)
  })
})
