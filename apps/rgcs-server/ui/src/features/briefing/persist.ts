// Browser persistence of the briefing workspace (localStorage, versioned, never throws).
import type { Mission } from '../../shared/api/types'
import { toMission } from '../mission/model'
import { INITIAL_MISSION_UI, loaded, type MissionStore, type MissionUi } from '../mission/store'
import { parkActive, reseedKeys, type Row, type Workspace } from './model'
import { replaceWorkspace, type BriefingStore } from './store'

export const STORAGE_KEY = 'rgcs.briefing.v1'

interface StoredRow {
  readonly key: string
  readonly color: string
  readonly sysid: number | null
  readonly missing: boolean
  readonly hidden?: boolean
  readonly savedId: number | null
  readonly dirty: boolean
  readonly mission: Mission
}

export function serialize(ws: Workspace, live: MissionUi): string {
  const parked = parkActive(ws, live)
  const rows: StoredRow[] = parked.rows.map((r) => ({
    key: r.key,
    color: r.color,
    sysid: r.sysid,
    missing: r.missing,
    hidden: r.hidden,
    savedId: r.ui.savedId,
    dirty: r.ui.dirty,
    mission: toMission(r.ui.history.present),
  }))
  return JSON.stringify({ v: 1, id: parked.id, name: parked.name, active: parked.active, rows })
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)

function toRow(x: unknown): Row | null {
  if (!isObj(x) || typeof x.key !== 'string' || typeof x.color !== 'string' || !isObj(x.mission) || !Array.isArray(x.mission.items)) return null
  const savedId = typeof x.savedId === 'number' ? x.savedId : null
  const ui = { ...loaded(INITIAL_MISSION_UI, x.mission as unknown as Mission, savedId), dirty: x.dirty === true }
  return { key: x.key, color: x.color, sysid: typeof x.sysid === 'number' ? x.sysid : null, missing: x.missing === true, hidden: x.hidden === true, ui }
}

export function restore(text: string | null): Workspace | null {
  if (text === null) return null
  try {
    const p: unknown = JSON.parse(text)
    if (!isObj(p) || p.v !== 1 || !Array.isArray(p.rows) || p.rows.length === 0) return null
    const rows = p.rows.map(toRow)
    if (rows.some((r) => r === null)) return null
    const ok = rows as Row[]
    reseedKeys(ok)
    const active = typeof p.active === 'string' && ok.some((r) => r.key === p.active) ? p.active : ok[0].key
    return { id: typeof p.id === 'number' ? p.id : null, name: typeof p.name === 'string' ? p.name : '', rows: ok, active }
  } catch {
    return null
  }
}

/** Loads the saved workspace (if any) into both stores; true when something was restored. */
export function restoreInto(b: BriefingStore, m: MissionStore, storage?: Pick<Storage, 'getItem'>): boolean {
  let text: string | null = null
  try {
    text = (storage ?? localStorage).getItem(STORAGE_KEY)
  } catch {
    return false
  }
  const ws = restore(text)
  if (!ws) return false
  replaceWorkspace(b, m, ws)
  return true
}

/** Debounced write of the whole workspace on any change to either store. Returns the unsubscribe. */
export function startPersistence(b: BriefingStore, m: MissionStore, storage?: Pick<Storage, 'setItem'>, delayMs = 500): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const write = (): void => {
    timer = null
    try {
      ;(storage ?? localStorage).setItem(STORAGE_KEY, serialize(b.getState(), m.getState()))
    } catch {
      // storage full or unavailable: persistence is best-effort
    }
  }
  const schedule = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(write, delayMs)
  }
  const offB = b.subscribe(schedule)
  const offM = m.subscribe(schedule)
  return () => {
    offB()
    offM()
    if (timer !== null) clearTimeout(timer)
    timer = null
  }
}
