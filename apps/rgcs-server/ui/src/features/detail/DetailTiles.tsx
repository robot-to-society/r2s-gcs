// The three tiles of the right panel (prototype `.tile-btn` ×3, spec 10 §3.3): icon + label,
// with what needs attention on the tile itself.
import type { SysId } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { IconGrid, IconHistory, IconWrench } from '../../shared/ui/icons'

interface Props {
  readonly sysid: SysId
  /** Warnings / errors of this vehicle waiting for acknowledgement. */
  readonly alerts: number
  readonly maintAttention: boolean
  readonly commandsOpen: boolean
  readonly dict: Dict
  readonly onOpenMaint?: (sysid: SysId) => void
  readonly onOpenLog: (sysid: SysId) => void
  readonly onOpenCommands: () => void
}

export function DetailTiles({ sysid, alerts, maintAttention, commandsOpen, dict, onOpenMaint, onOpenLog, onOpenCommands }: Props) {
  return (
    <div className="detail-tiles hair" data-testid="detail-tiles">
      <button type="button" className="tile-btn tile-l" title={dict.maintenance} disabled={!onOpenMaint} onClick={() => onOpenMaint?.(sysid)}>
        <IconWrench />
        <span className="tile-lbl">{dict.tileMaint}</span>
        {maintAttention && <span className="tile-dot" title={dict.calibAttention} />}
      </button>
      <button type="button" className="tile-btn tile-l" title={dict.history} onClick={() => onOpenLog(sysid)}>
        <IconHistory />
        <span className="tile-lbl">{dict.tileHistory}</span>
        {alerts > 0 && (
          <span className="count tile-count" aria-label={dict.needAck}>
            {alerts}
          </span>
        )}
      </button>
      <button type="button" className={`tile-btn tile-l${commandsOpen ? ' on' : ''}`} title={dict.allCommands} aria-pressed={commandsOpen} onClick={onOpenCommands}>
        <IconGrid />
        <span className="tile-lbl">{dict.tileCommands}</span>
      </button>
    </div>
  )
}
