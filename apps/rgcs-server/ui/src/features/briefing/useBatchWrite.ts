// State and orchestration of the briefing comparison table and 割当どおり書き込む (spec 2026-10-20
// §5.4 / §5.5), kept out of MissionView. Missing rows are neither compared nor written.
import { useEffect, useMemo, useRef } from 'react'
import type { Mission, VehicleState } from '../../shared/api/types'
import { readFence, readRally, uploadMission, validateMission, writeFence, writeRally } from '../mission/api'
import { toMission } from '../mission/model'
import { leftovers, runBatch, type BatchDeps, type BatchJob } from './batch'
import { batchStore, useBatchSheet, type BatchStore } from './batchStore'
import type { SheetLine } from './BatchWriteSheet'
import { compareRows, type CompareRow } from './compare'
import type { CompareLine } from './CompareTable'
import type { Row, Workspace } from './model'
import { useEndurance } from './useEndurance'

type Vehicles = ReadonlyMap<number, VehicleState>
const vehicleName = (vehicles: Vehicles, sysid: number): string => vehicles.get(sysid)?.name ?? `#${sysid}`

const figuresFor = (rows: readonly Row[], endurance: ReadonlyMap<number, number | null>): readonly CompareRow[] =>
  compareRows(rows.map((r) => ({ key: r.key, draft: r.ui.history.present, enduranceMin: r.sysid === null ? null : (endurance.get(r.sysid) ?? null) })))

/** `onVerified`: a vehicle's read-back matched (the caller records the mission it now holds). */
export function useBatchWrite(ws: Workspace, vehicles: Vehicles, onVerified: (sysid: number, mission: Mission) => void, store: BatchStore = batchStore) {
  const rows = useMemo(() => ws.rows.filter((r) => !r.missing), [ws])
  const endurance = useEndurance(rows.flatMap((r) => (r.sysid === null ? [] : [r.sysid])))
  // the figures follow the plans; the names follow the telemetry (which updates far more often)
  const figures = useMemo(() => figuresFor(rows, endurance), [rows, endurance])
  const lines: CompareLine[] = rows.map((r, i) => ({ ...figures[i]!, color: r.color, name: r.ui.history.present.mission.name, vehicle: r.sysid === null ? null : vehicleName(vehicles, r.sysid) }))
  const sheet = useBatchSheet(store)
  const latest = useRef(vehicles)
  useEffect(() => {
    latest.current = vehicles
  }, [vehicles])
  const busy = () => store.getState()?.running === true

  /** Not while a batch runs (its sheet stays). */
  const open = () => {
    if (busy()) return
    const id = store.nextSession()
    const picked: SheetLine[] = rows.flatMap((r, i) =>
      r.sysid === null ? [] : [{ key: r.key, color: r.color, name: lines[i]!.name, sysid: r.sysid, vehicle: vehicleName(vehicles, r.sysid), distanceM: lines[i]!.distanceM, mission: toMission(r.ui.history.present) }],
    )
    store.update(() => ({ session: id, lines: picked, leftovers: null, states: new Map(), running: false }))
    void leftovers(picked, { fence: readFence, rally: readRally }).then((left) => store.patch(id, (s) => ({ ...s, leftovers: left })))
  }

  const deps: BatchDeps = {
    validate: validateMission,
    upload: async (sysid, mission) => {
      const report = await uploadMission(sysid, mission)
      if (report.verified) onVerified(sysid, mission)
      return report
    },
    writeFence,
    writeRally,
    connected: (sysid) => {
      const v = latest.current.get(sysid)
      return v !== undefined && v.link !== 'lost'
    },
  }

  /** Refused while a batch runs; the running flag is set before the first await. */
  const write = async (jobs: readonly BatchJob[]) => {
    const current = store.getState()
    if (current === null || current.running) return
    const id = current.session
    store.patch(id, (s) => ({ ...s, running: true }))
    try {
      await runBatch(jobs, deps, (st) => store.patch(id, (s) => ({ ...s, states: new Map([...s.states, [st.key, st]]) })))
    } finally {
      store.patch(id, (s) => ({ ...s, running: false }))
    }
  }

  const close = () => store.update((s) => (s?.running ? s : null))

  return { lines, canWrite: rows.some((r) => r.sysid !== null) && !sheet?.running, sheet, open, write, close }
}
