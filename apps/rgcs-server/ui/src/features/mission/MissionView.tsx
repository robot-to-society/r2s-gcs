import type { StyleSpecification } from 'maplibre-gl'
import { useMemo, useRef, useState } from 'react'
import type { Mission, MissionFrame, VehicleState } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { vehicleStore } from '../vehicles/store'
import { BriefingList } from '../briefing/BriefingList'
import { briefingStore, type BriefingStore } from '../briefing/store'
import { useBriefing } from '../briefing/useBriefing'
import { useBriefingWrite } from '../briefing/BatchWrite'
import { useBriefingIo } from '../briefing/BriefingIo'
import { useBriefingMap } from '../briefing/useBriefingMap'
import { pathModel, pathParamNames, predictFor } from '../flightpath/predict'
import { usePathParams } from '../flightpath/usePathParams'
import { CommandPalette } from './CommandPalette'
import { ContextMenu } from './ContextMenu'
import { MissionList } from './MissionList'
import { UploadTargets } from './UploadTargets'
import { MapFinder } from './MapFinder'
import { placeTakeoffs, takeoffAnchor } from './geo'
import { MissionMap } from './MissionMap'
import { ElevationSheet } from './ElevationSheet'
import { HelpPanel } from './HelpPanel'
import { usePlanPanel } from './planPanel'
import { PlanRail } from './PlanRail'
import { usePlanEditor } from './planEditor'
import { FencePanel, PlanTabs, RallyPanel } from './PlanPanels'
import { FenceSidebar, RallySidebar } from './PlanSidebar'
import { removeRally, removeZone, setInclusion, setRadius, setRallyAlt } from './geofenceModel'
import { MissionPicker } from './MissionPicker'
import { MissionSidebar } from './MissionSidebar'
import { canRedo, canUndo } from './history'
import { km, mmss } from './labels'
import type { ContextMenu as Menu } from './mapEdit'
import { useMissionIo } from './useMissionIo'
import { appendWaypoint, moveItemsTo, takeoffFor, clearItems, insertAfter, insertCommandAfter, moveItem, moveItems, removeItems, reorder, reverseItems, setAltBulk, setArc, setCommand, setMeta, shiftAlts, updateItem, type Draft } from './model'
import { MissionStore, addToSelection, clearSelection, copySelected, pasteClipboard, edit, missionStore, redoUi, removeSelected, selectOne, selectRange, setTool, undoUi, useMissionUi } from './store'
import { localWarnings, stats } from './summary'
import { BasemapPicker } from '../map/BasemapPicker'
import { MapModeToggle } from '../map/MapModeToggle'
import { saveMapMode, useMapMode } from '../map/mapMode'
import type { Basemap, MissionTransfer } from '../../shared/api/types'

interface Props {
  readonly vehicles: ReadonlyMap<number, VehicleState>
  /** Mission writes in progress (`mission_transfer`), per vehicle. */
  readonly transfers?: ReadonlyMap<number, MissionTransfer>
  readonly dict: Dict
  readonly style: StyleSpecification
  readonly basemap?: Basemap
  readonly basemaps?: readonly Basemap[]
  readonly onPickBasemap?: (id: string) => void
  /** Terrarium DEM tiles; `null` / absent → 2D only. */
  readonly terrainTiles?: string | null
  readonly store?: MissionStore
  readonly briefing?: BriefingStore
}

const isEditable = (t: EventTarget | null): boolean => t instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName)
const NUDGE = 0.0001
const NO_TRANSFERS: ReadonlyMap<number, MissionTransfer> = new Map()

/** The mission planning screen (spec 10 §6, 2D subset) built on the Glass prototype's layout. */
export function MissionView({ vehicles, transfers = NO_TRANSFERS, dict, style, basemap, basemaps = [], onPickBasemap, terrainTiles = null, store = missionStore, briefing = briefingStore }: Props) {
  const mapMode = useMapMode()
  const is3d = mapMode === '3d' && terrainTiles !== null
  const ui = useMissionUi(store)
  const draft = ui.history.present
  const [fitTo, setFitTo] = useState<{ seq: number; points: readonly { lat: number; lon: number }[] } | null>(null)
  const onFit = (points: readonly { lat: number; lon: number }[]) => setFitTo((f) => ({ seq: (f?.seq ?? 0) + 1, points }))
  const brief = useBriefing(briefing, store, ui, onFit)
  const panel = usePlanPanel()
  const [menu, setMenu] = useState<Menu | null>(null)
  const [palette, setPalette] = useState(false)
  const [help, setHelp] = useState(false)
  const [targets, setTargets] = useState(false)
  const [focus, setFocus] = useState<{ lat: number; lon: number; seq: number } | null>(null)
  const briefMap = useBriefingMap(brief.list.workspace)
  const [bulk, setBulk] = useState<{ alt: string; frame: MissionFrame }>({ alt: String(draft.mission.default_alt), frame: draft.mission.default_frame })
  const file = useRef<HTMLInputElement>(null)
  const list = [...vehicles.values()].sort((a, b) => a.sysid - b.sysid)
  const sysid = brief.target(draft.mission.sysid, list[0]?.sysid ?? null)
  const online = list.filter((v) => v.link !== 'lost')
  const located = list.filter((v) => v.gps.fix >= 2 && !(v.lat === 0 && v.lon === 0))
  const vehicle = sysid === null ? null : (vehicles.get(sysid) ?? null)
  // the takeoff has no coordinates: drawn above the home
  const placed = useMemo(() => ({ ...draft, items: placeTakeoffs(draft.items, takeoffAnchor(draft.mission.home, vehicle)) }), [draft, vehicle])
  // A plane / QuadPlane / copter gets its expected flight drawn over the plan from its own parameters (2026-10-20).
  const kind = vehicle?.kind ?? null
  const pathValues = usePathParams(sysid, pathParamNames(kind))
  // telemetry replaces the home object every update: depend on its values, not its identity
  const [hLat, hLon, hAlt] = [vehicle?.home?.lat, vehicle?.home?.lon, vehicle?.home?.alt]
  const predict = useMemo(() => {
    const model = pathModel(kind, pathValues)
    if (!model) return undefined
    const vHome = hLat !== undefined && hLon !== undefined && hAlt !== undefined ? { lat: hLat, lon: hLon, alt: hAlt } : null
    return (d: Draft) => predictFor(d, model, vHome)
  }, [kind, pathValues, hLat, hLon, hAlt])
  const change = (fn: (d: Draft) => Draft) => store.update((u) => edit(u, fn(u.history.present)))
  const io = useMissionIo(store, briefing, sysid, dict, vehicleStore)
  const batch = useBriefingWrite(brief.list.workspace, vehicles, ui.busy !== 'idle', dict)
  const fileHome = draft.mission.home ?? (vehicle?.home ? { lat: vehicle.home.lat, lon: vehicle.home.lon, alt: vehicle.home.alt } : null)
  const plan = usePlanEditor({ draft, sysid, dict, change, home: fileHome, onFit })
  const briefIo = useBriefingIo(briefing, store, brief.list.workspace, dict, { onFit })
  const planIo = { sysid, busy: plan.busy, status: plan.status, dict, onWrite: plan.write, onRead: plan.read, onSaveFile: plan.saveFile, onLoadFile: (f: File) => void plan.loadFile(f), onCollapse: panel.collapse }
  const selectedItems = draft.items.filter((it) => ui.selected.has(it.uid))
  const lastSelected = selectedItems[selectedItems.length - 1]
  const st = stats(draft.items, draft.mission.home, draft.mission.speed)

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (isEditable(e.target)) return
    const meta = e.metaKey || e.ctrlKey
    // fence / rally tabs: only undo / redo and finishing or cancelling a zone; waypoints stay put
    if (plan.tab !== 'mission' && !(meta && e.key.toLowerCase() === 'z')) {
      if (e.key !== 'Enter' && e.key !== 'Escape') return
      plan.finish()
      e.preventDefault()
      return
    }
    if (e.key === 'Delete' || e.key === 'Backspace') store.update(removeSelected)
    else if (meta && e.key.toLowerCase() === 'z') store.update(e.shiftKey ? redoUi : undoUi)
    else if (meta && e.key.toLowerCase() === 'c' && ui.selected.size > 0) store.update(copySelected)
    else if (meta && e.key.toLowerCase() === 'v') store.update(pasteClipboard)
    else if (meta && e.key.toLowerCase() === 'a') store.update((u) => ({ ...u, selected: new Set(u.history.present.items.map((it) => it.uid)) }))
    else if (e.key === 'Escape') {
      store.update(clearSelection)
      setMenu(null)
      setPalette(false)
    } else if (e.key.startsWith('Arrow') && ui.selected.size > 0) {
      const step = NUDGE * (e.shiftKey ? 10 : 1)
      const d = e.key === 'ArrowUp' ? [step, 0] : e.key === 'ArrowDown' ? [-step, 0] : e.key === 'ArrowLeft' ? [0, -step] : [0, step]
      change((x) => moveItems(x, ui.selected, d[0]!, d[1]!))
    } else return
    e.preventDefault()
  }
  const applyBulk = () => {
    const alt = Number(bulk.alt)
    if (!Number.isNaN(alt)) change((d) => setAltBulk(d, ui.selected, alt, bulk.frame))
  }
  const insertFromPalette = (key: string) => {
    change((d) => insertCommandAfter(d, lastSelected?.uid ?? null, key))
    setPalette(false)
  }

  return (
    <div className={`mission-view${panel.collapsed ? ' panel-collapsed' : ''}`} style={{ position: 'absolute', inset: 0 }} tabIndex={-1} onKeyDown={onKeyDown} data-testid="mission-view">
      <MissionMap
        draft={draft}
        selected={ui.selected}
        tool={ui.tool}
        style={style}
        basemap={basemap}
        mode={mapMode}
        terrainTiles={terrainTiles}
        vehicle={vehicle}
        predict={predict}
        fitRequest={io.fitRequest}
        focus={focus}
        fitTo={fitTo}
        pathColor={brief.pathColor}
        panelCollapsed={panel.collapsed}
        onAdd={(lat, lon) => change((d) => appendWaypoint(d, lat, lon, { takeoff: takeoffFor(vehicle?.kind ?? null, (pathValues.get('Q_ENABLE') ?? 0) >= 1) }))}
        onInsertAfter={(uid, lat, lon) => change((d) => insertAfter(d, uid, lat, lon))}
        onMove={(uid, lat, lon) => change((d) => moveItem(d, uid, lat, lon))}
        onMoveSelected={(dLat, dLon) => change((d) => moveItems(d, ui.selected, dLat, dLon))}
        onShiftAlt={(uids, dAlt) => change((d) => shiftAlts(d, uids, dAlt))}
        onBoxSelect={(uids) => store.update((u) => addToSelection(u, uids))}
        onArc={(uid, angle) => change((d) => setArc(d, uid, angle))}
        tab={plan.tab}
        onPlanClick={plan.onPlanClick}
        onFenceEdit={plan.onFenceEdit}
        onRallyMove={plan.onRallyMove}
        ceiling={plan.fenceParams?.alt_max ?? null}
        onSelect={(uid, additive, range) => store.update((u) => (range ? selectRange(u, uid) : selectOne(u, uid, additive)))}
        onBackgroundClick={() => store.update(clearSelection)}
        onContext={setMenu}
        {...briefMap}
      />
      <div className="g-ctl float map-l top1 compass" aria-hidden="true" style={{ transform: is3d ? 'rotate(25deg)' : undefined }}>
        <span>N</span>
        <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
          <path d="M12 3l6 16-6-4-6 4z" />
        </svg>
      </div>
      <MapFinder vehicles={located} dict={dict} onGo={(to) => setFocus((f) => ({ ...to, seq: (f?.seq ?? 0) + 1 }))} />
      {basemap && onPickBasemap && basemaps.length > 1 && <BasemapPicker basemaps={basemaps} current={basemap.id} dict={dict} onPick={onPickBasemap} className="float map-r top2" />}
      <MapModeToggle mode={mapMode} available={terrainTiles !== null} dict={dict} onChange={saveMapMode} />
      <PlanTabs tab={plan.tab} dict={dict} onChange={plan.setTab} />
      <ElevationSheet draft={placed} selected={ui.selected} terrainTiles={terrainTiles} ceiling={plan.fenceParams?.alt_max ?? null} dict={dict} onSelect={(uid, additive, range) => store.update((u) => (range ? selectRange(u, uid) : selectOne(u, uid, additive)))} />
      <button type="button" className={`g-ctl ctl float map-r2 top1 help-btn${help ? ' on' : ''}`} title={dict.mHelpTitle} aria-label={dict.mHelpTitle} onClick={() => setHelp((h) => !h)}>
        ?
      </button>
      {help && <HelpPanel dict={dict} onClose={() => setHelp(false)} />}
      <div className="g-ctl float map-c num mission-pill" aria-hidden="true">
        <span>
          <span className="t3">{dict.mDistance}</span>
          {km(st.distance_m)}
        </span>
        <span>
          <span className="t3">{dict.mEstTime}</span>
          {mmss(st.duration_s)}
        </span>
        <span>
          <span className="t3">{dict.mMaxAlt}</span>
          {`${Math.round(st.max_alt)} m`}
        </span>
      </div>

      {plan.tab === 'fence' && (
        <FencePanel
          zones={draft.mission.fence}
          armed={plan.armed}
          drawing={plan.drawing}
          dict={dict}
          onArm={plan.arm}
          onDone={plan.finish}
          onRadius={(zi, r) => change((d) => setRadius(d, zi, r))}
          onInclusion={(zi, inc) => change((d) => setInclusion(d, zi, inc))}
          onRemove={(zi) => change((d) => removeZone(d, zi))}
        />
      )}
      {plan.tab === 'rally' && (
        <RallyPanel
          points={draft.mission.rally}
          dict={dict}
          onAlt={(i, alt) => change((d) => setRallyAlt(d, i, alt))}
          onRemove={(i) => change((d) => removeRally(d, i))}
        />
      )}
      {plan.tab === 'mission' && (
        <aside className="g panel float float-l mission-left" aria-label={dict.navMission}>
          <BriefingList {...brief.list} header={briefIo.header} liveDirty={ui.dirty} busy={ui.busy !== 'idle'} vehicles={list} dict={dict} />
          <div className="panel-h" style={{ gap: 6 }}>
            <span className="h1" style={{ whiteSpace: 'nowrap' }}>
              {dict.mItemsTitle}
            </span>
            <span className="h1 t2" style={{ fontWeight: 300 }}>
              {draft.items.length}
            </span>
            <div className="grow" />
            <button type="button" className="btn-icon" title={`${dict.mUndo} (⌘Z)`} aria-label={dict.mUndo} disabled={!canUndo(ui.history)} onClick={() => store.update(undoUi)}>
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></svg>
            </button>
            <button type="button" className="btn-icon" title={`${dict.mRedo} (⇧⌘Z)`} aria-label={dict.mRedo} disabled={!canRedo(ui.history)} onClick={() => store.update(redoUi)}>
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 14l5-5-5-5" /><path d="M20 9H10a6 6 0 0 0 0 12h3" /></svg>
            </button>
            <button type="button" className="btn-icon" title={dict.mReverse} aria-label={dict.mReverse} onClick={() => change(reverseItems)}>
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2"><path d="M7 7h11l-3-3M17 17H6l3 3" /></svg>
            </button>
            <button type="button" className="btn-icon" title={dict.mClearAll} aria-label={dict.mClearAll} onClick={() => change(clearItems)}>
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" /></svg>
            </button>
          </div>
          <div className="hair mission-tools">
            <div className="seg" style={{ height: 36 }} role="group" aria-label="tool">
              <span className="lens" style={{ transform: `translateX(${ui.tool === 'add' ? 0 : 100}%)` }} />
              <button type="button" className={ui.tool === 'add' ? 'on' : ''} onClick={() => store.update((u) => setTool(u, 'add'))}>
                {dict.mToolAdd}
              </button>
              <button type="button" className={ui.tool === 'select' ? 'on' : ''} onClick={() => store.update((u) => setTool(u, 'select'))}>
                {dict.mToolSelect}
              </button>
            </div>
            <button type="button" className={`btn${palette ? ' on' : ''}`} style={{ height: 36, padding: '0 12px 0 10px', gap: 6 }} onClick={() => setPalette((p) => !p)}>
              <span style={{ fontSize: 17, lineHeight: 1, fontWeight: 300 }}>+</span>
              {dict.mInsertCmd}
            </button>
          </div>
          <div className="wp-scroll">
            <MissionList
              items={draft.items}
              selected={ui.selected}
              kind={vehicle?.kind ?? null}
              dict={dict}
              onSelect={(uid, additive, range) => store.update((u) => (range ? selectRange(u, uid) : selectOne(u, uid, additive)))}
              onReorder={(uid, dir) => change((d) => reorder(d, uid, dir))}
              onMove={(uids, before) => change((d) => moveItemsTo(d, uids, before))}
              onContext={(uid, x, y) => {
                store.update((u) => (u.selected.has(uid) ? u : selectOne(u, uid, false)))
                setMenu({ uid, x, y })
              }}
            />
          </div>
          <div className="t4 hair-t" style={{ padding: '6px 14px', fontSize: 10, lineHeight: 1.5 }}>
            {dict.mShortcuts}
          </div>
          <div className="hair-t" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, padding: '10px 12px 12px' }}>
            <button type="button" className="btn" disabled={ui.busy !== 'idle' || vehicle === null} onClick={() => void io.download()}>
              {dict.mRead}
            </button>
            <button type="button" className="btn" onClick={() => file.current?.click()}>
              {dict.mFileLoad}
            </button>
            <input
              ref={file}
              type="file"
              accept=".waypoints,.rgcsmission,.txt,text/plain,application/json"
              multiple
              style={{ display: 'none' }}
              data-testid="mission-file"
              onChange={(e) => {
                void io.loadFiles([...(e.target.files ?? [])])
                e.target.value = ''
              }}
            />
          </div>
          {palette && (
            <CommandPalette
              where={lastSelected ? `#${draft.items.indexOf(lastSelected) + 1} ${dict.mInsertAt}` : dict.mInsertEnd}
              dict={dict}
              onInsert={insertFromPalette}
              onClose={() => setPalette(false)}
            />
          )}
        </aside>
      )}

      {panel.collapsed && <PlanRail dict={dict} onExpand={panel.expand} />}
      {!panel.collapsed && plan.tab === 'fence' && (
        <FenceSidebar
          zones={draft.mission.fence}
          fenceParams={plan.fenceParams}
          onAltMax={plan.setAltMax}
          {...planIo}
        />
      )}
      {!panel.collapsed && plan.tab === 'rally' && <RallySidebar points={draft.mission.rally} {...planIo} />}
      {!panel.collapsed && plan.tab === 'mission' && (
      <MissionSidebar
        transfer={sysid === null ? null : (transfers.get(sysid) ?? null)}
        draft={draft}
        selectedItems={selectedItems}
        vehicles={list}
        sysid={sysid}
        kind={vehicle?.kind ?? null}
        stats={st}
        warnings={localWarnings(draft.items, draft.mission.speed)}
        findings={ui.findings}
        dirty={ui.dirty}
        busy={ui.busy !== 'idle'}
        dict={dict}
        bulk={bulk}
        onBulk={setBulk}
        onApplyBulk={applyBulk}
        onDeselect={() => store.update(clearSelection)}
        onDeleteSelected={() => store.update(removeSelected)}
        multi={brief.multi}
        onMeta={(patch) => {
          const own = brief.metaPatch(patch)
          change((d) => setMeta(d, own))
        }}
        onItemChange={(uid, patch) => change((d) => updateItem(d, uid, patch))}
        onItemCommand={(uid, key) => change((d) => setCommand(d, uid, key))}
        onNew={io.fresh}
        onOpen={io.openPicker}
        onSave={() => void io.save()}
        onUpload={() => (online.length > 1 && !brief.multi ? setTargets(true) : void io.upload())}
        onSaveFile={() => void io.saveWaypointsFile()}
        onSaveRgcs={io.saveRgcsFile}
        compare={batch.compare}
        onCollapse={panel.collapse}
      />
      )}

      {targets && (
        <UploadTargets
          vehicles={online}
          target={sysid}
          dict={dict}
          onClose={() => setTargets(false)}
          onWrite={(ids) => {
            setTargets(false)
            void io.upload(ids)
          }}
        />
      )}
      {batch.sheet}
      {briefIo.sheet}
      {io.picker && <MissionPicker dict={dict} title={dict.mSaved} onClose={io.closePicker} onPick={(row) => void io.openSaved(row.id)} />}
      {menu && (
        <ContextMenu
          menu={menu}
          dict={dict}
          onInsert={(uid) => {
            const it = draft.items.find((x) => x.uid === uid)
            if (it) change((d) => insertAfter(d, uid, it.lat + 0.0005, it.lon + 0.0005))
          }}
          onDelete={(uid) => change((d) => removeItems(d, new Set([uid])))}
          onBulkAlt={() => {
            store.update((u) => (u.selected.has(menu.uid) ? u : selectOne(u, menu.uid, false)))
            setBulk({ alt: String(draft.mission.default_alt), frame: draft.mission.default_frame })
          }}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}

export type { Mission }
