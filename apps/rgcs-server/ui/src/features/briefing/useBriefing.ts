// Wires the briefing workspace to the planner: restore / persist (app stores only), the list's
// handlers and "open a mission" for the file / saved / vehicle / new entry points.
import { useEffect, useMemo } from 'react'
import { canUndo } from '../mission/history'
import { missionStore, type MissionStore, type MissionUi } from '../mission/store'
import type { LatLon } from '../mission/geo'
import { framePoints } from './frame'
import { activeRow, assign, moveRow, parkActive, removeRow, setColor, setHidden, type Row, type Workspace } from './model'
import { restoreInto, startPersistence } from './persist'
import { briefingStore, carryClipboard, loadActive, openInNewRow, switchRow, useWorkspace, type BriefingStore } from './store'

let restored = false

/** An editor nobody has touched yet (the starting row, or one made by 新規). */
export function isPristine(ui: MissionUi): boolean {
  const d = ui.history.present
  return ui.savedId === null && !ui.dirty && d.items.length === 0 && d.mission.fence.length === 0 && d.mission.rally.length === 0 && !canUndo(ui.history)
}

/**
 * Opens a mission in the briefing: an untouched live editor takes it in place (a single-mission
 * session stays one row), otherwise it gets a new row (or the row already holding that saved mission).
 */
export function openMission(b: BriefingStore, m: MissionStore, ui: MissionUi): void {
  const ws = b.getState()
  const elsewhere = ui.savedId !== null && ws.rows.some((r) => r.key !== ws.active && r.ui.savedId === ui.savedId)
  if (!elsewhere && isPristine(m.getState())) m.update((live) => carryClipboard(live, ui))
  else openInNewRow(b, m, ui)
}

/**
 * Removes a row; when it is the one being edited, the editor moves to the row that takes its place.
 * Not while that editor is busy: a running save would mark the replacement with the removed one's id.
 */
export function removeLive(b: BriefingStore, m: MissionStore, key: string): void {
  const wasActive = b.getState().active === key
  if (wasActive && m.getState().busy !== 'idle') return
  b.update((w) => removeRow(wasActive ? parkActive(w, m.getState()) : w, key))
  if (wasActive) loadActive(b, m)
}

/** Switches rows unless a save / write / read is running (its result belongs to the current row). */
export function switchIfIdle(b: BriefingStore, m: MissionStore, key: string): void {
  if (m.getState().busy === 'idle') switchRow(b, m, key)
}

/** What BriefingList takes from the workspace (the rest comes from the view). */
export interface BriefingListWiring {
  readonly workspace: Workspace
  readonly onSwitch: (key: string) => void
  readonly onAssign: (key: string, sysid: number | null) => void
  readonly onRemove: (key: string) => void
  readonly onMove: (key: string, delta: -1 | 1) => void
  readonly onColor: (key: string, color: string) => void
  readonly onHidden: (key: string, hidden: boolean) => void
  /** Double-click: frame that row's mission on the map. */
  readonly onFrame: (key: string) => void
}

/** The row's mission as it stands: the live editor for the active row, else its parked draft. */
export function rowFramePoints(b: BriefingStore, m: MissionStore, key: string): LatLon[] {
  const ws = b.getState()
  const draft = key === ws.active ? m.getState().history.present : ws.rows.find((r) => r.key === key)?.ui.history.present
  return draft ? framePoints(draft) : []
}

export interface BriefingHandlers {
  readonly list: BriefingListWiring
  readonly row: Row
  /** The active path's colour: its row colour once two missions are open; alone it keeps the altitude colours. */
  readonly pathColor: string | undefined
  /** The editor's vehicle choice: always the active row's assignment (one vehicle per row). */
  readonly assignActive: (sysid: number | null) => void
}

/** `workspace` shows the live editor in the active row (its current name / items). */
/** `onFit`: frames points on the planner map (the row double-click). */
export function useBriefing(b: BriefingStore, m: MissionStore, live: MissionUi, onFit?: (points: readonly LatLon[]) => void): BriefingHandlers {
  const ws = useWorkspace(b)
  useEffect(() => {
    if (b !== briefingStore || m !== missionStore) return
    if (!restored) {
      restored = true
      restoreInto(b, m)
    }
    return startPersistence(b, m)
  }, [b, m])
  const workspace = useMemo(() => parkActive(ws, live), [ws, live])
  const list: BriefingListWiring = {
    workspace,
    onSwitch: (key) => switchIfIdle(b, m, key),
    onAssign: (key, sysid) => b.update((w) => assign(w, key, sysid)),
    onRemove: (key) => removeLive(b, m, key),
    onMove: (key, delta) => b.update((w) => moveRow(w, key, delta)),
    onColor: (key, color) => b.update((w) => setColor(w, key, color)),
    onHidden: (key, hidden) => b.update((w) => setHidden(w, key, hidden)),
    onFrame: (key) => {
      const pts = rowFramePoints(b, m, key)
      if (pts.length > 0) onFit?.(pts)
    },
  }
  const row = activeRow(workspace)
  const pathColor = workspace.rows.filter((r) => !r.missing).length > 1 ? row.color : undefined
  return { list, row, pathColor, assignActive: (sysid) => b.update((w) => assign(w, w.active, sysid)) }
}
