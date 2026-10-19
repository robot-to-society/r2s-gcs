import { useEffect, useRef, useState } from 'react'
import type { VehicleCommand, VehicleState } from '../../shared/api/types'
import { cmdLabel, type Dict } from '../../shared/i18n'
import { haversineM } from '../mission/geo'
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
  /** The target's live state, for the context row. */
  readonly vehicle?: VehicleState
  /** Why we are asking again (e.g. the server said the previous token expired). */
  readonly message?: string
  readonly onCancel: () => void
  readonly onDone: (result: RunResult) => void
  readonly dict: Dict
  readonly deps?: Deps
}

const HOLD_MS = 1500

function describe(command: VehicleCommand, dict: Dict): string {
  const label = cmdLabel(command.cmd, dict)
  if (command.cmd === 'set_mode') return `${label} → ${command.args.mode}`
  if (command.cmd === 'change_alt') return `${label} → ${command.args.alt_rel} m`
  if (command.cmd === 'change_speed') return `${label} → ${command.args.mps} m/s`
  return label
}

/** Disarming a vehicle in the air stops the motors: it needs a deliberate hold (operator proposal 4). */
export const needsHold = (command: VehicleCommand, v: VehicleState | undefined): boolean => command.cmd === 'disarm' && v !== undefined && v.armed && v.alt_rel > 1

/** What the operator needs to judge the command: mode, altitude, battery, distance from home. */
function ContextRow({ v, dict }: { v: VehicleState; dict: Dict }) {
  const home = v.home && !(v.home.lat === 0 && v.home.lon === 0) ? Math.round(haversineM(v.lat, v.lon, v.home.lat, v.home.lon)) : null
  const parts = [v.mode, `${dict.ctxAlt} ${Math.round(v.alt_rel)} m`, `${dict.ctxBattery} ${v.battery.pct ?? '—'}%`, home === null ? null : `${dict.fromHome} ${home} m`]
  return (
    <div className="confirm-ctx num t2" data-testid="confirm-ctx">
      {parts.filter(Boolean).join(' · ')}
    </div>
  )
}

/** Enter runs and Escape cancels while the dialog is open — never from a field elsewhere on the page. */
function useConfirmKeys(box: React.RefObject<HTMLDivElement | null>, onEnter: (() => void) | null, onEscape: () => void): void {
  const handlers = useRef({ onEnter, onEscape })
  handlers.current = { onEnter, onEscape }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target instanceof HTMLElement ? e.target : null
      const inside = el !== null && box.current?.contains(el) === true
      if (e.key === 'Escape') {
        e.preventDefault()
        handlers.current.onEscape()
        return
      }
      if (e.key !== 'Enter' || !handlers.current.onEnter) return
      if (el && !inside && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return
      if (inside && el?.tagName === 'BUTTON') return // the focused button's own activation
      e.preventDefault()
      handlers.current.onEnter()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [box])
}

function HoldButton({ busy, dict, onFire }: { busy: boolean; dict: Dict; onFire: () => void }) {
  const [holding, setHolding] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stop = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    setHolding(false)
  }
  useEffect(() => stop, [])
  const start = () => {
    if (busy) return
    setHolding(true)
    timer.current = setTimeout(() => {
      timer.current = null
      setHolding(false)
      onFire()
    }, HOLD_MS)
  }
  return (
    <button type="button" className={`btn btn-danger hold${holding ? ' holding' : ''}`} disabled={busy} onPointerDown={start} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}>
      <span className="hold-fill" aria-hidden="true" />
      <span className="hold-label">{dict.holdToRun}</span>
    </button>
  )
}

/** Confirm step for spec 70 §1 commands: fetch a token, then send with it. */
export function ConfirmDialog({ sysid, command, vehicleName, vehicle, message, onCancel, onDone, dict, deps }: Props) {
  const [busy, setBusy] = useState(false)
  const running = useRef(false)
  const box = useRef<HTMLDivElement>(null)
  const confirm = deps?.confirm ?? requestConfirm
  const send = deps?.send ?? sendCommand
  const execute = async () => {
    if (running.current) return
    running.current = true
    setBusy(true)
    try {
      const { confirm_token } = await confirm(sysid, command.cmd)
      onDone(await runCommand(sysid, command, confirm_token, send))
    } catch (e) {
      onDone({ kind: 'error', code: 'unknown', message: e instanceof Error ? e.message : String(e) })
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  const hold = needsHold(command, vehicle)
  useConfirmKeys(box, hold ? null : () => void execute(), () => !running.current && onCancel())
  const danger = DESTRUCTIVE.has(command.cmd)
  return (
    <div className="modal-backdrop">
      <div ref={box} className="g-strong confirm" role="dialog" aria-label={dict.confirmTitle}>
        <div className="h2">{dict.confirmTitle}</div>
        <div className="confirm-body">
          <span className="confirm-cmd">{describe(command, dict)}</span>
          <span className="t2">{vehicleName}</span>
        </div>
        {vehicle && <ContextRow v={vehicle} dict={dict} />}
        {message && <div className="warnbox">{message}</div>}
        <div className="confirm-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            {dict.cancel}
          </button>
          {hold ? (
            <HoldButton busy={busy} dict={dict} onFire={() => void execute()} />
          ) : (
            <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => void execute()} disabled={busy}>
              {dict.execute}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
