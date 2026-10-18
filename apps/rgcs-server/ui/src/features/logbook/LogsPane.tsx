// ログ sub-tab placeholder; the stored / fetch / upload panes arrive with the next task.
import type { LogFetchProgress } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'

interface Props {
  readonly sysid: number
  readonly from: string
  readonly to: string
  readonly dict: Dict
  readonly progress: LogFetchProgress | undefined
}

export function LogsPane({ dict }: Props) {
  return (
    <div className="surface">
      <div className="row hair lb-head">
        <span className="h2">{dict.lbSubLogs}</span>
      </div>
      <div className="t3 lb-empty">{dict.lbNoLogs}</div>
    </div>
  )
}
