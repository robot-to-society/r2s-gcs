// Camera settings sheet flow (spec 10 §5): load profile + ROI on open, save in order, 地図で指定.
import { useEffect, useRef, useState } from 'react'
import type { CameraProfile, GimbalInputProfile, RoiControl, RoiTarget, VehicleState } from '../shared/api/types'
import { getCameraProfile, putCameraProfile } from '../features/camera/api'
import type { SheetDraft } from '../features/camera-settings/CameraSettingsSheet'
import { putGimbalProfile } from '../features/gimbal-joystick/api'
import { cancelPick as cancelMapPick, mapUiStore, startPick as startMapPick, type LatLon } from '../features/map/store'
import { getRoiControl, getRoiTargets, putRoiControl, putRoiTargets } from '../features/roi/api'
import { groundElevation } from '../features/roi/elevation'
import { pickInto } from '../features/roi/schema'
import { roiTargetsStore } from '../features/roi/targetsStore'
import { vehicleStore } from '../features/vehicles/store'
import { NO_MODAL, type Modal } from './modal'

export interface RoiSettings {
  readonly targets: RoiTarget[]
  readonly control: RoiControl
}

interface Deps {
  readonly modal: Modal
  readonly setModal: (m: Modal) => void
  readonly terrainTiles: string | null
  readonly vehicles: ReadonlyMap<number, VehicleState>
  readonly setGimbalProfile: (p: GimbalInputProfile) => void
}

export interface CameraSettingsFlow {
  readonly profile: CameraProfile | null
  readonly roi: RoiSettings | null
  readonly draft: SheetDraft | null
  /** The last pick had no terrain elevation (home altitude or 0 was used). */
  readonly elevationFallback: boolean
  readonly save: (sysid: number, d: SheetDraft) => Promise<void>
  readonly startPick: (sysid: number, d: SheetDraft, slot: number) => void
  readonly onMapPick: (p: LatLon) => Promise<void>
  readonly cancelPick: () => void
  readonly pickHint: 'none' | 'picking'
}

interface Pending {
  readonly sysid: number
  readonly draft: SheetDraft
  readonly slot: number
}

async function loadRoi(sysid: number): Promise<RoiSettings | null> {
  try {
    const [targets, control] = await Promise.all([getRoiTargets(sysid), getRoiControl(sysid)])
    return { targets, control }
  } catch {
    // an older server without the ROI routes: the sheet keeps the ROI tab off and save skips it
    return null
  }
}

function report(sysid: number, error: unknown): void {
  const reason = error === null ? null : error instanceof Error ? error.message : String(error)
  vehicleStore.pushLocalResult({ id: -Date.now(), sysid, cmd: 'camera_settings', ok: error === null, reason, ts: Date.now() })
}

/** Loads the sheet's data while it is open; returns null data until both requests settle. */
function useSettingsData(modal: Modal): { profile: CameraProfile | null; roi: RoiSettings | null } {
  const [data, setData] = useState<{ profile: CameraProfile | null; roi: RoiSettings | null }>({ profile: null, roi: null })
  const sysid = modal.kind === 'camera-settings' ? modal.sysid : null
  useEffect(() => {
    if (sysid === null) return
    let alive = true
    setData({ profile: null, roi: null })
    Promise.all([getCameraProfile(sysid).catch(() => null), loadRoi(sysid)])
      .then(([profile, roi]) => alive && setData({ profile, roi }))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [sysid])
  return data
}

export function useCameraSettingsFlow({ modal, setModal, terrainTiles, vehicles, setGimbalProfile }: Deps): CameraSettingsFlow {
  const { profile, roi } = useSettingsData(modal)
  const [draft, setDraft] = useState<SheetDraft | null>(null)
  const [elevationFallback, setElevationFallback] = useState(false)
  const [picking, setPicking] = useState(false)
  const pending = useRef<Pending | null>(null)
  const open = modal.kind === 'camera-settings'
  useEffect(() => {
    if (open) return
    setDraft(null)
    setElevationFallback(false)
  }, [open])

  const save = async (sysid: number, d: SheetDraft) => {
    const roiSteps = roi === null ? [] : [async () => roiTargetsStore.set(sysid, await putRoiTargets(sysid, d.roiTargets)), () => putRoiControl(sysid, d.roiControl)]
    const steps: (() => Promise<unknown>)[] = [() => putCameraProfile(sysid, d.camera), ...roiSteps, async () => setGimbalProfile(await putGimbalProfile(d.input))]
    try {
      for (const step of steps) await step()
      report(sysid, null)
    } catch (e: unknown) {
      report(sysid, e)
    }
    setModal(NO_MODAL)
  }

  const reopen = (sysid: number, d: SheetDraft) => {
    setDraft({ ...d, tab: 'roi' })
    setModal({ kind: 'camera-settings', sysid })
  }

  const startPick = (sysid: number, d: SheetDraft, slot: number) => {
    pending.current = { sysid, draft: d, slot }
    setPicking(true)
    setModal(NO_MODAL)
    mapUiStore.update((s) => startMapPick(s, 'roi-target'))
  }

  const onMapPick = async (p: LatLon) => {
    const pick = pending.current
    if (pick === null) return
    pending.current = null
    mapUiStore.update(cancelMapPick)
    const ground = await groundElevation(terrainTiles, p.lon, p.lat)
    const alt = ground ?? vehicles.get(pick.sysid)?.home?.alt ?? 0
    setPicking(false)
    reopen(pick.sysid, { ...pick.draft, roiTargets: pickInto(pick.draft.roiTargets, pick.slot, { lat: p.lat, lon: p.lon, alt }) })
    setElevationFallback(ground === null)
  }

  const cancelPick = () => {
    const pick = pending.current
    pending.current = null
    setPicking(false)
    mapUiStore.update(cancelMapPick)
    if (pick) reopen(pick.sysid, pick.draft)
  }

  return { profile, roi, draft, elevationFallback, save, startPick, onMapPick, cancelPick, pickHint: picking ? 'picking' : 'none' }
}
