// The fence / rally side of the planner: which tab is open, the zone being drawn, map clicks and
// handle drags turned into plan edits, and writing / reading the lists to / from the vehicle.
import { useEffect, useState } from 'react'
import { ApiError } from '../../shared/api/client'
import type { Dict } from '../../shared/i18n'
import { readFence, readFenceParams, readRally, setFenceAltMax, writeFence, writeRally } from './api'
import type { FenceEdit, PlanTab } from './fenceMap'
import { addRally, addZone, rallyDefaultAlt, moveCircle, moveRally, moveVertex, replaceZone, setFence, setRadius, setRally } from './geofenceModel'
import type { FenceParams, FenceZone } from '../../shared/api/types'
import type { Draft } from './model'
import type { ArmedZone, PlanStatus } from './PlanPanels'
import { readPlanTab } from './planTab'

/** A new circle starts with this radius; the handle then sets it. */
const NEW_CIRCLE_M = 100

interface Args {
  readonly draft: Draft
  readonly sysid: number | null
  readonly dict: Dict
  /** One undoable plan edit. */
  readonly change: (fn: (d: Draft) => Draft) => void
}

export function usePlanEditor({ draft, sysid, dict, change }: Args) {
  const [tab, setTabState] = useState<PlanTab>(readPlanTab)
  const [armedState, setArmed] = useState<ArmedZone | null>(null)
  // The polygon being drawn, by identity: a read, delete, load or undo that replaces it ends the
  // drawing instead of letting clicks grow whatever zone now sits at its index.
  const [drawingZone, setDrawingZone] = useState<FenceZone | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<PlanStatus | null>(null)
  // the target vehicle's FENCE_* parameters: the ceiling of the 3D walls and the profile line
  const [fenceParams, setFenceParams] = useState<FenceParams | null>(null)
  useEffect(() => {
    let live = true
    if (sysid !== null) {
      readFenceParams(sysid)
        .then((p) => live && setFenceParams(p))
        .catch(() => live && setFenceParams(null))
    }
    return () => {
      live = false
    }
  }, [sysid])
  const fence = draft.mission.fence
  const at = drawingZone ? fence.indexOf(drawingZone) : -1
  const lost = drawingZone !== null && at < 0
  const armed = lost ? null : armedState
  const drawing = at < 0 ? null : at

  const finish = () => {
    setArmed(null)
    setDrawingZone(null)
  }
  const setTab = (t: PlanTab) => {
    finish()
    setStatus(null)
    setTabState(t)
  }
  const arm = (z: ArmedZone) => {
    setDrawingZone(null)
    setArmed(z)
  }

  const onPlanClick = (t: Exclude<PlanTab, 'mission'>, lat: number, lon: number) => {
    const p = { lat, lon }
    if (t === 'rally') return change((d) => addRally(d, p, rallyDefaultAlt(d.mission)))
    if (lost) return finish()
    if (drawing !== null && drawingZone?.kind === 'polygon') {
      const next: FenceZone = { ...drawingZone, vertices: [...drawingZone.vertices, p] }
      change((d) => replaceZone(d, drawing, next))
      return setDrawingZone(next)
    }
    if (!armed) return
    if (armed.kind === 'circle') {
      change((d) => addZone(d, { kind: 'circle', inclusion: armed.inclusion, center: p, radius: NEW_CIRCLE_M }))
      return setArmed(null)
    }
    const zone: FenceZone = { kind: 'polygon', inclusion: armed.inclusion, vertices: [p] }
    change((d) => addZone(d, zone))
    setDrawingZone(zone)
  }

  const onFenceEdit = (e: FenceEdit) =>
    change((d) => (e.kind === 'vertex' ? moveVertex(d, e.zone, e.index, e) : e.kind === 'center' ? moveCircle(d, e.zone, e) : setRadius(d, e.zone, e.radius)))
  const onRallyMove = (i: number, lat: number, lon: number) => change((d) => moveRally(d, i, { lat, lon }))

  const run = async (fn: () => Promise<string>) => {
    setBusy(true)
    try {
      setStatus({ ok: true, text: await fn() })
    } catch (e) {
      setStatus({ ok: false, text: e instanceof ApiError || e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }
  const report = (verified: boolean) => (verified ? dict.planWritten : dict.planMismatch)
  const write = () => {
    if (sysid === null) return
    if (tab !== 'rally') return void run(async () => report((await writeFence(sysid, fence)).verified))
    // a rally upload is not atomic on ArduPilot: a failure half-way leaves part of the list
    void run(async () => {
      try {
        return report((await writeRally(sysid, draft.mission.rally)).verified)
      } catch (e) {
        throw new Error(`${e instanceof ApiError ? e.message : String(e)} — ${dict.rallyPartial}`)
      }
    })
  }
  const read = () => {
    if (sysid === null) return
    void run(async () => {
      if (tab === 'rally') {
        const { points } = await readRally(sysid)
        change((d) => setRally(d, points))
      } else {
        const { zones } = await readFence(sysid)
        change((d) => setFence(d, zones))
      }
      return dict.planReadDone
    })
  }

  const setAltMax = (value: number) => {
    if (sysid === null) return
    void run(async () => {
      const verified = await setFenceAltMax(sysid, value)
      setFenceParams(await readFenceParams(sysid))
      return verified ? dict.fenceAltMaxSaved : dict.planMismatch
    })
  }

  return { tab, setTab, armed, arm, drawing, finish, busy, status, write, read, onPlanClick, onFenceEdit, onRallyMove, fenceParams: sysid === null ? null : fenceParams, setAltMax }
}
