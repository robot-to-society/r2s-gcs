// Where routes of different missions cross or come close, with both planned altitudes (no warnings).
import type { MissionFrame } from '../../shared/api/types'
import type { Draft } from '../mission/model'
import { positioned } from '../mission/geo'

export const APPROACH_M = 30
export const MERGE_M = 80
export const MAX_LABELS = 40

export interface Side {
  readonly key: string
  readonly alt: number
  readonly frame: MissionFrame
}

export interface CrossLabel {
  readonly lat: number
  readonly lon: number
  readonly kind: 'cross' | 'near'
  readonly a: Side
  readonly b: Side
}

interface Pt {
  readonly x: number
  readonly y: number
}

interface Leg {
  readonly key: string
  readonly p: Pt
  readonly q: Pt
  readonly altP: number
  readonly altQ: number
  readonly frame: MissionFrame
}

interface Hit {
  readonly at: Pt
  readonly kind: 'cross' | 'near'
  readonly a: Side
  readonly b: Side
  readonly pair: string
}

const M_PER_DEG = 111_320

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)
const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
const altAt = (leg: Leg, t: number) => leg.altP + (leg.altQ - leg.altP) * t

function buildLegs(missions: readonly { key: string; draft: Draft }[]): { legs: readonly Leg[]; unproject: (p: Pt) => { lat: number; lon: number } } {
  const first = missions.flatMap((m) => positioned(m.draft.items))[0]?.item
  const lat0 = first?.lat ?? 0
  const lon0 = first?.lon ?? 0
  const kLon = M_PER_DEG * Math.cos((lat0 * Math.PI) / 180)
  const project = (lat: number, lon: number): Pt => ({ x: (lon - lon0) * kLon, y: (lat - lat0) * M_PER_DEG })
  const legs = missions.flatMap(({ key, draft }) => {
    const pts = positioned(draft.items).map((p) => p.item)
    return pts.slice(1).map((end, i): Leg => {
      const start = pts[i]
      return { key, p: project(start.lat, start.lon), q: project(end.lat, end.lon), altP: start.alt, altQ: end.alt, frame: end.frame }
    })
  })
  return { legs, unproject: (p) => ({ lat: lat0 + p.y / M_PER_DEG, lon: lon0 + p.x / kLon }) }
}

/** Parameters (t on leg 1, u on leg 2) of a proper intersection, else null (parallel included). */
function intersect(l1: Leg, l2: Leg): { t: number; u: number } | null {
  const r = { x: l1.q.x - l1.p.x, y: l1.q.y - l1.p.y }
  const s = { x: l2.q.x - l2.p.x, y: l2.q.y - l2.p.y }
  const den = r.x * s.y - r.y * s.x
  if (Math.abs(den) < 1e-9) return null
  const d = { x: l2.p.x - l1.p.x, y: l2.p.y - l1.p.y }
  const t = (d.x * s.y - d.y * s.x) / den
  const u = (d.x * r.y - d.y * r.x) / den
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { t, u } : null
}

/** Parameter in 0..1 of the point on `leg` nearest to `pt`. */
function nearestT(leg: Leg, pt: Pt): number {
  const dx = leg.q.x - leg.p.x
  const dy = leg.q.y - leg.p.y
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return 0
  return Math.max(0, Math.min(1, ((pt.x - leg.p.x) * dx + (pt.y - leg.p.y) * dy) / len2))
}

/** Closest pair between two non-crossing segments: one endpoint is always part of it. */
function closest(l1: Leg, l2: Leg): { t: number; u: number; d: number } {
  const cands = [
    ...[0, 1].map((t) => ({ t, u: nearestT(l2, lerp(l1.p, l1.q, t)) })),
    ...[0, 1].map((u) => ({ u, t: nearestT(l1, lerp(l2.p, l2.q, u)) })),
  ]
  return cands
    .map((c) => ({ ...c, d: dist(lerp(l1.p, l1.q, c.t), lerp(l2.p, l2.q, c.u)) }))
    .reduce((best, c) => (c.d < best.d ? c : best))
}

function hitOf(l1: Leg, l2: Leg): Hit | null {
  const pair = [l1.key, l2.key].sort().join('\u0000')
  const x = intersect(l1, l2)
  const make = (kind: 'cross' | 'near', t: number, u: number): Hit => {
    const p1 = lerp(l1.p, l1.q, t)
    const p2 = lerp(l2.p, l2.q, u)
    return {
      at: lerp(p1, p2, 0.5),
      kind,
      pair,
      a: { key: l1.key, alt: altAt(l1, t), frame: l1.frame },
      b: { key: l2.key, alt: altAt(l2, u), frame: l2.frame },
    }
  }
  if (x) return make('cross', x.t, x.u)
  const c = closest(l1, l2)
  return c.d <= APPROACH_M ? make('near', c.t, c.u) : null
}

export function crossLabels(missions: readonly { key: string; draft: Draft }[]): readonly CrossLabel[] {
  const { legs, unproject } = buildLegs(missions)
  const hits: Hit[] = []
  for (let i = 0; i < legs.length; i++) {
    for (let j = i + 1; j < legs.length; j++) {
      if (legs[i].key === legs[j].key) continue
      const h = hitOf(legs[i], legs[j])
      if (h) hits.push(h)
    }
  }
  const ordered = [...hits.filter((h) => h.kind === 'cross'), ...hits.filter((h) => h.kind === 'near')]
  const kept: Hit[] = []
  for (const h of ordered) {
    if (!kept.some((k) => k.pair === h.pair && dist(k.at, h.at) < MERGE_M)) kept.push(h)
  }
  return kept.slice(0, MAX_LABELS).map((h) => ({ ...unproject(h.at), kind: h.kind, a: h.a, b: h.b }))
}
