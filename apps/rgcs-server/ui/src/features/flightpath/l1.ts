// A small time-step simulation of AP_L1_Control::update_loiter (ArduPilot master, 2026-10-20) for
// the capture onto a loiter circle: the geometric "head for the centre, then turn on" shape cut
// the corner where the SITL QuadPlane swung wide (it rolls in over ~half a second and the capture
// hands over to circle tracking well outside the circle). No wind: ground speed = true airspeed.
import { dist, polar, type Xy } from './geom'

export interface L1Gains {
  /** NAVL1_PERIOD (s) and NAVL1_DAMPING. */
  readonly period: number
  readonly damping: number
  /** ROLL_LIMIT_DEG caps the lateral acceleration at g·tan(limit). */
  readonly rollLimitDeg: number
}

const G = 9.80665
const DT = 0.1
/**
 * Roll-in lag (s): RLL2SRV_TCONST is 0.5 s, but the SITL QuadPlane ("Reached waypoint #2 dist 88m",
 * 2026-10-20) only matched its 438 m overshoot with about 1 s, roll rate and airframe included.
 */
const ROLL_TAU = 1.0
const MAX_STEPS = 1800
/** Sampling of the returned path (m). */
const SAMPLE_M = 10
/** On the circle: radial error and radial speed small enough to hand over to the circle walk. */
const ON_CIRCLE_M = 2
const ON_CIRCLE_RADIAL = 0.1

interface Demand {
  readonly acc: number
  readonly circle: boolean
  readonly xtrack: number
  readonly radialVel: number
}

/** Lateral acceleration demand (+ = right turn) in north/east axes, as update_loiter computes it. */
function demand(pos: Xy, vel: Xy, c: Xy, r: number, cw: boolean, g: L1Gains): Demand {
  const dir = cw ? 1 : -1
  const omega = (2 * Math.PI) / g.period
  const kx = omega * omega
  const kv = 2 * g.damping * omega
  const kL1 = 4 * g.damping * g.damping
  const v = Math.max(Math.hypot(vel.x, vel.y), 1)
  const l1Dist = (g.damping * g.period * v) / Math.PI
  // north/east components, like the source (x north, y east there)
  const an = pos.y - c.y
  const ae = pos.x - c.x
  const len = Math.hypot(an, ae)
  const un = len > 0.1 ? an / len : vel.y / v
  const ue = len > 0.1 ? ae / len : vel.x / v
  const vn = vel.y
  const ve = vel.x
  const xtrackVelCap = un * ve - ue * vn
  const ltrackVelCap = -(vn * un + ve * ue)
  const nu = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, Math.atan2(xtrackVelCap, ltrackVelCap)))
  const accCap = ((kL1 * v * v) / l1Dist) * Math.sin(nu)
  const xtrackVelCirc = -ltrackVelCap
  const xtrackErrCirc = len - r
  let pd = xtrackErrCirc * kx + xtrackVelCirc * kv
  const velTangent = xtrackVelCap * dir
  const ctr = (velTangent * velTangent) / Math.max(0.5 * r, r + xtrackErrCirc)
  if (ltrackVelCap < 0) {
    if (velTangent < 0) pd = Math.max(pd, 0)
    else if (xtrackErrCirc < 0) pd = Math.max(pd, -ctr)
  }
  const accCirc = dir * (pd + ctr)
  const capture = xtrackErrCirc > 0 && dir * accCap < dir * accCirc
  return { acc: capture ? accCap : accCirc, circle: !capture, xtrack: xtrackErrCirc, radialVel: xtrackVelCirc }
}

/**
 * Flies from `start` (unit `heading`, speed `v`) onto the circle `c`/`r`; returns the path sampled
 * every ~10 m (starting at `start`) and the polar angle where it joined the circle.
 */
export function captureLoiter(start: Xy, heading: Xy, c: Xy, r: number, cw: boolean, v: number, g: L1Gains): { pts: Xy[]; phi: number } {
  const maxAcc = G * Math.tan((g.rollLimitDeg * Math.PI) / 180)
  let pos = start
  let psi = Math.atan2(heading.x, heading.y)
  let acc = 0
  const pts: Xy[] = [start]
  for (let k = 0; k < MAX_STEPS; k++) {
    const vel = { x: v * Math.sin(psi), y: v * Math.cos(psi) }
    const d = demand(pos, vel, c, r, cw, g)
    if (d.circle && Math.abs(d.xtrack) < ON_CIRCLE_M && Math.abs(d.radialVel) < ON_CIRCLE_RADIAL * v) break
    acc += ((Math.max(-maxAcc, Math.min(maxAcc, d.acc)) - acc) * DT) / ROLL_TAU
    psi += (acc / v) * DT
    pos = { x: pos.x + v * Math.sin(psi) * DT, y: pos.y + v * Math.cos(psi) * DT }
    if (dist(pts.at(-1)!, pos) >= SAMPLE_M) pts.push(pos)
  }
  if (dist(pts.at(-1)!, pos) > 0) pts.push(pos)
  return { pts, phi: polar(c, pts.at(-1)!) }
}
