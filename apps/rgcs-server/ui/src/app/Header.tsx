import { useState } from 'react'
import type { Dict } from '../shared/i18n'
import type { Me, VehicleState } from '../shared/api/types'
import type { LinkState } from '../features/vehicles/reducer'
import { IconClose, IconCopter, IconPlane, IconRover, IconUser, IconWarn } from '../shared/ui/icons'
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
  readonly onPresent?: () => void
}

/** Floating glass bar (spec 20 §4): brand, fleet counts, icon nav, operator, clock. The server
 * link is a dot only (the design has no text for it). */
export function Header({ vehicles, link, dict, clock, me, view, onView, onLogout, onPresent }: Props) {
  const [menu, setMenu] = useState(false)
  const copters = vehicles.filter((v) => v.kind === 'copter').length
  const rovers = vehicles.filter((v) => v.kind === 'rover').length
  const planes = vehicles.filter((v) => v.kind === 'plane').length
  const warns = vehicles.filter((v) => v.warn || v.link !== 'ok').length
  const linkTitle = link === 'open' ? dict.linkOpen : link === 'closed' ? dict.linkClosed : dict.connecting
  return (
    <header className="g header">
      <div className="row brand-row">
        <span className="brand">RGCS</span>
        {view === 'maint' && (
          <>
            <span style={{ width: 1, height: 18, background: 'var(--line-hi)' }} />
            <span className="t2" style={{ fontSize: 14 }}>
              {dict.maintenance}
            </span>
          </>
        )}
      </div>
      <div className="row num counts">
        <span className="row" title="Copters">
          <IconCopter size={18} />
          <span>{copters}</span>
        </span>
        <span className="row" title="Rovers">
          <IconRover size={18} />
          <span>{rovers}</span>
        </span>
        {planes > 0 && (
          <span className="row" title="Planes">
            <IconPlane size={18} />
            <span>{planes}</span>
          </span>
        )}
        <span className="row warn">
          <IconWarn />
          <span className="warn">{warns}</span>
        </span>
      </div>
      <div className="grow" />
      <Nav view={view} onView={onView} dict={dict} />
      <div className="grow" />
      <span className={`dot link-dot ${link === 'open' ? 'ok' : link === 'closed' ? 'lost' : 'warn'}`} title={linkTitle} data-testid="link" aria-label={linkTitle} role="img" />
      <button type="button" className="btn btn-ghost user" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
        <IconUser />
        {me.username}
      </button>
      <span className="num t2 header-clock">{clock}</span>
      {view === 'maint' && (
        <button type="button" className="btn-icon" title={dict.close} aria-label={dict.close} onClick={() => onView('ops')}>
          <IconClose />
        </button>
      )}
      {menu && (
        <UserPopover
          me={me}
          dict={dict}
          onLogout={onLogout}
          onClose={() => setMenu(false)}
          onPresent={onPresent && (() => {
            setMenu(false)
            onPresent()
          })}
        />
      )}
    </header>
  )
}
