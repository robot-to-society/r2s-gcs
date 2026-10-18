import { apiFetch } from '../../shared/api/client'
import type { LogEntry } from '../../shared/api/types'
import { LOG_MAX } from './store'

/** The newest entries of the message log (spec 50 §2.2), newest first. */
export function fetchLog(): Promise<LogEntry[]> {
  return apiFetch<LogEntry[]>(`/api/messages?limit=${LOG_MAX}`)
}
