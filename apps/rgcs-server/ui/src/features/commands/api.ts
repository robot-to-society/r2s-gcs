import { apiFetch } from '../../shared/api/client'
import type { VehicleCommand } from '../../shared/api/types'

/** A command that has not been answered in 10 s is reported failed instead of hanging the UI. */
const COMMAND_TIMEOUT_MS = 10_000

export interface ConfirmReply {
  readonly confirm_token: string
  readonly expires_in: number
}

export interface Queued {
  readonly id: number
}

/** `POST /api/vehicles/{sysid}/confirm {cmd}` → token valid for 30 s (spec 70 §1). */
export function requestConfirm(sysid: number, cmd: string): Promise<ConfirmReply> {
  return apiFetch<ConfirmReply>(`/api/vehicles/${sysid}/confirm`, { method: 'POST', body: { cmd }, timeoutMs: COMMAND_TIMEOUT_MS })
}

/** `POST /api/vehicles/{sysid}/command` with the flat `{cmd, args?, confirm_token?}` body (spec 50 §2.2). */
export function sendCommand(sysid: number, command: VehicleCommand, confirmToken?: string): Promise<Queued> {
  const body = confirmToken === undefined ? command : { ...command, confirm_token: confirmToken }
  return apiFetch<Queued>(`/api/vehicles/${sysid}/command`, { method: 'POST', body, timeoutMs: COMMAND_TIMEOUT_MS })
}
