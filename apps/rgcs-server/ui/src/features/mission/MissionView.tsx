import type { StyleSpecification } from 'maplibre-gl'
import { useState } from 'react'
import type { Mission, MissionFrame, VehicleState } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { vehicleStore } from '../vehicles/store'
import { FRAMES } from './cmds'
import { ContextMenu } from './ContextMenu'
import { ItemEditor } from './ItemEditor'
import { MissionFooter } from './MissionFooter'
import { MissionList } from './MissionList'
import { MissionMap } from './MissionMap'
import { MissionPicker } from './MissionPicker'
import { SummaryPanel } from './SummaryPanel'
import { canRedo, canUndo } from './history'
import type { ContextMenu as Menu } from './mapEdit'
import { useMissionIo } from './useMissionIo'
import { appendWaypoint, insertAfter, moveItem, moveItems, removeItems, reorder, setAltBulk, setCommand, setMeta, updateItem, type Draft } from './model'
import { MissionStore, clearSelection, edit, missionStore, redoUi, removeSelected, selectOne, selectRange, setTool, undoUi, useMissionUi, type Tool } from './store'
import { localWarnings, stats } from './summary'

interface Props {
  readonly vehicles: ReadonlyMap<number, VehicleState>
  readonly dict: Dict
  readonly style: StyleSpecification
  readonly store?: MissionStore
}

const isEditable = (t: EventTarget | null): boolean => t instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName)

/** The mission planning screen (spec 10 §6, 2D subset; addendum §5.2). */
export function MissionView({ vehicles, dict, style, store = missionStore }: Props) {
  const ui = useMissionUi(store)
  const draft = ui.history.present
  const [menu, setMenu] = useState<Menu | null>(null)
  const [bulk, setBulk] = useState<{ alt: string; frame: MissionFrame } | null>(null)
  const list = [...vehicles.values()].sort((a, b) => a.sysid - b.sysid)
  const sysid = draft.mission.sysid ?? list[0]?.sysid ?? null
  const vehicle = sysid === null ? null : (vehicles.get(sysid) ?? null)
  const change = (fn: (d: Draft) => Draft) => store.update((u) => edit(u, fn(u.history.present)))
  const io = useMissionIo(store, sysid, dict, vehicleStore)

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (isEditable(e.target)) return
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      store.update(removeSelected)
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      store.update(e.shiftKey ? redoUi : undoUi)
    }
  }

  const selectedItems = draft.items.filter((it) => ui.selected.has(it.uid))
  const only = selectedItems.length === 1 ? selectedItems[0] : undefined
  const applyBulk = () => {
    if (!bulk) return
    const alt = Number(bulk.alt)
    if (!Number.isNaN(alt)) change((d) => setAltBulk(d, ui.selected, alt, bulk.frame))
    setBulk(null)
  }

  return (
    <div className="mission-view" style={{ position: 'absolute', inset: 0 }} tabIndex={-1} onKeyDown={onKeyDown} data-testid="mission-view">
      <MissionMap
        draft={draft}
        selected={ui.selected}
        tool={ui.tool}
        style={style}
        vehicle={vehicle}
        fitRequest={io.fitRequest}
        onAdd={(lat, lon) => change((d) => appendWaypoint(d, lat, lon))}
        onInsertAfter={(uid, lat, lon) => change((d) => insertAfter(d, uid, lat, lon))}
        onMove={(uid, lat, lon) => change((d) => moveItem(d, uid, lat, lon))}
        onMoveSelected={(dLat, dLon) => change((d) => moveItems(d, ui.selected, dLat, dLon))}
        onSelect={(uid, additive, range) => store.update((u) => (range ? selectRange(u, uid) : selectOne(u, uid, additive)))}
        onBackgroundClick={() => store.update(clearSelection)}
        onContext={setMenu}
      />
      <aside className="mission-left" aria-label={dict.navMission}>
        <div className="mission-meta">
          <label className="wide">
            {dict.mName}
            <input value={draft.mission.name} onChange={(e) => change((d) => setMeta(d, { name: e.target.value }))} />
          </label>
          <label className="wide">
            {dict.mVehicle}
            <select value={sysid ?? ''} onChange={(e) => change((d) => setMeta(d, { sysid: e.target.value === '' ? null : Number(e.target.value) }))}>
              {list.length === 0 && <option value="">{dict.mNoVehicle}</option>}
              {list.map((v) => (
                <option key={v.sysid} value={v.sysid}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {dict.mDefaultAlt}
            <span className="alt-pair">
              <select aria-label={dict.mFrame} value={draft.mission.default_frame} onChange={(e) => change((d) => setMeta(d, { default_frame: e.target.value as MissionFrame }))}>
                {(Object.keys(FRAMES) as MissionFrame[]).map((f) => (
                  <option key={f} value={f}>
                    {FRAMES[f].short}
                  </option>
                ))}
              </select>
              <input type="number" aria-label={dict.mDefaultAlt} value={draft.mission.default_alt} onChange={(e) => change((d) => setMeta(d, { default_alt: Number(e.target.value) || 0 }))} />
            </span>
          </label>
          <label>
            {dict.mSpeed}
            <input type="number" step={0.5} value={draft.mission.speed} onChange={(e) => change((d) => setMeta(d, { speed: Number(e.target.value) || 0 }))} />
          </label>
        </div>
        <MissionList
          items={draft.items}
          selected={ui.selected}
          dict={dict}
          onSelect={(uid, additive, range) => store.update((u) => (range ? selectRange(u, uid) : selectOne(u, uid, additive)))}
          onReorder={(uid, dir) => change((d) => reorder(d, uid, dir))}
        />
      </aside>
      <aside className="mission-right" aria-label="editor">
        <div className="grow" style={{ overflow: 'auto', minHeight: 0 }}>
          {only && (
            <ItemEditor
              item={only}
              uid={only.uid}
              seq={draft.items.indexOf(only) + 1}
              kind={vehicle?.kind ?? null}
              dict={dict}
              onChange={(uid, patch) => change((d) => updateItem(d, uid, patch))}
              onCommand={(uid, key) => change((d) => setCommand(d, uid, key))}
            />
          )}
          {!only && (
            <div className="multi-note">
              {selectedItems.length === 0 ? dict.mNoSelection : dict.mSelectedN.replace('{n}', String(selectedItems.length))}
              {selectedItems.length > 1 && !bulk && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setBulk({ alt: String(draft.mission.default_alt), frame: draft.mission.default_frame })}>
                  {dict.mBulkAlt}
                </button>
              )}
            </div>
          )}
          {bulk && (
            <div className="multi-note item-editor" data-testid="bulk-alt">
              <label className="field">
                {dict.mFrame}
                <select aria-label={`bulk-${dict.mFrame}`} value={bulk.frame} onChange={(e) => setBulk({ ...bulk, frame: e.target.value as MissionFrame })}>
                  {(Object.keys(FRAMES) as MissionFrame[]).map((f) => (
                    <option key={f} value={f}>
                      {FRAMES[f].short}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                {dict.altitude}
                <input type="number" aria-label={`bulk-${dict.altitude}`} value={bulk.alt} onChange={(e) => setBulk({ ...bulk, alt: e.target.value })} />
              </label>
              <div className="row">
                <button type="button" className="btn btn-primary btn-sm" onClick={applyBulk}>
                  {dict.mApply}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setBulk(null)}>
                  {dict.cancel}
                </button>
              </div>
            </div>
          )}
        </div>
        <SummaryPanel stats={stats(draft.items, draft.mission.home, draft.mission.speed)} warnings={localWarnings(draft.items, draft.mission.speed)} findings={ui.findings} dict={dict} />
      </aside>
      <MissionFooter
        tool={ui.tool}
        canUndo={canUndo(ui.history)}
        canRedo={canRedo(ui.history)}
        dirty={ui.dirty}
        busy={ui.busy}
        hasVehicle={vehicle !== null}
        dict={dict}
        onTool={(t: Tool) => store.update((u) => setTool(u, t))}
        onUndo={() => store.update(undoUi)}
        onRedo={() => store.update(redoUi)}
        onNew={io.fresh}
        onOpen={io.openPicker}
        onSave={() => void io.save()}
        onFileWaypoints={() => void io.saveWaypointsFile()}
        onFileRgcs={io.saveRgcsFile}
        onFile={(f) => void io.loadFile(f)}
        onWrite={() => void io.upload()}
        onRead={() => void io.download()}
      />
      {io.discard && (
        <div className="ctx-menu g-strong" role="alertdialog" style={{ left: '50%', top: '40%', transform: 'translateX(-50%)' }}>
          <span style={{ padding: '6px 10px' }}>{dict.mDiscard}</span>
          <div className="row" style={{ padding: 4 }}>
            <button type="button" className="btn btn-primary btn-sm" onClick={io.confirmDiscard}>
              {dict.mContinue}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={io.cancelDiscard}>
              {dict.cancel}
            </button>
          </div>
        </div>
      )}
      {io.picker && (
        <MissionPicker dict={dict} title={dict.mSaved} onClose={io.closePicker} onPick={(row) => void io.openSaved(row.id)} />
      )}
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
