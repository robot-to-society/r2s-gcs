// The briefing workspace: rows of missions. The live editor (MissionStore) always holds the active row.
import { useSyncExternalStore } from 'react'
import type { MissionStore, MissionUi } from '../mission/store'
import { activate, activeRow, addRow, emptyWorkspace, parkActive, reseedKeys, showActive, type Workspace } from './model'

export class BriefingStore {
  private state: Workspace = emptyWorkspace()
  private readonly listeners = new Set<() => void>()

  getState = (): Workspace => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  update(fn: (w: Workspace) => Workspace): void {
    const next = fn(this.state)
    if (next === this.state) return
    this.state = next
    this.listeners.forEach((l) => l())
  }
}

export const briefingStore = new BriefingStore()

export function useWorkspace(store: BriefingStore = briefingStore): Workspace {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState)
}

/** `to` with `from`'s clipboard: ⌘C / ⌘V works across missions (the clipboard belongs to the editor, not a row). */
export function carryClipboard(from: MissionUi, to: MissionUi): MissionUi {
  if (to.clipboard === from.clipboard && to.clipboardUids === from.clipboardUids) return to
  return { ...to, clipboard: from.clipboard, clipboardUids: from.clipboardUids }
}

/** Loads the active row into the live editor, keeping the editor's clipboard. */
export const loadActive = (b: BriefingStore, m: MissionStore): void => {
  const ui = activeRow(b.getState()).ui
  m.update((live) => carryClipboard(live, ui))
}

/** Parks the live editor into the active row, then loads `key`'s MissionUi into the editor. */
export function switchRow(b: BriefingStore, m: MissionStore, key: string): void {
  b.update((w) => activate(parkActive(w, m.getState()), key))
  loadActive(b, m)
}

/** Adds a row from a mission (file / saved / vehicle / new) and makes it the live editor. */
export function openInNewRow(b: BriefingStore, m: MissionStore, ui: MissionUi): void {
  b.update((w) => addRow(parkActive(w, m.getState()), ui))
  loadActive(b, m)
}

/** Replaces the whole workspace (opened briefing) and loads its active row into the editor. */
export function replaceWorkspace(b: BriefingStore, m: MissionStore, ws: Workspace): void {
  reseedKeys(ws.rows)
  b.update(() => showActive(ws))
  loadActive(b, m)
}
