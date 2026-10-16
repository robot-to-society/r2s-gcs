import { useState } from 'react'
import type { Dict } from '../../shared/i18n'
import type { VehicleState } from '../../shared/api/types'
import { matches } from './format'
import { VehicleRow } from './VehicleRow'

interface Props {
  readonly vehicles: readonly VehicleState[]
  readonly selected: number | null
  readonly dict: Dict
  readonly onSelect: (sysid: number) => void
}

export function VehicleList({ vehicles, selected, dict, onSelect }: Props) {
  const [query, setQuery] = useState('')
  const shown = vehicles.filter((v) => matches(v, query, dict))
  return (
    <aside className="g panel float float-l" aria-label={dict.vehicles}>
      <div className="panel-h">
        <span className="h1">{dict.vehicles}</span>
        <span className="h1 t2" style={{ fontWeight: 300 }}>
          {vehicles.length}
        </span>
      </div>
      <div className="vlist-search">
        <input
          className="in"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={dict.filterVehicles}
          aria-label={dict.filterVehicles}
        />
      </div>
      <div className="vlist-body" role="listbox">
        {shown.length === 0 && <div className="empty">{dict.noVehicles}</div>}
        {shown.map((v) => (
          <VehicleRow key={v.sysid} vehicle={v} selected={v.sysid === selected} dict={dict} onSelect={onSelect} />
        ))}
      </div>
    </aside>
  )
}
