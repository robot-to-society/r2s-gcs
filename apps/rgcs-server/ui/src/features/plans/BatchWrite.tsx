// The open plans' part of the planner's right panel and its sheet, wired for MissionView: the
// comparison table (two or more missions) and the 割当どおり書き込む sheet (spec 2026-10-20 §5.4 / §5.5).
import type { ReactNode } from 'react'
import type { Mission, VehicleState } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { vehicleStore } from '../vehicles/store'
import { BatchSheetView } from './BatchWriteSheet'
import { CompareTable } from './CompareTable'
import type { Workspace } from './model'
import { useBatchWrite } from './useBatchWrite'

/** Like 機体に書き込む: a verified write records the mission the vehicle now holds. */
const recordMission = (to: number, m: Mission) => vehicleStore.setVehicleMission(to, { ...m, sysid: to })

/** `busy`: the editor is saving / writing / reading. */
export function usePlanSetWrite(ws: Workspace, vehicles: ReadonlyMap<number, VehicleState>, busy: boolean, dict: Dict): { compare: ReactNode; sheet: ReactNode } {
  const batch = useBatchWrite(ws, vehicles, recordMission)
  return {
    compare: batch.lines.length >= 2 ? <CompareTable lines={batch.lines} canWrite={batch.canWrite && !busy} dict={dict} onWriteAll={batch.open} /> : null,
    sheet: batch.sheet && <BatchSheetView sheet={batch.sheet} dict={dict} onWrite={(jobs) => void batch.write(jobs)} onClose={batch.close} />,
  }
}
