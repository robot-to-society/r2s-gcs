import { useSyncExternalStore } from 'react'
import type { VehicleState } from '../../shared/api/types'
import { hasPosition } from './markers'
import { appendPoint, type Tracks } from './tracks'

/** Accumulates vehicle positions into tracks; fed from the vehicle store, read by the map. */
export class TracksStore {
  private state: Tracks = new Map()
  private readonly listeners = new Set<() => void>()

  getState = (): Tracks => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  ingest(vehicles: ReadonlyMap<number, VehicleState>): void {
    let next = this.state
    for (const v of vehicles.values()) if (hasPosition(v)) next = appendPoint(next, v.sysid, v.lon, v.lat)
    if (next === this.state) return
    this.state = next
    this.listeners.forEach((l) => l())
  }
}

export const tracksStore = new TracksStore()

export function useTracks(store: TracksStore = tracksStore): Tracks {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState)
}
