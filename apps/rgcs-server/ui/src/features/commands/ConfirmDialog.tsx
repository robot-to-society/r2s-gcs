import { useState } from 'react'
import type { VehicleCommand } from '../../shared/api/types'
import { cmdLabel, type Dict } from '../../shared/i18n'
import { requestConfirm, sendCommand } from './api'
import { DESTRUCTIVE } from './catalog'
import { runCommand, type RunResult, type SendFn } from './useCommand'

interface Deps {
  readonly confirm: typeof requestConfirm
  readonly send: SendFn
}

interface Props {
  readonly sysid: number
  readonly command: VehicleCommand
  readonly vehicleName: string
  /** Why we are asking again (e.g. the server said the previous token expired). */
  readonly message?: string
  readonly onCancel: () => void
  readonly onDone: (result: RunResult) => void
  readonly dict: Dict
  readonly deps?: Deps
}

function describe(command: VehicleCommand, dict: Dict): string {
  const label = cmdLabel(command.cmd, dict)
  if (command.cmd === 'set_mode') return `${label} → ${command.args.mode}`
  if (command.cmd === 'change_alt') return `${label} → ${command.args.alt_rel} m`
  if (command.cmd === 'change_speed') return `${label} → ${command.args.mps} m/s`
  return label
}

/** Confirm step for spec 70 §1 commands: fetch a token, then send with it. */
export function ConfirmDialog({ sysid, command, vehicleName, message, onCancel, onDone, dict, deps }: Props) {
  const [busy, setBusy] = useState(false)
  const confirm = deps?.confirm ?? requestConfirm
  const send = deps?.send ?? sendCommand
  const execute = async () => {
    setBusy(true)
    try {
      const { confirm_token } = await confirm(sysid, command.cmd)
      onDone(await runCommand(sysid, command, confirm_token, send))
    } catch (e) {
      onDone({ kind: 'error', code: 'unknown', message: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }
  const danger = DESTRUCTIVE.has(command.cmd)
  return (
    <div className="modal-backdrop">
      <div className="g-strong confirm" role="dialog" aria-label={dict.confirmTitle}>
        <div className="h2">{dict.confirmTitle}</div>
        <div className="confirm-body">
          <span className="confirm-cmd">{describe(command, dict)}</span>
          <span className="t2">{vehicleName}</span>
        </div>
        {message && <div className="warnbox">{message}</div>}
        <div className="confirm-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            {dict.cancel}
          </button>
          <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={execute} disabled={busy}>
            {dict.execute}
          </button>
        </div>
      </div>
    </div>
  )
}
