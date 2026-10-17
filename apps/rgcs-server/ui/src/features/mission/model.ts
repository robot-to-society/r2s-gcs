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

/** The first point of an empty mission is the TAKEOFF; every later click adds a WAYPOINT. */
export function appendWaypoint(d: Draft, lat: number, lon: number): Draft {
  const key = d.items.length === 0 ? 'TAKEOFF' : 'WAYPOINT'
  return { ...d, items: [...d.items, newItem(d, key, lat, lon)], nextUid: d.nextUid + 1 }
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

export function cmdKey(it: MissionItem): string {
  return cmdKeyOf(it.command) ?? `CMD_${it.command}`
}
