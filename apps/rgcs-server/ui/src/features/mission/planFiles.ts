// Fence / rally files for the planner (user request 2026-10-20). Written as QGC WPL 110 with
// MAV_CMD_NAV_FENCE_* / MAV_CMD_NAV_RALLY_POINT items (what Mission Planner saves and loads); read
// from that or from a QGroundControl `.plan` (geoFence / rallyPoints). Pure: no I/O here.
import { z } from 'zod'
import type { FenceZone, RallyPoint } from '../../shared/api/types'

const POLY_INC = 5001
const POLY_EXC = 5002
const CIRCLE_INC = 5003
const CIRCLE_EXC = 5004
const RALLY = 5100
const FRAME_GLOBAL = 0
const FRAME_REL = 3
const MAX_ZONES = 100
const MAX_RALLY = 100

const lat = z.number().min(-90).max(90)
const lon = z.number().min(-180).max(180)
const zoneSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('polygon'), inclusion: z.boolean(), vertices: z.array(z.object({ lat, lon })).min(1).max(255) }),
  z.object({ kind: z.literal('circle'), inclusion: z.boolean(), center: z.object({ lat, lon }), radius: z.number().positive() }),
])
const zonesSchema = z.array(zoneSchema).min(1).max(MAX_ZONES)
const rallySchema = z.array(z.object({ lat, lon, alt: z.number() })).min(1).max(MAX_RALLY)

const f8 = (n: number) => n.toFixed(8)
const line = (seq: number, frame: number, cmd: number, p1: number, la: number, lo: number, alt: number) =>
  [seq, 0, frame, cmd, p1, 0, 0, 0, f8(la), f8(lo), alt.toFixed(6), 1].join('\t')

export function fenceToWpl(zones: readonly FenceZone[]): string {
  const rows: string[] = []
  for (const zn of zones) {
    if (zn.kind === 'polygon') zn.vertices.forEach((v) => rows.push(line(rows.length, FRAME_GLOBAL, zn.inclusion ? POLY_INC : POLY_EXC, zn.vertices.length, v.lat, v.lon, 0)))
    else rows.push(line(rows.length, FRAME_GLOBAL, zn.inclusion ? CIRCLE_INC : CIRCLE_EXC, zn.radius, zn.center.lat, zn.center.lon, 0))
  }
  return ['QGC WPL 110', ...rows, ''].join('\n')
}

export function rallyToWpl(points: readonly RallyPoint[]): string {
  return ['QGC WPL 110', ...points.map((r, i) => line(i, FRAME_REL, RALLY, 0, r.lat, r.lon, r.alt)), ''].join('\n')
}

interface Row {
  readonly cmd: number
  readonly p1: number
  readonly lat: number
  readonly lon: number
  readonly alt: number
}

function wplRows(text: string): Row[] | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (!lines[0]?.startsWith('QGC WPL')) return null
  return lines.slice(1).map((l) => {
    const c = l.split(/\s+/).map(Number)
    return { cmd: c[3]!, p1: c[4]!, lat: c[8]!, lon: c[9]!, alt: c[10]! }
  })
}

function wplZones(rows: readonly Row[]): FenceZone[] {
  const zones: FenceZone[] = []
  for (let i = 0; i < rows.length; ) {
    const r = rows[i]!
    if (r.cmd === CIRCLE_INC || r.cmd === CIRCLE_EXC) {
      zones.push({ kind: 'circle', inclusion: r.cmd === CIRCLE_INC, center: { lat: r.lat, lon: r.lon }, radius: r.p1 })
      i++
    } else if (r.cmd === POLY_INC || r.cmd === POLY_EXC) {
      // param1 is the polygon's vertex count: it separates adjacent polygons of one kind
      const n = Math.max(1, Math.round(r.p1))
      const run = rows.slice(i, i + n).filter((x) => x.cmd === r.cmd)
      zones.push({ kind: 'polygon', inclusion: r.cmd === POLY_INC, vertices: run.map((x) => ({ lat: x.lat, lon: x.lon })) })
      i += run.length
    } else i++
  }
  return zones
}

const planSchema = z.object({
  geoFence: z
    .object({
      polygons: z.array(z.object({ inclusion: z.boolean(), polygon: z.array(z.tuple([z.number(), z.number()])) })).default([]),
      circles: z.array(z.object({ inclusion: z.boolean(), circle: z.object({ center: z.tuple([z.number(), z.number()]), radius: z.number() }) })).default([]),
    })
    .optional(),
  rallyPoints: z.object({ points: z.array(z.array(z.number()).min(3)) }).optional(),
})

function readPlan(text: string): z.infer<typeof planSchema> | null {
  if (!text.trimStart().startsWith('{')) return null
  return planSchema.parse(JSON.parse(text))
}

/** The fence zones in a WPL or `.plan` file; throws when there are none or the file is malformed. */
export function parseFenceFile(text: string): FenceZone[] {
  const rows = wplRows(text)
  if (rows) return zonesSchema.parse(wplZones(rows))
  const plan = readPlan(text)
  if (!plan) throw new Error('not a fence file')
  const g = plan.geoFence
  const zones: FenceZone[] = [
    ...(g?.polygons ?? []).map((p) => ({ kind: 'polygon' as const, inclusion: p.inclusion, vertices: p.polygon.map(([la, lo]) => ({ lat: la, lon: lo })) })),
    ...(g?.circles ?? []).map((c) => ({ kind: 'circle' as const, inclusion: c.inclusion, center: { lat: c.circle.center[0], lon: c.circle.center[1] }, radius: c.circle.radius })),
  ]
  return zonesSchema.parse(zones)
}

/** The rally points in a WPL or `.plan` file; throws when there are none or the file is malformed. */
export function parseRallyFile(text: string): RallyPoint[] {
  const rows = wplRows(text)
  if (rows) return rallySchema.parse(rows.filter((r) => r.cmd === RALLY).map((r) => ({ lat: r.lat, lon: r.lon, alt: r.alt })))
  const plan = readPlan(text)
  if (!plan) throw new Error('not a rally file')
  return rallySchema.parse((plan.rallyPoints?.points ?? []).map((p) => ({ lat: p[0]!, lon: p[1]!, alt: p[2]! })))
}
