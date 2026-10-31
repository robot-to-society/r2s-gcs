// The docomo LTE overlay switch and opacity, per browser and shared by the operations and planner
// maps (localStorage `rgcs.lteOverlay`): a viewing preference, never sent to the server.
import { useSyncExternalStore } from 'react'

export interface LteOverlayPrefs {
  readonly on: boolean
  /** Layer opacity in percent, 10–100. */
  readonly opacity: number
}

export const LTE_OVERLAY_KEY = 'rgcs.lteOverlay'
export const DEFAULT_LTE_OVERLAY: LteOverlayPrefs = { on: false, opacity: 60 }
export const MIN_OPACITY = 10
export const MAX_OPACITY = 100

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>

const clampOpacity = (v: number): number => Math.min(MAX_OPACITY, Math.max(MIN_OPACITY, Math.round(v)))

/** A stored entry; any wrong type gives the defaults. */
function read(storage: Storage): LteOverlayPrefs {
  try {
    const p: unknown = JSON.parse(storage.getItem(LTE_OVERLAY_KEY) ?? 'null')
    if (typeof p !== 'object' || p === null || Array.isArray(p)) return DEFAULT_LTE_OVERLAY
    const { on, opacity } = p as Record<string, unknown>
    if (typeof on !== 'boolean' || typeof opacity !== 'number' || !Number.isFinite(opacity)) return DEFAULT_LTE_OVERLAY
    return { on, opacity: clampOpacity(opacity) }
  } catch {
    return DEFAULT_LTE_OVERLAY
  }
}

export class LteOverlayStore {
  private state: LteOverlayPrefs
  private readonly storage: Storage
  private readonly listeners = new Set<() => void>()

  constructor(storage: Storage = localStorage) {
    this.storage = storage
    this.state = read(storage)
  }

  getState = (): LteOverlayPrefs => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  toggle(): void {
    this.set({ ...this.state, on: !this.state.on })
  }

  setOpacity(percent: number): void {
    if (!Number.isFinite(percent)) return
    this.set({ ...this.state, opacity: clampOpacity(percent) })
  }

  private set(next: LteOverlayPrefs): void {
    this.state = next
    try {
      this.storage.setItem(LTE_OVERLAY_KEY, JSON.stringify(next))
    } catch {
      // storage blocked or full: the choice lasts for this page only
    }
    this.listeners.forEach((l) => l())
  }
}

let shared: LteOverlayStore | null = null
/** The app's store, made on first use (tests make their own). */
export const lteOverlayStore = (): LteOverlayStore => (shared ??= new LteOverlayStore())

export function useLteOverlayPrefs(store: LteOverlayStore = lteOverlayStore()): LteOverlayPrefs {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState)
}
