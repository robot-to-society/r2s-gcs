import type { Dict } from '../../shared/i18n'
import type { VehicleState } from '../../shared/api/types'
import { IconCopter, IconFollow, IconHeading, IconRover, IconSignal, IconSpeed } from '../../shared/ui/icons'
import { altText, battLow, battText, battWidth, dotClass, modeLabel, speedText } from './format'

interface Props {
  readonly vehicle: VehicleState
  readonly selected: boolean
  readonly dict: Dict
  readonly onSelect: (sysid: number) => void
  readonly onFollow?: (sysid: number) => void
  readonly following?: boolean
}

function signalTop(v: VehicleState): string {
  if (v.link === 'lost') return 'var(--danger)'
  if (v.link === 'delay') return 'var(--caution)'
  return 'var(--text)'
}

/** Prototype `.vrow`: icon column, name row (dot, name, mode, following, battery), stat row. Double-click follows (memory: ops map). */
export function VehicleRow({ vehicle: v, selected, dict, onSelect, onFollow, following = false }: Props) {
  return (
    <div
      className={selected ? 'vrow sel' : 'vrow'}
      role="option"
      aria-selected={selected}
      tabIndex={0}
      title={onFollow ? dict.followHint : undefined}
      onClick={() => onSelect(v.sysid)}
      onDoubleClick={() => onFollow?.(v.sysid)}
      onKeyDown={(e) => e.key === 'Enter' && onSelect(v.sysid)}
    >
      <div className="lead">
        {v.kind === 'rover' ? <IconRover /> : <IconCopter />}
        <IconHeading />
      </div>
      <div className="row">
        <span className={dotClass(v)} data-testid="dot" />
        <span className="nm">{v.name}</span>
        <span className="badge" style={{ color: v.armed ? 'var(--accent)' : 'var(--text-2)' }}>
          {modeLabel(v, dict)}
        </span>
        {following && (
          <span className="follow-mark" title={dict.following} aria-label={dict.following} role="img">
            <IconFollow />
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
