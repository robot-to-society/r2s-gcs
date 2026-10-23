// Sends commands from any operator surface (全コマンド panel, detail panel emergency buttons):
// the target is fixed at the press, confirmations open as a modal over whatever is open, and
// each pressed button gets sending / done / failed feedback from the message log.
import { useEffect, useState, type ReactNode } from 'react'
import type { LogEntry, VehicleCommand, VehicleState } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { requestConfirm } from './api'
import { ConfirmDialog } from './ConfirmDialog'
import { errorText } from './errorText'
import { clearPress, failPress, NO_FEEDBACK, press, settle, stateOf, type BtnState, type Feedback } from './feedback'
import { runCommand, type RunResult, type SendFn } from './useCommand'

export interface RunnerDeps {
  readonly send: SendFn
  readonly confirm: typeof requestConfirm
}

interface Args {
  readonly entries: readonly LogEntry[]
  readonly dict: Dict
  readonly vehicleOf: (sysid: number) => VehicleState | undefined
  /** A send that failed before reaching the vehicle (logged like a command result). */
  readonly onError: (sysid: number, command: VehicleCommand, message: string) => void
  readonly deps?: RunnerDeps
}

interface Pending {
  readonly sysid: number
  readonly command: VehicleCommand
  readonly message?: string
}

export interface Runner {
  readonly pick: (sysid: number, command: VehicleCommand) => void
  readonly feedback: (sysid: number, cmd: string) => BtnState | null
  readonly sending: boolean
  /** The confirm modal, when one is open (render it once, anywhere). */
  readonly confirm: ReactNode
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [active])
  return now
}

export function useCommandRunner({ entries, dict, vehicleOf, onError, deps }: Args): Runner {
  const [pending, setPending] = useState<Pending | null>(null)
  const [sending, setSending] = useState(0)
  const [fb, setFb] = useState<Feedback>(NO_FEEDBACK)
  const now = useNow(fb.size > 0)
  useEffect(() => setFb((f) => settle(f, entries, Date.now())), [entries])

  const after = (sysid: number, command: VehicleCommand, r: RunResult) => {
    if (r.kind === 'needs_confirm') {
      setFb((f) => clearPress(f, sysid, command.cmd))
      setPending({ sysid, command, message: r.message })
    } else if (r.kind === 'error') {
      setFb((f) => failPress(f, sysid, command.cmd, Date.now()))
      onError(sysid, command, errorText(r.code, r.message, dict))
    }
  }
  const pick = (sysid: number, command: VehicleCommand) => {
    setFb((f) => press(f, sysid, command.cmd, entries, Date.now()))
    setSending((n) => n + 1)
    void runCommand(sysid, command, undefined, deps?.send)
      .then((r) => after(sysid, command, r))
      .finally(() => setSending((n) => n - 1))
  }
  const confirm = pending && (
    <ConfirmDialog
      sysid={pending.sysid}
      command={pending.command}
      message={pending.message}
      vehicleName={vehicleOf(pending.sysid)?.name ?? `#${pending.sysid}`}
      vehicle={vehicleOf(pending.sysid)}
      dict={dict}
      deps={deps}
      onCancel={() => setPending(null)}
      onDone={(r) => {
        setPending(null)
        if (r.kind === 'queued') setFb((f) => press(f, pending.sysid, pending.command.cmd, entries, Date.now()))
        else after(pending.sysid, pending.command, r)
      }}
    />
  )
  return { pick, feedback: (sysid, cmd) => stateOf(fb, sysid, cmd, now), sending: sending > 0, confirm }
}
