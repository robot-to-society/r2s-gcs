// Editor UI state: the draft history, selection, tool and I/O status. Pure transitions + one store.
import { useSyncExternalStore } from 'react'
import type { Finding, Mission, UploadReport } from '../../shared/api/types'
import { canRedo, canUndo, initHistory, push, redo, undo, type History } from './history'
import { emptyDraft, fromMission, removeItems, type Draft } from './model'

export type Tool = 'select' | 'add'
export type Busy = 'idle' | 'saving' | 'uploading' | 'downloading'

export interface MissionUi {
  readonly history: History<Draft>
  readonly selected: ReadonlySet<number>
  /** The uid the last plain or ⌘/Ctrl click landed on: the anchor for Shift range selection. */
  readonly anchor: number | null
  readonly tool: Tool
  readonly savedId: number | null
  readonly dirty: boolean
  readonly busy: Busy
  readonly findings: readonly Finding[]
  readonly lastReport: UploadReport | null
}

export const INITIAL_MISSION_UI: MissionUi = {
  history: initHistory(emptyDraft()),
  selected: new Set(),
  anchor: null,
  tool: 'add',
  savedId: null,
  dirty: false,
  busy: 'idle',
  findings: [],
  lastReport: null,
}

const EMPTY: ReadonlySet<number> = new Set()

function prune(selected: ReadonlySet<number>, draft: Draft): ReadonlySet<number> {
  const alive = new Set(draft.items.map((it) => it.uid))
  const kept = [...selected].filter((uid) => alive.has(uid))
  return kept.length === selected.size ? selected : new Set(kept)
}

/** Records an edit: new present, redo cleared, mission dirty. */
export const edit = (ui: MissionUi, next: Draft): MissionUi =>
  next === ui.history.present ? ui : { ...ui, history: push(ui.history, next), dirty: true, selected: prune(ui.selected, next), findings: [] }

export const undoUi = (ui: MissionUi): MissionUi => {
  if (!canUndo(ui.history)) return ui
  const history = undo(ui.history)
  return { ...ui, history, dirty: true, selected: prune(ui.selected, history.present) }
}

export const redoUi = (ui: MissionUi): MissionUi => {
  if (!canRedo(ui.history)) return ui
  const history = redo(ui.history)
  return { ...ui, history, dirty: true, selected: prune(ui.selected, history.present) }
}

/** Plain click = only this one; ⌘/Ctrl (additive) toggles it. Both move the anchor. */
export function selectOne(ui: MissionUi, uid: number, additive: boolean): MissionUi {
  if (!additive) return { ...ui, selected: new Set([uid]), anchor: uid }
  const next = new Set(ui.selected)
  if (next.has(uid)) next.delete(uid)
  else next.add(uid)
  return { ...ui, selected: next, anchor: uid }
}

/** Shift click: adds every item between the anchor and `uid` in list order (the rest stays selected). */
export function selectRange(ui: MissionUi, uid: number): MissionUi {
  const items = ui.history.present.items
  const to = items.findIndex((it) => it.uid === uid)
  const from = ui.anchor === null ? -1 : items.findIndex((it) => it.uid === ui.anchor)
  if (to < 0 || from < 0) return selectOne(ui, uid, false)
  const [a, b] = from < to ? [from, to] : [to, from]
  const range = items.slice(a, b + 1).map((it) => it.uid)
  return { ...ui, selected: new Set([...ui.selected, ...range]) }
}

export const clearSelection = (ui: MissionUi): MissionUi => (ui.selected.size === 0 ? ui : { ...ui, selected: EMPTY, anchor: null })
export const setTool = (ui: MissionUi, tool: Tool): MissionUi => (ui.tool === tool ? ui : { ...ui, tool })
export const removeSelected = (ui: MissionUi): MissionUi => (ui.selected.size === 0 ? ui : edit(ui, removeItems(ui.history.present, ui.selected)))

/** Replaces the draft with a mission from the store / vehicle / file; history starts over. */
export const loaded = (ui: MissionUi, m: Mission, savedId: number | null): MissionUi => ({
  ...ui,
  history: initHistory(fromMission(m)),
  selected: EMPTY,
  anchor: null,
  savedId,
  dirty: false,
  findings: [],
  lastReport: null,
})

export const fresh = (ui: MissionUi): MissionUi => ({ ...ui, history: initHistory(emptyDraft()), selected: EMPTY, anchor: null, savedId: null, dirty: false, findings: [], lastReport: null })
export const markSaved = (ui: MissionUi, id: number): MissionUi => ({ ...ui, savedId: id, dirty: false })
export const setBusy = (ui: MissionUi, busy: Busy): MissionUi => (ui.busy === busy ? ui : { ...ui, busy })
export const setFindings = (ui: MissionUi, findings: readonly Finding[]): MissionUi => ({ ...ui, findings })
export const setReport = (ui: MissionUi, lastReport: UploadReport | null): MissionUi => ({ ...ui, lastReport })

export class MissionStore {
  private state: MissionUi = INITIAL_MISSION_UI
  private readonly listeners = new Set<() => void>()

  getState = (): MissionUi => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  update(fn: (ui: MissionUi) => MissionUi): void {
    const next = fn(this.state)
    if (next === this.state) return
    this.state = next
    this.listeners.forEach((l) => l())
  }
}

export const missionStore = new MissionStore()

export function useMissionUi(store: MissionStore = missionStore): MissionUi {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState)
}
