// Save / open / file / vehicle I/O for the mission view. Every network call reports through the
// footer pills (`vehicleStore.pushLocalResult`), never through a dialog.
import { useState } from 'react'
import type { Mission } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import type { VehicleStore } from '../vehicles/store'
import { createMission, downloadMission, exportWaypoints, getMission, importWaypoints, updateMission, uploadMission, validateMission } from './api'
import { downloadText, parseRgcsMission, readFileText, safeFileStem, serializeRgcsMission } from './files'
import { toMission } from './model'
import { fresh as freshUi, loaded, markSaved, setBusy, setFindings, setReport, type MissionStore } from './store'

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export function useMissionIo(store: MissionStore, sysid: number | null, dict: Dict, vehicles: VehicleStore) {
  const [fitRequest, setFitRequest] = useState(0)
  const [picker, setPicker] = useState(false)
  const [discard, setDiscard] = useState<(() => void) | null>(null)
  const fit = () => setFitRequest((n) => n + 1)
  const result = (cmd: string, ok: boolean, reason: string | null, to: number | null = sysid) =>
    vehicles.pushLocalResult({ id: -Date.now(), sysid: to ?? 0, cmd, ok, reason, ts: Date.now() })

  /** Runs `fn` now, or after the operator confirms discarding unsaved edits. */
  const guard = (fn: () => void) => {
    if (store.getState().dirty) setDiscard(() => fn)
    else fn()
  }
  const load = (m: Mission, id: number | null) => {
    store.update((u) => loaded(u, m, id))
    fit()
  }

  const save = async (): Promise<number | null> => {
    const ui = store.getState()
    const mission = toMission(ui.history.present)
    store.update((u) => setBusy(u, 'saving'))
    try {
      const saved = ui.savedId === null ? await createMission(mission) : await updateMission(ui.savedId, mission)
      const id = saved.id ?? ui.savedId
      if (id !== null) store.update((u) => markSaved(u, id))
      return id
    } catch (e) {
      result('mission_save', false, errText(e))
      return null
    } finally {
      store.update((u) => setBusy(u, 'idle'))
    }
  }

  /**
   * Validates and writes the plan to one vehicle; false when the validation stopped it. `keep`:
   * an earlier vehicle's fatal findings stay on screen instead of this one's.
   */
  const uploadOne = async (to: number, mission: Mission, keep: boolean): Promise<boolean> => {
    try {
      const { findings } = await validateMission(mission, to)
      const fatal = findings.some((f) => f.level === 'fatal')
      if (fatal || !keep) store.update((u) => setFindings(u, findings))
      if (fatal) {
        result('mission_upload', false, dict.upFatal, to)
        return false
      }
      const report = await uploadMission(to, mission)
      store.update((u) => setReport(keep ? u : setFindings(u, report.findings), report))
      if (report.verified) vehicles.setVehicleMission(to, { ...mission, sysid: to })
      result('mission_upload', report.verified, report.verified ? `${report.items} ${dict.mItems}, ${dict.mVerified}` : `${dict.mMismatch}: ${report.mismatched.join(', ')}`, to)
    } catch (e) {
      result('mission_upload', false, errText(e), to)
    }
    return true
  }

  /** Writes the plan to `targets` (default: the mission's vehicle) one after another. */
  const upload = async (targets: readonly number[] = sysid === null ? [] : [sysid]) => {
    if (targets.length === 0) return
    const mission = toMission(store.getState().history.present)
    store.update((u) => setBusy(u, 'uploading'))
    try {
      let stopped = false
      for (const to of targets) stopped = !(await uploadOne(to, mission, stopped)) || stopped
    } finally {
      store.update((u) => setBusy(u, 'idle'))
    }
  }

  const download = async () => {
    if (sysid === null) return
    store.update((u) => setBusy(u, 'downloading'))
    try {
      const m = await downloadMission(sysid)
      vehicles.setVehicleMission(sysid, m)
      guard(() => load({ ...m, name: m.name || `${dict.mDownloaded} ${new Date().toLocaleTimeString()}` }, null))
      result('mission_download', true, `${m.items.length} ${dict.mItems}`)
    } catch (e) {
      result('mission_download', false, errText(e))
    } finally {
      store.update((u) => setBusy(u, 'idle'))
    }
  }

  const saveWaypointsFile = async () => {
    const ui = store.getState()
    const id = ui.dirty || ui.savedId === null ? await save() : ui.savedId
    if (id === null) return
    try {
      const text = await exportWaypoints(id)
      downloadText(`${safeFileStem(store.getState().history.present.mission.name)}.waypoints`, text, 'text/plain')
    } catch (e) {
      result('mission_export', false, errText(e))
    }
  }

  const saveRgcsFile = () => {
    const m = toMission(store.getState().history.present)
    downloadText(`${safeFileStem(m.name)}.rgcsmission`, serializeRgcsMission(m), 'application/json')
  }

  const loadFile = async (file: File) => {
    try {
      const text = await readFileText(file)
      const stem = file.name.replace(/\.[^.]+$/, '')
      const m = file.name.endsWith('.rgcsmission') ? parseRgcsMission(text) : await importWaypoints(text, stem)
      guard(() => load({ ...m, name: m.name || stem }, null))
    } catch (e) {
      result('mission_import', false, errText(e))
    }
  }

  const openSaved = async (id: number) => {
    setPicker(false)
    try {
      const m = await getMission(id)
      guard(() => load(m, id))
    } catch (e) {
      result('mission_open', false, errText(e))
    }
  }

  return {
    fitRequest,
    picker,
    discard: discard !== null,
    openPicker: () => setPicker(true),
    closePicker: () => setPicker(false),
    confirmDiscard: () => {
      discard?.()
      setDiscard(null)
    },
    cancelDiscard: () => setDiscard(null),
    fresh: () => guard(() => store.update(freshUi)),
    save,
    upload,
    download,
    saveWaypointsFile,
    saveRgcsFile,
    loadFile,
    openSaved,
  }
}
