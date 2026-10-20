// The briefing workspace: rows of missions. The live editor (MissionStore) always holds the active row.
import { useSyncExternalStore } from 'react'
import type { MissionStore, MissionUi } from '../mission/store'
import { activate, activeRow, addRow, emptyWorkspace, parkActive, reseedKeys, type Workspace } from './model'

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

const loadActive = (b: BriefingStore, m: MissionStore): void => {
  const ui = activeRow(b.getState()).ui
  m.update(() => ui)
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
  b.update(() => ws)
  loadActive(b, m)
}
