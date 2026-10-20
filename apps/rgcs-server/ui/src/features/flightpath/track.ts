// The accumulator behind the predicted path: straight pieces with ArduPlane's altitude rules
// (ALT_SLOPE_MIN slope along a leg, then TECS climb / sink limits per metre flown).
import { dist, type Xy } from './geom'
import type { PlaneParams } from './params'

export interface P3 extends Xy {
  readonly alt: number
}

/** Pieces are cut this short so a rate-limited climb bends where it levels off. */
const PIECE_M = 20
const IMMEDIATE_CLIMB_IN_AUTO = 1 << 14

export class Track {
  readonly pts: P3[] = [{ x: 0, y: 0, alt: 0 }]
  vtol = false

  private readonly p: PlaneParams

  constructor(p: PlaneParams) {
    this.p = p
  }

  get cur(): P3 {
    return this.pts[this.pts.length - 1]!
  }

  /** Climb / sink allowed per metre of ground: TECS limits at cruise speed, Q_WP_* while hovering. */
  private perMetre(): { up: number; down: number } {
    const p = this.p
    return this.vtol ? { up: p.qWpUp / p.qWpSpeed, down: p.qWpDn / p.qWpSpeed } : { up: p.climb / p.airspeed, down: p.sink / p.airspeed }
  }

  /** Straight up or down where the vehicle is (VTOL takeoff / landing, hover altitude change). */
  vertical(alt: number): void {
    const c = this.cur
    if (c.alt !== alt) this.pts.push({ x: c.x, y: c.y, alt })
  }

  /** Flies `via` in order towards `target` altitude: sloped over the whole leg when the change is large. */
  leg(via: readonly Xy[], target: number): void {
    const start = this.cur
    const total = via.reduce((s, q, i) => s + dist(i === 0 ? start : via[i - 1]!, q), 0)
    const climbNow = target > start.alt && (this.p.flightOptions & IMMEDIATE_CLIMB_IN_AUTO) !== 0
    const sloped = !this.vtol && !climbNow && Math.abs(target - start.alt) >= this.p.altSlopeMin && total > 0
    let flown = 0
    for (const q of via) {
      const from = this.cur
      const len = dist(from, q)
      const n = Math.max(1, Math.ceil(len / PIECE_M))
      for (let k = 1; k <= n; k++) {
        flown += len / n
        const want = sloped ? start.alt + ((target - start.alt) * flown) / total : target
        this.step({ x: from.x + ((q.x - from.x) * k) / n, y: from.y + ((q.y - from.y) * k) / n }, want)
      }
    }
  }

  /** One short piece: the altitude moves toward `want` no faster than the climb / sink limits. */
  step(to: Xy, want: number): void {
    const c = this.cur
    const d = dist(c, to)
    const { up, down } = this.perMetre()
    const alt = Math.min(c.alt + up * d, Math.max(c.alt - down * d, want))
    this.pts.push({ x: to.x, y: to.y, alt })
  }
}
