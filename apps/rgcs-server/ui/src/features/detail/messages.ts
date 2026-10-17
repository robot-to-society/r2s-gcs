import type { VehicleMessage } from '../../shared/api/types'

/** Client-side acknowledgements (the server endpoint arrives in P2). */
export interface MessagesState {
  readonly acked: ReadonlySet<number>
}

export const EMPTY_MESSAGES: MessagesState = { acked: new Set() }

export function ack(state: MessagesState, id: number): MessagesState {
  if (state.acked.has(id)) return state
  return { acked: new Set([...state.acked, id]) }
}

export function forVehicle(messages: readonly VehicleMessage[], sysid: number): readonly VehicleMessage[] {
  return messages.filter((m) => m.sysid === sysid)
}

export function unread(messages: readonly VehicleMessage[], sysid: number, acked: ReadonlySet<number>): number {
  return messages.filter((m) => m.sysid === sysid && !acked.has(m.id)).length
}
