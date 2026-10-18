import type { LogEntry, SysId } from '../../shared/api/types'
import { cmdLabel, type Dict } from '../../shared/i18n'
import { messageText } from '../detail/format'

/** Command entries are "<cmd>" or "<cmd> <reason>" (server message_log); shown as "<label> 成功|失敗 <reason>". */
function commandText(e: LogEntry, dict: Dict): string {
  const [cmd = '', ...rest] = e.text.split(' ')
  const outcome = e.severity === 'error' ? dict.failed : dict.ok
  return [cmdLabel(cmd, dict), outcome, ...rest].join(' ')
}

/** Link codes and command names are translated; vehicle text stays verbatim (spec 00 §5). */
export function entryText(e: LogEntry, dict: Dict): string {
  if (e.source === 'command') return commandText(e, dict)
  return messageText(e.text, dict)
}

/** The vehicle's name, or システム for entries without one. */
export function entrySource(e: LogEntry, names: ReadonlyMap<SysId, string>, dict: Dict): string {
  if (e.sysid === null) return dict.logSystem
  return names.get(e.sysid) ?? `#${e.sysid}`
}
