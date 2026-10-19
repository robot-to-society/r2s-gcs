// The editor's draft: a Mission whose items carry a stable `uid` for React keys and selection.
// Every function returns a new draft; the input is never mutated.
import type { Mission, MissionFrame, MissionItem } from '../../shared/api/types'
import { CMDS, cmdKeyOf, type FieldSpec } from './cmds'

export interface DraftItem extends MissionItem {
  readonly uid: number
}

export interface Draft {
  readonly mission: Omit<Mission, 'items'>
  readonly items: readonly DraftItem[]
  readonly nextUid: number
}

export const DEFAULT_ALT = 50
export const DEFAULT_SPEED = 8
export const NEW_MISSION_NAME = '新しいミッション'

export function emptyDraft(): Draft {
  return {
    mission: { id: null, name: NEW_MISSION_NAME, sysid: null, default_alt: DEFAULT_ALT, default_frame: 'rel', speed: DEFAULT_SPEED, home: null },
    items: [],
    nextUid: 1,
  }
}

export function fromMission(m: Mission): Draft {
  const { items, ...mission } = m
  return { mission, items: items.map((it, i) => ({ ...it, uid: i + 1 })), nextUid: items.length + 1 }
}

export function toMission(d: Draft): Mission {
  return { ...d.mission, items: d.items.map(({ uid: _uid, ...it }) => it) }
}

/** Default params for a command: param index 1–4 from the field defaults, the rest 0. */
export function defaultParams(key: string): [number, number, number, number] {
  const params: [number, number, number, number] = [0, 0, 0, 0]
  for (const f of CMDS[key]?.fields ?? []) if (f.p <= 4) params[f.p - 1] = f.def
  return params
}

function defaultExtra(key: string): { lat: number; lon: number; alt: number } {
  const out = { lat: 0, lon: 0, alt: 0 }
  for (const f of (CMDS[key]?.fields ?? []) as readonly FieldSpec[]) {
    if (f.p === 5) out.lat = f.def
    if (f.p === 6) out.lon = f.def
    if (f.p === 7) out.alt = f.def
  }
  return out
}

function newItem(d: Draft, key: string, lat: number, lon: number): DraftItem {
  const spec = CMDS[key]
  return {
    uid: d.nextUid,
    command: spec?.id ?? 16,
    frame: d.mission.default_frame,
    params: defaultParams(key),
    lat,
    lon,
    alt: spec?.alt ? d.mission.default_alt : 0,
    autocontinue: true,
  }
}

/**
 * Every click adds a WAYPOINT. On an empty mission a TAKEOFF comes first, at `takeoffAt` (the
 * vehicle or the home) when known: ArduCopter ignores NAV_TAKEOFF's lat / lon and climbs where
 * it stands, so a TAKEOFF drawn at the click would show a leg that is never flown.
 */
export function appendWaypoint(d: Draft, lat: number, lon: number, takeoffAt: { lat: number; lon: number } | null = null): Draft {
  if (d.items.length > 0) return { ...d, items: [...d.items, newItem(d, 'WAYPOINT', lat, lon)], nextUid: d.nextUid + 1 }
  if (!takeoffAt) return { ...d, items: [newItem(d, 'TAKEOFF', lat, lon)], nextUid: d.nextUid + 1 }
  const t = newItem(d, 'TAKEOFF', takeoffAt.lat, takeoffAt.lon)
  const w = newItem({ ...d, nextUid: d.nextUid + 1 }, 'WAYPOINT', lat, lon)
  return { ...d, items: [t, w], nextUid: d.nextUid + 2 }
}

export function insertAfter(d: Draft, uid: number, lat: number, lon: number): Draft {
  const idx = d.items.findIndex((it) => it.uid === uid)
  if (idx < 0) return d
  const item = newItem(d, 'WAYPOINT', lat, lon)
  return { ...d, items: [...d.items.slice(0, idx + 1), item, ...d.items.slice(idx + 1)], nextUid: d.nextUid + 1 }
}

export function removeItems(d: Draft, uids: ReadonlySet<number>): Draft {
  if (uids.size === 0) return d
  return { ...d, items: d.items.filter((it) => !uids.has(it.uid)) }
}

export function updateItem(d: Draft, uid: number, patch: Partial<MissionItem>): Draft {
  return { ...d, items: d.items.map((it) => (it.uid === uid ? { ...it, ...patch } : it)) }
}

export function moveItem(d: Draft, uid: number, lat: number, lon: number): Draft {
  return updateItem(d, uid, { lat, lon })
}

export function moveItems(d: Draft, uids: ReadonlySet<number>, dLat: number, dLon: number): Draft {
  return { ...d, items: d.items.map((it) => (uids.has(it.uid) ? { ...it, lat: it.lat + dLat, lon: it.lon + dLon } : it)) }
}

/** Adds `dAlt` metres; Rel / Ter items stop at 0 m so a quick drag never puts a waypoint underground. */
/** Inserts copies of `items` (new uids) after `afterUid`, or at the end when it is null / gone. */
export function insertItemsAfter(d: Draft, afterUid: number | null, items: readonly MissionItem[]): { draft: Draft; uids: number[] } {
  const copies = items.map((it, i) => ({ ...it, uid: d.nextUid + i }))
  const idx = afterUid === null ? -1 : d.items.findIndex((it) => it.uid === afterUid)
  const at = idx < 0 ? d.items.length : idx + 1
  const draft = { ...d, items: [...d.items.slice(0, at), ...copies, ...d.items.slice(at)], nextUid: d.nextUid + copies.length }
  return { draft, uids: copies.map((c) => c.uid) }
}

export function shiftAlts(d: Draft, uids: ReadonlySet<number>, dAlt: number): Draft {
  const alt = (it: DraftItem) => (it.frame === 'abs' ? it.alt + dAlt : Math.max(0, it.alt + dAlt))
  return { ...d, items: d.items.map((it) => (uids.has(it.uid) ? { ...it, alt: alt(it) } : it)) }
}

export function reorder(d: Draft, uid: number, dir: -1 | 1): Draft {
  const idx = d.items.findIndex((it) => it.uid === uid)
  const to = idx + dir
  if (idx < 0 || to < 0 || to >= d.items.length) return d
  const items = [...d.items]
  const [moved] = items.splice(idx, 1)
  if (!moved) return d
  items.splice(to, 0, moved)
  return { ...d, items }
}

/** Switch the MAV_CMD: params reset to the new defaults; the position is kept only for positional commands. */
export function setCommand(d: Draft, uid: number, key: string): Draft {
  const spec = CMDS[key]
  if (!spec) return d
  const extra = defaultExtra(key)
  return {
    ...d,
    items: d.items.map((it) => {
      if (it.uid !== uid) return it
      const positional = spec.pos
      return {
        ...it,
        command: spec.id,
        params: defaultParams(key),
        lat: positional ? it.lat : extra.lat,
        lon: positional ? it.lon : extra.lon,
        alt: positional ? (spec.alt ? it.alt || d.mission.default_alt : 0) : extra.alt,
      }
    }),
  }
}

export function setAltBulk(d: Draft, uids: ReadonlySet<number>, alt: number, frame: MissionFrame): Draft {
  return { ...d, items: d.items.map((it) => (uids.has(it.uid) ? { ...it, alt, frame } : it)) }
}

export function setMeta(d: Draft, patch: Partial<Omit<Mission, 'items'>>): Draft {
  return { ...d, mission: { ...d.mission, ...patch } }
}

/** NAV_TAKEOFF: ArduCopter ignores its lat / lon, so the map pins it at the take-off point. */
export const isTakeoff = (it: MissionItem): boolean => it.command === 22

export function cmdKey(it: MissionItem): string {
  return cmdKeyOf(it.command) ?? `CMD_${it.command}`
}

/** Inserts a command after `afterUid` (or at the end when null). Positional commands land next to the previous positioned item. */
export function insertCommandAfter(d: Draft, afterUid: number | null, key: string): Draft {
  const spec = CMDS[key]
  if (!spec) return d
  const idx = afterUid === null ? d.items.length - 1 : d.items.findIndex((it) => it.uid === afterUid)
  const anchor = [...d.items.slice(0, idx + 1)].reverse().find((it) => CMDS[cmdKey(it)]?.pos && !(it.lat === 0 && it.lon === 0))
  const lat = spec.pos && anchor ? anchor.lat + 0.0005 : spec.pos ? 36.162 : 0
  const lon = spec.pos && anchor ? anchor.lon + 0.0005 : spec.pos ? 139.372 : 0
  const base = newItem(d, key, lat, lon)
  const item = spec.pos ? base : { ...base, lat: 0, lon: 0 }
  return { ...d, items: [...d.items.slice(0, idx + 1), item, ...d.items.slice(idx + 1)], nextUid: d.nextUid + 1 }
}

export function reverseItems(d: Draft): Draft {
  return d.items.length < 2 ? d : { ...d, items: [...d.items].reverse() }
}

export function clearItems(d: Draft): Draft {
  return d.items.length === 0 ? d : { ...d, items: [] }
}
