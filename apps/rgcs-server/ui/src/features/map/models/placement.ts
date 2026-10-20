// Where a vehicle model sits in MapLibre's mercator world: column-major model matrices in float64
// (the layer multiplies them with the frame matrix before handing float32 to the GPU).
import { toMercator } from '../air'

export interface ModelAt {
  readonly lon: number
  readonly lat: number
  /** Metres above mean sea level (as the 3D layer draws the vehicle). */
  readonly amsl: number
}

/**
 * Model units → mercator: +x right, +y nose, +z up, each `size` mercator units long, turned to
 * `hdgDeg` (clockwise from north). Mercator y grows southwards, so north is −y.
 */
export function modelMatrix(at: ModelAt, hdgDeg: number, size: number): Float64Array {
  const o = toMercator(at.lon, at.lat, at.amsl)
  const h = (hdgDeg * Math.PI) / 180
  const [s, c] = [Math.sin(h), Math.cos(h)]
  // prettier-ignore
  return Float64Array.from([
    c * size, s * size, 0, 0, // right
    s * size, -c * size, 0, 0, // nose
    0, 0, size, 0, // up
    o.x, o.y, o.z, 1,
  ])
}

/** A model `px` pixels long at `zoom` (MapLibre's 512 px tiles), but never smaller than `realMerc`. */
export function screenSizeMerc(px: number, zoom: number, realMerc: number): number {
  return Math.max(px / (512 * 2 ** zoom), realMerc)
}

/** a · b for column-major 4×4 matrices. */
export function mul4(a: ArrayLike<number>, b: ArrayLike<number>): Float64Array {
  const out = new Float64Array(16)
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let sum = 0
    for (let k = 0; k < 4; k++) sum += a[k * 4 + r]! * b[c * 4 + k]!
    out[c * 4 + r] = sum
  }
  return out
}
