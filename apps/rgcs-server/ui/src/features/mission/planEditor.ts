// The fence / rally side of the planner: which tab is open, the zone being drawn, map clicks and
// handle drags turned into plan edits, and writing / reading the lists to / from the vehicle.
import { useState } from 'react'
import { ApiError } from '../../shared/api/client'
import type { Dict } from '../../shared/i18n'
import { readFence, readRally, writeFence, writeRally } from './api'
import type { FenceEdit, PlanTab } from './fenceMap'
import { addRally, addZone, appendVertex, moveCircle, moveRally, moveVertex, setFence, setRadius, setRally } from './geofenceModel'
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
  const [armed, setArmed] = useState<ArmedZone | null>(null)
  const [drawing, setDrawing] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<PlanStatus | null>(null)
  const fence = draft.mission.fence

  const finish = () => {
    setArmed(null)
    setDrawing(null)
  }
  const setTab = (t: PlanTab) => {
    finish()
    setStatus(null)
    setTabState(t)
  }
  const arm = (z: ArmedZone) => {
    setDrawing(null)
    setArmed(z)
  }

  const onPlanClick = (t: Exclude<PlanTab, 'mission'>, lat: number, lon: number) => {
    const p = { lat, lon }
    if (t === 'rally') return change((d) => addRally(d, p, d.mission.default_alt))
    // an undo may have taken the polygon away
    if (drawing !== null && drawing < fence.length) return change((d) => appendVertex(d, drawing, p))
    if (!armed) return
    if (armed.kind === 'circle') {
      change((d) => addZone(d, { kind: 'circle', inclusion: armed.inclusion, center: p, radius: NEW_CIRCLE_M }))
      return setArmed(null)
    }
    change((d) => addZone(d, { kind: 'polygon', inclusion: armed.inclusion, vertices: [p] }))
    setDrawing(fence.length)
  }

  const onFenceEdit = (e: FenceEdit) =>
    change((d) => (e.kind === 'vertex' ? moveVertex(d, e.zone, e.index, e) : e.kind === 'center' ? moveCircle(d, e.zone, e) : setRadius(d, e.zone, e.radius)))
  const onRallyMove = (i: number, lat: number, lon: number) => change((d) => moveRally(d, i, { lat, lon }))

  const run = async (fn: () => Promise<string>) => {
    setBusy(true)
    try {
      setStatus({ ok: true, text: await fn() })
    } catch (e) {
      setStatus({ ok: false, text: e instanceof ApiError ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }
  const report = (verified: boolean) => (verified ? dict.planWritten : dict.planMismatch)
  const write = () => {
    if (sysid === null) return
    void run(async () => report((tab === 'rally' ? await writeRally(sysid, draft.mission.rally) : await writeFence(sysid, fence)).verified))
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

  return { tab, setTab, armed, arm, drawing, finish, busy, status, write, read, onPlanClick, onFenceEdit, onRallyMove }
}
