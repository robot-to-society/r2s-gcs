import { useSyncExternalStore } from 'react'
import { WsClient, defaultWsUrl } from '../../shared/ws/client'
import type { CommandResult } from '../../shared/api/types'
import { addResult, initialState, reduce, setLink, type VehiclesState } from './reducer'

type Listener = () => void

/** Single source of truth for vehicle state, fed by the WebSocket. */
export class VehicleStore {
  private state: VehiclesState = initialState
  private readonly listeners = new Set<Listener>()
  private client: WsClient | null = null

  getState = (): VehiclesState => this.state

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** `onClose` receives the WebSocket close code so the shell can re-check the session. */
  connect(url: string = defaultWsUrl(), onClose?: (code: number) => void): void {
    if (this.client) return
    this.client = new WsClient(url, {
      onMessage: (msg) => this.set(reduce(this.state, msg)),
      onOpen: () => this.set(setLink(this.state, 'open')),
      onClose: (code) => {
        this.set(setLink(this.state, 'closed'))
        onClose?.(code)
      },
    })
    this.client.start()
  }

  disconnect(): void {
    this.client?.stop()
    this.client = null
    this.set(setLink(this.state, 'closed'))
  }

  /** A result that never went through the server (e.g. 503 on send); negative ids by convention. */
  pushLocalResult(r: CommandResult): void {
    const results = addResult(this.state.results, r)
    if (results !== this.state.results) this.set({ ...this.state, results })
  }

  private set(next: VehiclesState): void {
    if (next === this.state) return
    this.state = next
    this.listeners.forEach((l) => l())
  }
}

export const vehicleStore = new VehicleStore()

export function useVehicles(store: VehicleStore = vehicleStore): VehiclesState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState)
}
