// State and orchestration of the briefing comparison table and 割当どおり書き込む (spec 2026-10-20
// §5.4 / §5.5), kept out of MissionView. Missing rows are neither compared nor written.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Mission, VehicleState } from '../../shared/api/types'
import { readFence, readRally, uploadMission, validateMission, writeFence, writeRally } from '../mission/api'
import { toMission } from '../mission/model'
import { leftovers, runBatch, type BatchDeps, type BatchJob, type BatchState, type Leftover } from './batch'
import type { SheetLine } from './BatchWriteSheet'
import { compareRows, type CompareRow } from './compare'
import type { CompareLine } from './CompareTable'
import type { Row, Workspace } from './model'
import { useEndurance } from './useEndurance'

export interface BatchSheet {
  readonly lines: readonly SheetLine[]
  readonly leftovers: ReadonlyMap<number, Leftover> | null
  readonly states: ReadonlyMap<string, BatchState>
  readonly running: boolean
}

type Vehicles = ReadonlyMap<number, VehicleState>
const vehicleName = (vehicles: Vehicles, sysid: number): string => vehicles.get(sysid)?.name ?? `#${sysid}`

const figuresFor = (rows: readonly Row[], endurance: ReadonlyMap<number, number | null>): readonly CompareRow[] =>
  compareRows(rows.map((r) => ({ key: r.key, draft: r.ui.history.present, enduranceMin: r.sysid === null ? null : (endurance.get(r.sysid) ?? null) })))

/** `onVerified`: a vehicle's read-back matched (the caller records the mission it now holds). */
export function useBatchWrite(ws: Workspace, vehicles: Vehicles, onVerified: (sysid: number, mission: Mission) => void) {
  const rows = useMemo(() => ws.rows.filter((r) => !r.missing), [ws])
  const endurance = useEndurance(rows.flatMap((r) => (r.sysid === null ? [] : [r.sysid])))
  // the figures follow the plans; the names follow the telemetry (which updates far more often)
  const figures = useMemo(() => figuresFor(rows, endurance), [rows, endurance])
  const lines: CompareLine[] = rows.map((r, i) => ({ ...figures[i]!, color: r.color, name: r.ui.history.present.mission.name, vehicle: r.sysid === null ? null : vehicleName(vehicles, r.sysid) }))
  const [sheet, setSheet] = useState<BatchSheet | null>(null)
  const latest = useRef(vehicles)
  useEffect(() => {
    latest.current = vehicles
  }, [vehicles])
  const session = useRef(0)

  const open = () => {
    const id = ++session.current
    const picked: SheetLine[] = rows.flatMap((r, i) =>
      r.sysid === null ? [] : [{ key: r.key, color: r.color, name: lines[i]!.name, sysid: r.sysid, vehicle: vehicleName(vehicles, r.sysid), distanceM: lines[i]!.distanceM, mission: toMission(r.ui.history.present) }],
    )
    setSheet({ lines: picked, leftovers: null, states: new Map(), running: false })
    void leftovers(picked, { fence: readFence, rally: readRally }).then((left) => session.current === id && setSheet((s) => s && { ...s, leftovers: left }))
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

  const write = async (jobs: readonly BatchJob[]) => {
    setSheet((s) => s && { ...s, running: true })
    try {
      await runBatch(jobs, deps, (st) => setSheet((s) => s && { ...s, states: new Map([...s.states, [st.key, st]]) }))
    } finally {
      setSheet((s) => s && { ...s, running: false })
    }
  }

  const close = () => {
    session.current++
    setSheet(null)
  }

  return { lines, canWrite: rows.some((r) => r.sysid !== null) && !sheet?.running, sheet, open, write, close }
}
