import { useCallback, useState } from 'react'
import { KindIcon } from '../../shared/ui/KindIcon'
import type { Flight, LogFetchProgress, MaintenanceInput, Operator, ParamProgress, SysId, VehicleState } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { AppTab } from '../app-settings'
import { DailyTab } from '../logbook/DailyTab'
import { LogbookTab } from '../logbook/LogbookTab'
import { HistoryTab } from './HistoryTab'
import { InspectorTab } from '../inspector/InspectorTab'
import { ParamsPane } from './ParamsPane'
import { ENABLED_TABS, MAINT_TABS, TAB_LABEL, type MaintTab } from './tabs'

interface Props {
  readonly vehicles: ReadonlyMap<SysId, VehicleState>
  readonly paramProgress: ReadonlyMap<SysId, ParamProgress>
  readonly dict: Dict
  /** Controlled selection (the shell shares it with the vehicle list); uncontrolled when omitted. */
  readonly selected?: SysId | null
  readonly onSelect?: (sysid: SysId) => void
  readonly me: Operator
  /** Opens the ロゴ・提示用トークン sheet (アプリ設定 tab). */
  readonly onOpenPresent?: () => void
  readonly flightDrafts?: ReadonlyMap<SysId, Flight>
  readonly logFetch?: ReadonlyMap<SysId, LogFetchProgress>
}

/** メンテナンス・設定 (spec 10 §7) after the prototype's maint screen: header row, tab strip, body. */
export function MaintView({ vehicles, paramProgress, dict, selected, onSelect, me, onOpenPresent, flightDrafts, logFetch }: Props) {
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
  /** A 様式 3 draft handed over from 日常点検 (異常 found); consumed by the 飛行日誌 tab. */
  const [maintDraft, setMaintDraft] = useState<MaintenanceInput | null>(null)
  const onMaintenanceDraft = useCallback((draft: MaintenanceInput) => {
    setMaintDraft(draft)
    setTab('logbook')
  }, [setTab])
  const onMaintDraftConsumed = useCallback(() => setMaintDraft(null), [])
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
        {vehicle && <span className="t2 maint-kind"><KindIcon kind={vehicle.kind} /></span>}
        {vehicle && <span className="badge t2">{vehicle.mode}</span>}
        {vehicle && <span className={`t3 num maint-arm${vehicle.armed ? ' armed' : ''}`}>{vehicle.armed ? 'ARMED' : 'DISARMED'}</span>}
      </div>
      <div className={`seg n${MAINT_TABS.length} lg g-ctl maint-tabs`}>
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
      {tab === 'daily' && sysid !== null && <DailyTab key={sysid} sysid={sysid} vehicle={vehicle} me={me} dict={dict} onMaintenanceDraft={onMaintenanceDraft} />}
      {tab === 'logbook' && sysid !== null && (
        <LogbookTab
          key={sysid}
          sysid={sysid}
          vehicles={vehicles}
          me={me}
          dict={dict}
          draft={flightDrafts?.get(sysid)}
          logFetch={logFetch?.get(sysid)}
          maintDraft={maintDraft}
          onMaintDraftConsumed={onMaintDraftConsumed}
        />
      )}
      {tab === 'inspector' && <InspectorTab dict={dict} />}
      {tab === 'app' && <AppTab sysid={sysid} vehicle={vehicle} me={me} dict={dict} onOpenPresent={onOpenPresent ?? (() => {})} />}
      {tab === 'history' && (
        <div className="maint-body">
          <HistoryTab sysid={sysid} vehicles={vehicles} dict={dict} version={writes} />
        </div>
      )}
    </section>
  )
}
