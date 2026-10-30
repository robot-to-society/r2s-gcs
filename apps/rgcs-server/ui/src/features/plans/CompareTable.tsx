// The plan comparison table on the planner's right panel (spec 2026-10-20 §5.4): distance
// first and large; time and battery are estimates (目安) and the battery turns amber over 70 %.
import type { Dict } from '../../shared/i18n'
import { km, mmss } from '../mission/labels'
import type { CompareRow } from './compare'

export interface CompareLine extends CompareRow {
  readonly color: string
  readonly name: string
  /** The assigned vehicle's name; null = unassigned. */
  readonly vehicle: string | null
}

interface Props {
  readonly lines: readonly CompareLine[]
  /** Some row is assigned and the editor is idle. */
  readonly canWrite: boolean
  readonly dict: Dict
  readonly onWriteAll: () => void
}

function Line({ line, dict }: { readonly line: CompareLine; readonly dict: Dict }) {
  return (
    <tr>
      <td className="openPlans-cmp-name">
        <span className="openPlans-dot" style={{ background: line.color }} aria-hidden="true" />
        {line.name}
      </td>
      <td className={line.vehicle === null ? 't3' : ''}>{line.vehicle ?? dict.plUnassigned}</td>
      <td className="num">
        <span className="big">{km(line.distanceM)}</span>
      </td>
      <td className="num">{mmss(line.durationS)}</td>
      <td className={`num${line.batteryWarn ? ' warn' : ''}`}>{line.batteryPct === null ? '—' : `${line.batteryPct}%`}</td>
    </tr>
  )
}

export function CompareTable({ lines, canWrite, dict, onWriteAll }: Props) {
  return (
    <div className="sec openPlans-cmp" data-testid="plans-compare">
      <div className="h1" style={{ marginBottom: 8 }}>
        {dict.plCompare}
      </div>
      <table className="openPlans-cmp-table">
        <thead>
          <tr>
            <th>{dict.plColMission}</th>
            <th>{dict.plColVehicle}</th>
            <th>{dict.plColDistance}</th>
            <th>{dict.plColTime}</th>
            <th>{dict.plColBattery}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <Line key={l.key} line={l} dict={dict} />
          ))}
        </tbody>
      </table>
      <div className="t4 openPlans-cmp-note">{dict.plBatteryNote}</div>
      <button type="button" className="btn btn-primary openPlans-cmp-write" disabled={!canWrite} onClick={onWriteAll}>
        {dict.plWriteAll}
      </button>
    </div>
  )
}
