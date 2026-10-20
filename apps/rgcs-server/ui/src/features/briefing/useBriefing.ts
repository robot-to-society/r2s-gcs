// Wires the briefing workspace to the planner: restore / persist (app stores only), the list's
// handlers and "open a mission" for the file / saved / vehicle / new entry points.
import { useEffect, useMemo } from 'react'
import { canUndo } from '../mission/history'
import { missionStore, type MissionStore, type MissionUi } from '../mission/store'
import { activeRow, assign, moveRow, parkActive, removeRow, setColor, type Row, type Workspace } from './model'
import { restoreInto, startPersistence } from './persist'
import { briefingStore, openInNewRow, switchRow, useWorkspace, type BriefingStore } from './store'

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
  if (!elsewhere && isPristine(m.getState())) m.update(() => ui)
  else openInNewRow(b, m, ui)
}

/** Removes a row; when it is the one being edited, the editor moves to the row that takes its place. */
export function removeLive(b: BriefingStore, m: MissionStore, key: string): void {
  const wasActive = b.getState().active === key
  b.update((w) => removeRow(wasActive ? parkActive(w, m.getState()) : w, key))
  if (wasActive) {
    const ui = activeRow(b.getState()).ui
    m.update(() => ui)
  }
}

/** Switches rows unless a save / write / read is running (its result belongs to the current row). */
export function switchIfIdle(b: BriefingStore, m: MissionStore, key: string): void {
  if (m.getState().busy === 'idle') switchRow(b, m, key)
}

export interface BriefingHandlers {
  readonly workspace: Workspace
  readonly row: Row
  readonly onSwitch: (key: string) => void
  readonly onAssign: (key: string, sysid: number | null) => void
  readonly onRemove: (key: string) => void
  readonly onMove: (key: string, delta: -1 | 1) => void
  readonly onColor: (key: string, color: string) => void
}

/** `workspace` shows the live editor in the active row (its current name / items). */
export function useBriefing(b: BriefingStore, m: MissionStore, live: MissionUi): BriefingHandlers {
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
  return {
    workspace,
    row: activeRow(workspace),
    onSwitch: (key) => switchIfIdle(b, m, key),
    onAssign: (key, sysid) => b.update((w) => assign(w, key, sysid)),
    onRemove: (key) => removeLive(b, m, key),
    onMove: (key, delta) => b.update((w) => moveRow(w, key, delta)),
    onColor: (key, color) => b.update((w) => setColor(w, key, color)),
  }
}
