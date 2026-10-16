import type { Dict } from '../../shared/i18n'
import type { VehicleState } from '../../shared/api/types'
import { altText, battLow, battText, battWidth, modeLabel, speedText } from './format'

interface Props {
  readonly vehicle: VehicleState
  readonly selected: boolean
  readonly dict: Dict
  readonly onSelect: (sysid: number) => void
}

function KindIcon({ kind }: { readonly kind: VehicleState['kind'] }) {
  if (kind === 'rover') {
    return (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 13l2-5h14l2 5v5H3z" />
        <circle cx="7" cy="17" r="1.5" />
        <circle cx="17" cy="17" r="1.5" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M5 5l4 4M19 5l-4 4M5 19l4-4M19 19l-4-4" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function dotClass(v: VehicleState): string {
  if (v.link === 'lost') return 'dot lost'
  if (v.warn || v.link === 'delay') return 'dot warn'
  return v.kind === 'copter' ? 'dot copter' : 'dot'
}

export function VehicleRow({ vehicle: v, selected, dict, onSelect }: Props) {
  return (
    <div
      className={selected ? 'vrow sel' : 'vrow'}
      role="option"
      aria-selected={selected}
      tabIndex={0}
      onClick={() => onSelect(v.sysid)}
      onKeyDown={(e) => e.key === 'Enter' && onSelect(v.sysid)}
    >
      <span className="icon">
        <KindIcon kind={v.kind} />
      </span>
      <div className="nm">
        <span className={dotClass(v)} data-testid="dot" />
        <span>{v.name}</span>
        <span className="badge">{modeLabel(v, dict)}</span>
        <div className="grow" />
        <span className={battLow(v) ? 'batt low' : 'batt'}>
          <span style={{ width: battWidth(v) }} />
        </span>
        <span className="num">{battText(v)}</span>
      </div>
      <div className="stat num" style={{ gridColumn: 2 }}>
        <span>▲ {altText(v)}</span>
        <span>◔ {speedText(v)}</span>
      </div>
    </div>
  )
}
