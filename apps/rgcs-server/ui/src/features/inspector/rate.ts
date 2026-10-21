import type { VehicleCommand } from '../../shared/api/types'

/** MAV_CMD_SET_MESSAGE_INTERVAL: param1 = message id, param2 = interval in µs (0 = default, -1 = stop). */
export const MAV_CMD_SET_MESSAGE_INTERVAL = 511
export const MAX_RATE_HZ = 50
export const INTERVAL_DEFAULT = 0
export const INTERVAL_STOP = -1

/** The typed rate when it is finite and 0 < hz <= 50, otherwise null. */
export function parseHz(text: string): number | null {
  const s = text.trim()
  if (s === '') return null
  const hz = Number(s)
  return Number.isFinite(hz) && hz > 0 && hz <= MAX_RATE_HZ ? hz : null
}

export function intervalUs(hz: number): number {
  return Math.round(1e6 / hz)
}

export function intervalCommand(msgId: number, intervalMicros: number): VehicleCommand {
  return { cmd: 'other', args: { mav_cmd: MAV_CMD_SET_MESSAGE_INTERVAL, params: [msgId, intervalMicros, 0, 0, 0, 0, 0] } }
}
