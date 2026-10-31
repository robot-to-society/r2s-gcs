// The saved LTE areas, shared by both maps and the manage sheet. While an area is fetching the
// list is read again every second (progress, and the maps pick up the new tiles when it ends).
import { useEffect, useSyncExternalStore } from 'react'
import type { LteArea } from '../../shared/api/types'
import { listLteAreas } from './api'

export interface LteAreasState {
  readonly areas: readonly LteArea[]
  readonly loaded: boolean
  /** The last read failed (the list shown is the one before). */
  readonly error: boolean
}

export const POLL_MS = 1000
const INITIAL: LteAreasState = { areas: [], loaded: false, error: false }

export class LteAreasStore {
  private state: LteAreasState = INITIAL
  private readonly load: () => Promise<readonly LteArea[]>
  private readonly listeners = new Set<() => void>()
  private inflight: Promise<void> | null = null
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(load: () => Promise<readonly LteArea[]> = listLteAreas) {
    this.load = load
  }

  getState = (): LteAreasState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) this.stopPolling()
    }
  }

  /** Reads the list unless it was read already (or is being read). */
  ensureLoaded(): void {
    if (!this.state.loaded && !this.inflight) void this.reload()
  }

  /** Reads the list now; never throws. */
  reload(): Promise<void> {
    this.inflight ??= this.fetchOnce().finally(() => {
      this.inflight = null
      this.schedule()
    })
    return this.inflight
  }

  private async fetchOnce(): Promise<void> {
    try {
      const areas = await this.load()
      this.set({ areas: [...areas], loaded: true, error: false })
    } catch {
      this.set({ ...this.state, loaded: true, error: true })
    }
  }

  private schedule(): void {
    const fetching = this.state.areas.some((a) => a.status === 'fetching')
    if (!fetching || this.listeners.size === 0 || this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.reload()
    }, POLL_MS)
  }

  private stopPolling(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private set(next: LteAreasState): void {
    this.state = next
    this.listeners.forEach((l) => l())
  }
}

let shared: LteAreasStore | null = null
/** The app's store, made on first use (tests make their own). */
export const lteAreasStore = (): LteAreasStore => (shared ??= new LteAreasStore())

/** The areas; `active` reads them from the server once. */
export function useLteAreas(active: boolean, store: LteAreasStore = lteAreasStore()): LteAreasState {
  useEffect(() => {
    if (active) store.ensureLoaded()
  }, [active, store])
  return useSyncExternalStore(store.subscribe, store.getState, store.getState)
}
