import { useCallback, useState } from 'react'
import type { ParamProgress, SysId, VehicleState } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { IconCopter, IconRover } from '../../shared/ui/icons'
import { HistoryTab } from './HistoryTab'
import { ParamsPane } from './ParamsPane'
import { ENABLED_TABS, MAINT_TABS, TAB_LABEL, type MaintTab } from './tabs'

interface Props {
  readonly vehicles: ReadonlyMap<SysId, VehicleState>
  readonly paramProgress: ReadonlyMap<SysId, ParamProgress>
  readonly dict: Dict
  /** Controlled selection (the shell shares it with the vehicle list); uncontrolled when omitted. */
  readonly selected?: SysId | null
  readonly onSelect?: (sysid: SysId) => void
}

/** メンテナンス・設定 (spec 10 §7) after the prototype's maint screen: header row, tab strip, body. */
export function MaintView({ vehicles, paramProgress, dict, selected, onSelect }: Props) {
  const list = [...vehicles.values()].sort((a, b) => a.sysid - b.sysid)
  const [picked, setPicked] = useState<SysId | null>(null)
  const wanted = selected === undefined ? picked : selected
  const sysid = wanted !== null && vehicles.has(wanted) ? wanted : (list[0]?.sysid ?? null)
  const pick = (id: SysId) => {
    setPicked(id)
    onSelect?.(id)
  }
  const vehicle = sysid === null ? undefined : vehicles.get(sysid)
  const [tab, setTab] = useState<MaintTab>('params')
  const [writes, setWrites] = useState(0)
  const onWritten = useCallback(() => setWrites((n) => n + 1), [])
  const tabIndex = MAINT_TABS.indexOf(tab)
  return (
    <section className="float map-l top1 maint" data-testid="maint-view">
      <div className="aurora" />
      <div className="row maint-head">
        <label className="t2" htmlFor="maint-vehicle">
          {dict.maintConnected}
        </label>
        <select id="maint-vehicle" className="in lg" value={sysid ?? ''} onChange={(e) => pick(Number(e.target.value))} disabled={list.length === 0}>
          {list.length === 0 && <option value="">{dict.noVehicles}</option>}
          {list.map((v) => (
            <option key={v.sysid} value={v.sysid}>
              {v.name}
            </option>
          ))}
        </select>
        {vehicle && <span className="t2 maint-kind">{vehicle.kind === 'rover' ? <IconRover /> : <IconCopter />}</span>}
        {vehicle && <span className="badge t2">{vehicle.mode}</span>}
        {vehicle && <span className={`t3 num maint-arm${vehicle.armed ? ' armed' : ''}`}>{vehicle.armed ? 'ARMED' : 'DISARMED'}</span>}
      </div>
      <div className="seg n6 lg g-ctl maint-tabs">
        <span className="lens" style={{ transform: `translateX(${tabIndex * 100}%)` }} />
        {MAINT_TABS.map((tb) => {
          const enabled = ENABLED_TABS.has(tb)
          const label = dict[TAB_LABEL[tb]]
          return (
            <button
              key={tb}
              type="button"
              className={tb === tab ? 'on' : ''}
              aria-disabled={enabled ? undefined : 'true'}
              title={enabled ? label : `${label} (${dict.comingSoon})`}
              onClick={() => enabled && setTab(tb)}
            >
              {label}
            </button>
          )
        })}
      </div>
      <ParamsPane
        key={sysid ?? 'none'}
        sysid={sysid}
        armed={vehicle?.armed === true}
        progress={sysid === null ? undefined : paramProgress.get(sysid)}
        dict={dict}
        hidden={tab !== 'params'}
        onWritten={onWritten}
      />
      {tab === 'history' && (
        <div className="maint-body">
          <HistoryTab sysid={sysid} vehicles={vehicles} dict={dict} version={writes} />
        </div>
      )}
    </section>
  )
}
