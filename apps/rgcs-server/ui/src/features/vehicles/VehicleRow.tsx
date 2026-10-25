import type { Dict } from '../../shared/i18n'
import { KindIcon } from '../../shared/ui/KindIcon'
import type { VehicleState } from '../../shared/api/types'
import { IconFollow, IconHeading, IconSignal, IconSpeed } from '../../shared/ui/icons'
import { altText, battLow, battText, battWidth, dotClass, modeLabel, speedText } from './format'

interface Props {
  readonly vehicle: VehicleState
  readonly selected: boolean
  readonly dict: Dict
  readonly onSelect: (sysid: number) => void
  readonly onFollow?: (sysid: number) => void
  readonly following?: boolean
  /** An active AI 緊急介入 alert on this vehicle. */
  readonly guard?: boolean
}

function signalTop(v: VehicleState): string {
  if (v.link === 'lost') return 'var(--danger)'
  if (v.link === 'delay') return 'var(--caution)'
  return 'var(--text)'
}

/** Prototype `.vrow`: icon column, name row (dot, name, mode, following, battery), stat row. Double-click follows (memory: ops map). */
export function VehicleRow({ vehicle: v, selected, dict, onSelect, onFollow, following = false, guard = false }: Props) {
  return (
    <div
      className={`vrow${selected ? ' sel' : ''}${guard ? ' guard' : ''}`}
      role="option"
      aria-selected={selected}
      tabIndex={0}
      title={onFollow ? dict.followHint : undefined}
      onClick={() => onSelect(v.sysid)}
      onDoubleClick={() => onFollow?.(v.sysid)}
      onKeyDown={(e) => e.key === 'Enter' && onSelect(v.sysid)}
    >
      <div className="lead">
        <KindIcon kind={v.kind} />
        <IconHeading />
      </div>
      <div className="row">
        <span className={dotClass(v)} data-testid="dot" />
        <span className="nm">{v.name}</span>
        <span className="badge" title={modeLabel(v, dict)} style={{ color: v.armed ? 'var(--accent)' : 'var(--text-2)' }}>
          {modeLabel(v, dict)}
        </span>
        {following && (
          <span className="follow-mark" title={dict.following} aria-label={dict.following} role="img">
            <IconFollow />
          </span>
        )}
        {v.unread > 0 && (
          <span className="warn-count num" aria-label={`${dict.unreadAlerts} ${v.unread}`} title={dict.unreadAlerts}>
            {v.unread}
          </span>
        )}
        <div className="grow" />
        <span className={battLow(v) ? 'batt low' : 'batt'}>
          <span style={{ width: battWidth(v) }} />
        </span>
        <span className="num batt-text">{battText(v)}</span>
      </div>
      <div className="row num stat">
        <span className="alt">{altText(v)}</span>
        <IconSpeed />
        <span className="spd">{speedText(v)}</span>
        <div className="grow" />
        <IconSignal top={signalTop(v)} />
      </div>
    </div>
  )
}
