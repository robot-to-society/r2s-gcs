import type { LogEntry, SysId } from '../../shared/api/types'

/** The detail panel shows the vehicle's newest three log entries (prototype `selMsgs`). */
export const DETAIL_MESSAGES = 3

export function lastForVehicle(entries: readonly LogEntry[], sysid: SysId): readonly LogEntry[] {
  return entries.filter((e) => e.sysid === sysid).slice(0, DETAIL_MESSAGES)
}

/** Warnings / errors of the vehicle still waiting for a 確認 (spec 10 §3.3). */
export function pendingAlerts(entries: readonly LogEntry[], sysid: SysId): number {
  return entries.filter((e) => e.sysid === sysid && e.ackable && e.acked_by === null).length
}
