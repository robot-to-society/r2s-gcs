// The editor's draft: a Mission whose items carry a stable `uid` for React keys and selection.
// Every function returns a new draft; the input is never mutated.
import type { Mission, MissionFrame, MissionItem, VehicleKind } from '../../shared/api/types'
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
    mission: { id: null, name: NEW_MISSION_NAME, sysid: null, default_alt: DEFAULT_ALT, default_frame: 'rel', speed: DEFAULT_SPEED, home: null, fence: [], rally: [], surveys: [] },
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

export type TakeoffKey = 'TAKEOFF' | 'VTOL_TAKEOFF'

/** The takeoff a mission for this airframe starts with: VTOL for a QuadPlane, none for a rover. */
export function takeoffFor(kind: VehicleKind | null, quadplane: boolean): TakeoffKey | null {
  if (kind === 'rover') return null
  return kind === 'plane' && quadplane ? 'VTOL_TAKEOFF' : 'TAKEOFF'
}

/**
 * Every click adds a WAYPOINT. With the airframe's `first.takeoff`, an empty mission starts with
 * that takeoff, written without coordinates: ArduCopter and a QuadPlane climb where they stand
 * (the maps draw it above home). Without `first` (imports, tests) the first click is a takeoff there.
 */
export function appendWaypoint(d: Draft, lat: number, lon: number, first?: { readonly takeoff: TakeoffKey | null }): Draft {
  if (d.items.length > 0 || (first && !first.takeoff)) return { ...d, items: [...d.items, newItem(d, 'WAYPOINT', lat, lon)], nextUid: d.nextUid + 1 }
  if (!first?.takeoff) return { ...d, items: [newItem(d, 'TAKEOFF', lat, lon)], nextUid: d.nextUid + 1 }
  const t = newItem(d, first.takeoff, 0, 0)
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
  return { ...d, items: d.items.map((it) => (uids.has(it.uid) && !isTakeoff(it) ? { ...it, lat: it.lat + dLat, lon: it.lon + dLon } : it)) }
}

/** Inserts copies of `items` (new uids) after `afterUid`, or at the end when it is null / gone. */
export function insertItemsAfter(d: Draft, afterUid: number | null, items: readonly MissionItem[]): { draft: Draft; uids: number[] } {
  const copies = items.map((it, i) => ({ ...it, uid: d.nextUid + i }))
  const idx = afterUid === null ? -1 : d.items.findIndex((it) => it.uid === afterUid)
  const at = idx < 0 ? d.items.length : idx + 1
  const draft = { ...d, items: [...d.items.slice(0, at), ...copies, ...d.items.slice(at)], nextUid: d.nextUid + copies.length }
  return { draft, uids: copies.map((c) => c.uid) }
}

const WAYPOINT_CMD = 16
const ARC_CMD = 36

/** A WAYPOINT / ARC_WAYPOINT becomes an arc of `angle`° (+ clockwise); 0 makes it a plain waypoint again. */
export function setArc(d: Draft, uid: number, angle: number): Draft {
  const it = d.items.find((x) => x.uid === uid)
  if (!it || (it.command !== WAYPOINT_CMD && it.command !== ARC_CMD)) return d
  const command = angle === 0 ? WAYPOINT_CMD : ARC_CMD
  return updateItem(d, uid, { command, params: [angle, it.params[1], it.params[2], it.params[3]] })
}

const DO_JUMP_CMD = 177

/**
 * DO_JUMP's param1 is a mission sequence number: after an edit each jump is re-pointed at the
 * same target item (by uid), so moving / inserting / pasting never retargets it silently. A value
 * the edit itself typed stays as typed; a deleted target leaves the number alone. `pasted`: jumps
 * pasted in this edit, whose targets copied along with them go to the copy (`alias` old → new uid).
 */
export function remapJumps(prev: Draft, next: Draft, alias: ReadonlyMap<number, number> = new Map(), pasted: ReadonlySet<number> = new Set()): Draft {
  const before = new Map(prev.items.map((it) => [it.uid, it]))
  const seqOf = new Map(next.items.map((it, i) => [it.uid, i + 1]))
  let changed = false
  const items = next.items.map((it) => {
    if (it.command !== DO_JUMP_CMD) return it
    const old = before.get(it.uid)
    if (old && old.params[0] !== it.params[0]) return it
    const target = prev.items[it.params[0] - 1]?.uid
    if (target === undefined) return it
    const seq = seqOf.get(pasted.has(it.uid) ? (alias.get(target) ?? target) : target)
    if (seq === undefined || seq === it.params[0]) return it
    changed = true
    return { ...it, params: [seq, it.params[1], it.params[2], it.params[3]] as [number, number, number, number] }
  })
  return changed ? { ...next, items } : next
}

/** Adds `dAlt` metres; Rel / Ter items stop at 0 m so a quick drag never puts a waypoint underground. */
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

/** Moves `uids` (kept in list order) to the slot before index `before` of the current list (drag & drop). */
export function moveItemsTo(d: Draft, uids: ReadonlySet<number>, before: number): Draft {
  const moving = d.items.filter((it) => uids.has(it.uid))
  if (moving.length === 0) return d
  const rest = d.items.filter((it) => !uids.has(it.uid))
  const at = d.items.slice(0, before).filter((it) => !uids.has(it.uid)).length
  const items = [...rest.slice(0, at), ...moving, ...rest.slice(at)]
  return items.every((it, i) => it === d.items[i]) ? d : { ...d, items }
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

/** NAV_TAKEOFF / NAV_VTOL_TAKEOFF: flown where the vehicle stands, so the map pins it there. */
export const isTakeoff = (it: MissionItem): boolean => it.command === 22 || it.command === 84

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
