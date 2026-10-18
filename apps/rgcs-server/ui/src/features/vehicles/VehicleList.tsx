import { useState } from 'react'
import type { Dict } from '../../shared/i18n'
import type { VehicleState } from '../../shared/api/types'
import { IconCollapse, IconCopter, IconMenu, IconPin, IconRover } from '../../shared/ui/icons'
import { matches } from './format'
import { VehicleRow } from './VehicleRow'
import { dotClass } from './format'

interface Props {
  readonly vehicles: readonly VehicleState[]
  readonly selected: number | null
  readonly dict: Dict
  readonly onSelect: (sysid: number) => void
  readonly onFollow?: (sysid: number) => void
  readonly following?: number | null
  /** `rail` collapses the panel to a 60 px column of icons (spec 20 §4). */
  readonly aside?: 'full' | 'rail'
  readonly onToggleAside?: () => void
}

export function VehicleList({ vehicles, selected, dict, onSelect, onFollow, following = null, aside = 'full', onToggleAside }: Props) {
  const [query, setQuery] = useState('')
  const shown = vehicles.filter((v) => matches(v, query, dict))
  if (aside === 'rail') {
    return (
      <aside className="g panel float float-l" aria-label={dict.vehicles}>
        <div className="vrail">
          <button type="button" className="btn-icon" aria-label={dict.expand} title={dict.expand} onClick={onToggleAside}>
            <IconMenu />
          </button>
          {vehicles.map((v) => (
            <button key={v.sysid} type="button" className={`btn-icon${v.sysid === selected ? ' sel' : ''}`} title={v.name} aria-label={v.name} onClick={() => onSelect(v.sysid)}>
              {v.kind === 'rover' ? <IconRover size={20} /> : <IconCopter size={20} />}
              <span className={dotClass(v)} style={{ width: 7, height: 7 }} />
            </button>
          ))}
        </div>
      </aside>
    )
  }
  return (
    <aside className="g panel float float-l" aria-label={dict.vehicles}>
      <div className="panel-h">
        <span className="h1">{dict.vehicles}</span>
        <span className="h1 t2" style={{ fontWeight: 300 }}>
          {vehicles.length}
        </span>
        <div className="grow" />
        <button type="button" className="btn-icon" title={dict.pinned} aria-label={dict.pinned} disabled>
          <IconPin />
        </button>
        {onToggleAside && (
          <button type="button" className="btn-icon" title={dict.collapse} aria-label={dict.collapse} onClick={onToggleAside}>
            <IconCollapse />
          </button>
        )}
      </div>
      <div className="vlist-search">
        <input className="in" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={dict.filterVehicles} aria-label={dict.filterVehicles} />
      </div>
      <div className="vlist-body" role="listbox">
        {shown.length === 0 && <div className="empty">{dict.noVehicles}</div>}
        {shown.map((v) => (
          <VehicleRow key={v.sysid} vehicle={v} selected={v.sysid === selected} dict={dict} onSelect={onSelect} onFollow={onFollow} following={following === v.sysid} />
        ))}
      </div>
    </aside>
  )
}
