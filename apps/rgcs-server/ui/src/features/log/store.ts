import type { LogEntry, SysId, VehicleMessage } from '../../shared/api/types'

/** The history sheet shows the newest 500; older rows live in maintenance › log (spec 10 §1). */
export const LOG_MAX = 500

export type LogFilter = 'all' | 'alerts' | SysId

export interface LogState {
  /** Newest first, unique by id, at most `LOG_MAX`. */
  readonly entries: readonly LogEntry[]
  /** Warnings / errors that arrived while the sheet was closed. */
  readonly unreadAlerts: number
  readonly open: boolean
  readonly filter: LogFilter
}

export type LogEvent =
  | { readonly k: 'loaded'; readonly entries: readonly LogEntry[] }
  | { readonly k: 'entry'; readonly entry: LogEntry }
  | {
      readonly k: 'ack'
      readonly id: number
      readonly by: string
      readonly ts: number
    }
  | { readonly k: 'open'; readonly filter?: LogFilter }
  | { readonly k: 'filter'; readonly filter: LogFilter }
  | { readonly k: 'close' }

export const EMPTY_LOG: LogState = {
  entries: [],
  unreadAlerts: 0,
  open: false,
  filter: 'all',
}

export const isAlert = (e: LogEntry): boolean => e.severity === 'warn' || e.severity === 'error'

export function toLogEntry(m: VehicleMessage): LogEntry {
  return {
    id: m.id,
    ts: m.ts,
    sysid: m.sysid,
    source: m.source,
    severity: m.level,
    text: m.text,
    ackable: m.ackable,
    acked_by: m.acked_by,
    acked_at: m.acked_at,
  }
}

/** Newest first by id; local entries (negative ids) sort by time among them. */
function merge(current: readonly LogEntry[], incoming: readonly LogEntry[]): readonly LogEntry[] {
  const byId = new Map(current.map((x) => [x.id, x]))
  incoming.forEach((x) => {
    if (!byId.has(x.id)) byId.set(x.id, x)
  })
  return [...byId.values()].sort((a, b) => b.ts - a.ts || b.id - a.id).slice(0, LOG_MAX)
}

function addEntry(state: LogState, entry: LogEntry): LogState {
  if (state.entries.some((x) => x.id === entry.id)) return state
  const entries = merge(state.entries, [entry])
  const counted = !state.open && isAlert(entry) ? state.unreadAlerts + 1 : state.unreadAlerts
  return {
    ...state,
    entries,
    unreadAlerts: Math.min(counted, entries.filter(isAlert).length),
  }
}

function ack(state: LogState, id: number, by: string, ts: number): LogState {
  const hit = state.entries.find((x) => x.id === id)
  if (!hit || hit.acked_by !== null) return state
  return {
    ...state,
    entries: state.entries.map((x) => (x.id === id ? { ...x, acked_by: by, acked_at: ts } : x)),
  }
}

export function logReduce(state: LogState, ev: LogEvent): LogState {
  switch (ev.k) {
    case 'loaded':
      return { ...state, entries: merge(state.entries, ev.entries) }
    case 'entry':
      return addEntry(state, ev.entry)
    case 'ack':
      return ack(state, ev.id, ev.by, ev.ts)
    case 'open':
      return {
        ...state,
        open: true,
        unreadAlerts: 0,
        filter: ev.filter ?? 'all',
      }
    case 'filter':
      return { ...state, filter: ev.filter }
    case 'close':
      return state.open ? { ...state, open: false } : state
  }
}
