import { describe, expect, it } from 'vitest'
import { toMercator } from './air'
import { floatOffset, pixelsPerMetre, projectToScreen } from './float'

// Column-major 4x4: x' = x, y' = y, z' = 0, w = 1 — plus z lifts y by one clip unit per mercator unit.
const M = [1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1]
const SIZE = { w: 200, h: 100 }

describe('projectToScreen', () => {
  it('maps clip space to CSS pixels with y down', () => {
    expect(projectToScreen(M, SIZE, { x: 0, y: 0, z: 0 })).toEqual({ x: 100, y: 50 })
    expect(projectToScreen(M, SIZE, { x: 1, y: 1, z: 0 })).toEqual({ x: 200, y: 0 })
  })
  it('is null behind the camera', () => {
    const behind = [...M.slice(0, 15), -1]
    expect(projectToScreen(behind, SIZE, { x: 0, y: 0, z: 0 })).toBeNull()
  })
})

describe('floatOffset', () => {
  it('is the screen delta from the ground point to the altitude point', () => {
    expect(floatOffset(M, SIZE, { x: 0, y: 0, z: 0.5 }, { x: 100, y: 50 })).toEqual([0, -25])
  })
  it('is zero when the point cannot be projected', () => {
    expect(floatOffset([...M.slice(0, 15), -1], SIZE, { x: 0, y: 0, z: 0.5 }, { x: 100, y: 50 })).toEqual([0, 0])
  })
})

describe('pixelsPerMetre', () => {
  it('is how far one metre of altitude moves the point up the screen', () => {
    // M lifts y by one clip unit per mercator unit: half the height (50 px) per unit
    expect(pixelsPerMetre(M, SIZE, 139, 36, 1000)).toBeCloseTo(50 * toMercator(139, 36, 1).z, 12)
  })
  it('is null behind the camera', () => {
    expect(pixelsPerMetre([...M.slice(0, 15), -1], SIZE, 139, 36, 1000)).toBeNull()
  })
})
