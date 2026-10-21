import { useState } from 'react'
import type { CommandResult, InspectorRow, VehicleCommand, VehicleState } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { runCommand, type SendFn } from '../commands/useCommand'
import { INTERVAL_DEFAULT, INTERVAL_STOP, intervalCommand, intervalUs, parseHz } from './rate'

const AUTOPILOT_COMPID = 1

interface Props {
  readonly row: InspectorRow
  /** The row's vehicle (live state); undefined when unknown. */
  readonly vehicle: VehicleState | undefined
  readonly results: readonly CommandResult[]
  readonly dict: Dict
  readonly send?: SendFn
}

type Sent = { readonly kind: 'queued'; readonly id: number } | { readonly kind: 'error'; readonly message: string }

function noteFor(row: InspectorRow, vehicle: VehicleState | undefined, dict: Dict): string | null {
  if (row.dir !== 'rx') return dict.inspRateNoteTx
  if (row.compid !== AUTOPILOT_COMPID) return dict.inspRateNoteComp
  if (vehicle === undefined || vehicle.link === 'lost') return dict.inspRateNoteOffline
  return null
}

function Outcome({ sent, results, dict }: { sent: Sent | null; results: readonly CommandResult[]; dict: Dict }) {
  if (sent === null) return null
  if (sent.kind === 'error') return <div className="t3 insp-rate-out" role="status">{`${dict.inspRateFail}: ${sent.message}`}</div>
  const r = results.find((x) => x.id === sent.id)
  if (r === undefined) return <div className="t3 insp-rate-out" role="status">{dict.inspRateSent}</div>
  return <div className="t3 insp-rate-out" role="status">{r.ok ? dict.inspRateOk : `${dict.inspRateFail}${r.reason ? `: ${r.reason}` : ''}`}</div>
}

/** SET_MESSAGE_INTERVAL for the selected message: a rate in Hz, back to the default, or stopped. */
export function RateControls({ row, vehicle, results, dict, send }: Props) {
  const [text, setText] = useState('10')
  const [sent, setSent] = useState<Sent | null>(null)
  const note = noteFor(row, vehicle, dict)
  if (note !== null) return <div className="t3 insp-rate-note" data-testid="insp-rate-note">{note}</div>
  const hz = parseHz(text)
  const issue = (command: VehicleCommand) => {
    void runCommand(row.sysid, command, undefined, send).then((r) => setSent(r.kind === 'queued' ? r : { kind: 'error', message: r.kind === 'error' ? r.message : '' }))
  }
  return (
    <div className="insp-rate">
      <div className="row insp-rate-row">
        <label className="t2" htmlFor="insp-rate-hz">{dict.inspRate}</label>
        <input id="insp-rate-hz" className="in num" inputMode="decimal" value={text} aria-invalid={hz === null} onChange={(e) => setText(e.target.value)} />
        <span className="t2">Hz</span>
        <button type="button" className="btn btn-primary" disabled={hz === null} onClick={() => hz !== null && issue(intervalCommand(row.msg_id, intervalUs(hz)))}>{dict.inspRateSet}</button>
        <button type="button" className="btn btn-ghost" onClick={() => issue(intervalCommand(row.msg_id, INTERVAL_DEFAULT))}>{dict.inspRateDefault}</button>
        <button type="button" className="btn btn-ghost" onClick={() => issue(intervalCommand(row.msg_id, INTERVAL_STOP))}>{dict.inspRateStop}</button>
      </div>
      {hz === null && <div className="t3 insp-rate-invalid">{dict.inspRateInvalid}</div>}
      <div className="t3 num">{`${dict.inspRateMeasured}: ${row.rate_hz > 0 ? `${row.rate_hz.toFixed(1)} Hz` : '—'}`}</div>
      <Outcome sent={sent} results={results} dict={dict} />
    </div>
  )
}
