import { apiFetch } from '../../shared/api/client'
import type { LogEntry, SysId } from '../../shared/api/types'

/** Acknowledges a warning / error (spec 50 §2.2); idempotent, the first acknowledgement stands. */
export function ackMessage(sysid: SysId, id: number): Promise<LogEntry> {
  return apiFetch<LogEntry>(`/api/vehicles/${sysid}/messages/${id}/ack`, { method: 'POST' })
}
