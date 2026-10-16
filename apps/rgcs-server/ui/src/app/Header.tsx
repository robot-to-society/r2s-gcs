import type { Dict } from '../shared/i18n'
import type { VehicleState } from '../shared/api/types'
import type { LinkState } from '../features/vehicles/reducer'

interface Props {
  readonly vehicles: readonly VehicleState[]
  readonly link: LinkState
  readonly dict: Dict
  readonly clock: string
}

export function Header({ vehicles, link, dict, clock }: Props) {
  const copters = vehicles.filter((v) => v.kind === 'copter').length
  const rovers = vehicles.filter((v) => v.kind === 'rover').length
  const warns = vehicles.filter((v) => v.warn || v.link !== 'ok').length
  return (
    <header className="g header">
      <span className="brand">RGCS</span>
      <div className="row num counts">
        <span className="row" title="Copters">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 5l4 4M19 5l-4 4M5 19l4-4M19 19l-4-4" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          <span>{copters}</span>
        </span>
        <span className="row" title="Rovers">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 13l2-5h14l2 5v5H3z" />
            <circle cx="7" cy="17" r="1.5" />
            <circle cx="17" cy="17" r="1.5" />
          </svg>
          <span>{rovers}</span>
        </span>
        <span className="row warn">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 3l10 18H2z" />
            <path d="M12 10v5M12 18v.5" />
          </svg>
          <span className="warn">{warns}</span>
        </span>
      </div>
      <div className="grow" />
      <span className="link" data-testid="link">
        <span className={link === 'open' ? 'dot ok' : 'dot off'} />
        {link === 'open' ? dict.linkOpen : link === 'closed' ? dict.linkClosed : dict.connecting}
      </span>
      <span className="num t2" style={{ fontSize: 13, padding: '0 8px' }}>
        {clock}
      </span>
    </header>
  )
}
