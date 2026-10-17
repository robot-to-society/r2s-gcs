import { useSyncExternalStore } from 'react'

export type PickMode = 'none' | 'guided-target'

export interface LatLon {
  readonly lat: number
  readonly lon: number
}

export interface MapUi {
  readonly follow: number | null
  readonly selected: number | null
  readonly aside: 'full' | 'rail'
  readonly pick: PickMode
  readonly target: LatLon | null
}

export const INITIAL_MAP_UI: MapUi = { follow: null, selected: null, aside: 'full', pick: 'none', target: null }

export const setFollow = (s: MapUi, sysid: number): MapUi => (s.follow === sysid ? s : { ...s, follow: sysid })
export const clearFollow = (s: MapUi): MapUi => (s.follow === null ? s : { ...s, follow: null })
export const select = (s: MapUi, sysid: number | null): MapUi => (s.selected === sysid ? s : { ...s, selected: sysid })
export const toggleAside = (s: MapUi): MapUi => ({ ...s, aside: s.aside === 'full' ? 'rail' : 'full' })
export const startPick = (s: MapUi, pick: PickMode): MapUi => ({ ...s, pick, target: null })
export const setTarget = (s: MapUi, target: LatLon): MapUi => ({ ...s, pick: 'none', target })
export const cancelPick = (s: MapUi): MapUi => (s.pick === 'none' && s.target === null ? s : { ...s, pick: 'none', target: null })

/** Map UI state shared by the shell, the list and the modals. */
export class MapUiStore {
  private state: MapUi = INITIAL_MAP_UI
  private readonly listeners = new Set<() => void>()

  getState = (): MapUi => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  update(fn: (s: MapUi) => MapUi): void {
    const next = fn(this.state)
    if (next === this.state) return
    this.state = next
    this.listeners.forEach((l) => l())
  }
}

export const mapUiStore = new MapUiStore()

export function useMapUi(store: MapUiStore = mapUiStore): MapUi {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState)
}
