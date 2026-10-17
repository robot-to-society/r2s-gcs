import { useState } from 'react'
import type { Dict } from '../shared/i18n'
import type { Me, VehicleState } from '../shared/api/types'
import type { LinkState } from '../features/vehicles/reducer'
import { Nav } from './Nav'
import { UserPopover } from './UserPopover'
import type { View } from './view'

interface Props {
  readonly vehicles: readonly VehicleState[]
  readonly link: LinkState
  readonly dict: Dict
  readonly clock: string
  readonly me: Me
  readonly view: View
  readonly onView: (view: View) => void
  readonly onLogout: () => void
}

const Icon = ({ d, extra }: { d: string; extra?: React.ReactNode }) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
    <path d={d} />
    {extra}
  </svg>
)

export function Header({ vehicles, link, dict, clock, me, view, onView, onLogout }: Props) {
  const [menu, setMenu] = useState(false)
  const copters = vehicles.filter((v) => v.kind === 'copter').length
  const rovers = vehicles.filter((v) => v.kind === 'rover').length
  const warns = vehicles.filter((v) => v.warn || v.link !== 'ok').length
  return (
    <header className="g header">
      <span className="brand">RGCS</span>
      <div className="row num counts">
        <span className="row" title="Copters">
          <Icon d="M5 5l4 4M19 5l-4 4M5 19l4-4M19 19l-4-4" extra={<circle cx="12" cy="12" r="3" />} />
          <span>{copters}</span>
        </span>
        <span className="row" title="Rovers">
          <Icon d="M3 13l2-5h14l2 5v5H3z" extra={<><circle cx="7" cy="17" r="1.5" /><circle cx="17" cy="17" r="1.5" /></>} />
          <span>{rovers}</span>
        </span>
        <span className="row warn">
          <Icon d="M12 3l10 18H2z" extra={<path d="M12 10v5M12 18v.5" />} />
          <span className="warn">{warns}</span>
        </span>
      </div>
      <div className="grow" />
      <Nav view={view} onView={onView} dict={dict} />
      <div className="grow" />
      <span className="link" data-testid="link">
        <span className={link === 'open' ? 'dot ok' : 'dot off'} />
        {link === 'open' ? dict.linkOpen : link === 'closed' ? dict.linkClosed : dict.connecting}
      </span>
      <button type="button" className="btn btn-ghost btn-sm user" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
        {me.username}
      </button>
      <span className="num t2 header-clock">{clock}</span>
      {menu && <UserPopover me={me} dict={dict} onLogout={onLogout} onClose={() => setMenu(false)} />}
    </header>
  )
}
