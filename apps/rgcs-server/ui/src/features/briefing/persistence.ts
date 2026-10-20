// Saving the open missions as a briefing on the server, and opening one (spec 2026-10-20 §5.1).
// Missions are saved first (new / changed ones), then the briefing that refers to them by id.
import type { Briefing, BriefingFull, BriefingRow } from '../../shared/api/types'
import type { createMission, updateMission } from '../mission/api'
import { emptyDraft, toMission } from '../mission/model'
import { INITIAL_MISSION_UI, loaded, markSaved, type MissionStore, type MissionUi } from '../mission/store'
import type { createBriefing, updateBriefing } from './api'
import type { BriefingStore } from './store'
import { isPristine } from './useBriefing'
import { activeRow, emptyWorkspace, nextKey, parkActive, type Row, type Workspace } from './model'

export const NAME_MAX = 80

export interface SaveDeps {
  readonly create: typeof createMission
  readonly update: typeof updateMission
  readonly createB: typeof createBriefing
  readonly updateB: typeof updateBriefing
}

/** A save that stopped part way: `workspace` holds the missions saved so far (so a retry updates them). */
export class BriefingSaveError extends Error {
  readonly workspace: Workspace
  constructor(message: string, workspace: Workspace) {
    super(message)
    this.name = 'BriefingSaveError'
    this.workspace = workspace
  }
}

/** 1–80 characters after trimming (counted like the server: code points). */
export function validName(name: string): boolean {
  const n = [...name.trim()].length
  return n > 0 && n <= NAME_MAX
}

/** An untouched empty row (新規) is not saved as a mission, and so stays out of the briefing. */
const needsSave = (r: Row): boolean => !r.missing && (r.ui.dirty || (r.ui.savedId === null && !isPristine(r.ui)))

async function saveRow(r: Row, deps: SaveDeps): Promise<Row> {
  if (!needsSave(r)) return r
  const mission = toMission(r.ui.history.present)
  const saved = r.ui.savedId === null ? await deps.create(mission) : await deps.update(r.ui.savedId, mission)
  const id = saved.id ?? r.ui.savedId
  if (id === null) throw new Error('the server returned no mission id')
  return { ...r, ui: markSaved(r.ui, id) }
}

/** Saves each row in order; on a failure the rows saved so far travel with the error. */
async function saveRows(ws: Workspace, deps: SaveDeps): Promise<Workspace> {
  let rows = ws.rows
  for (const [i, r] of ws.rows.entries()) {
    try {
      const done = await saveRow(r, deps)
      rows = rows.map((x, j) => (j === i ? done : x))
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e)
      throw new BriefingSaveError(`${r.ui.history.present.mission.name || `#${i + 1}`}: ${why}`, { ...ws, rows })
    }
  }
  return { ...ws, rows }
}

/** The server form: missing rows stay out (they have nothing to refer to). */
export function toBriefing(ws: Workspace): Briefing {
  const kept = ws.rows.filter((r) => !r.missing && r.ui.savedId !== null)
  const rows: BriefingRow[] = kept.map((r) => ({ mission_id: r.ui.savedId as number, color: r.color, sysid: r.sysid }))
  const active = activeRow(ws)
  return { id: ws.id, name: ws.name.trim(), active_mission_id: active.missing ? null : active.ui.savedId, rows }
}

/** Something the briefing would refer to: a saved or non-empty mission (missing / untouched rows do not count). */
export const hasMissions = (ws: Workspace): boolean => ws.rows.some((r) => !r.missing && (r.ui.savedId !== null || !isPristine(r.ui)))

/**
 * Parks `live`, saves new / changed missions, then creates or updates the briefing. Refuses (before
 * any call) a briefing with no missions: it would overwrite a saved one's references with nothing.
 */
export async function saveWorkspace(ws: Workspace, live: MissionUi, deps: SaveDeps): Promise<Workspace> {
  const parked = parkActive(ws, live)
  if (!hasMissions(parked)) throw new Error('no missions to save')
  const saved = await saveRows(parked, deps)
  const b = toBriefing(saved)
  try {
    const out = b.id === null ? await deps.createB(b) : await deps.updateB(b.id, b)
    return { ...saved, id: out.id ?? b.id }
  } catch (e) {
    throw new BriefingSaveError(e instanceof Error ? e.message : String(e), saved)
  }
}

function missingUi(missionId: number): MissionUi {
  return loaded(INITIAL_MISSION_UI, { ...toMission(emptyDraft()), name: `#${missionId}` }, null)
}

/** An opened briefing as a workspace: deleted missions become empty rows marked missing; every row shown. */
export function workspaceFrom(full: BriefingFull): Workspace {
  const rows: Row[] = full.briefing.rows.map((r, i) => {
    const m = full.missions[i] ?? null
    const ui = m === null ? missingUi(r.mission_id) : loaded(INITIAL_MISSION_UI, m, r.mission_id)
    return { key: nextKey(), color: r.color, sysid: r.sysid, missing: m === null, hidden: false, ui }
  })
  if (rows.length === 0) return { ...emptyWorkspace(), id: full.briefing.id, name: full.briefing.name }
  const active = rows.find((r) => !r.missing && r.ui.savedId === full.briefing.active_mission_id) ?? rows[0]
  return { id: full.briefing.id, name: full.briefing.name, rows, active: active.key }
}

/** The editor still shows the mission that was sent (possibly edited further since). */
const sameMission = (u: MissionUi, sent: MissionUi): boolean =>
  u.history.present === sent.history.present || u.history.past.includes(sent.history.present) || u.history.future.includes(sent.history.present)

/**
 * Writes a (possibly partial) save back: the rows' saved ids / clean flags into the briefing store,
 * keeping colours, order and assignments changed meanwhile, and the active row's into the live editor
 * (still unsaved when it was edited during the save). `sent` is the editor as it was sent.
 */
export function commitSaved(b: BriefingStore, m: MissionStore, sent: MissionUi, out: Workspace): void {
  const byKey = new Map(out.rows.map((r) => [r.key, r]))
  b.update((w) => ({ ...w, id: out.id, rows: w.rows.map((r) => ({ ...r, ui: byKey.get(r.key)?.ui ?? r.ui })) }))
  const row = byKey.get(b.getState().active)
  // a failed save leaves the row dirty: the editor must keep showing it unsaved
  if (!row || row.ui.dirty || row.ui.savedId === null) return
  const id = row.ui.savedId
  m.update((u) => {
    if (u.history.present === sent.history.present) return markSaved(u, id)
    return sameMission(u, sent) ? { ...u, savedId: id } : u
  })
}
