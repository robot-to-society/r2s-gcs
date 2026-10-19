// The 全コマンド panel as an operator tool (user request 2026-10-19): it stays open across
// commands until closed, always targets the selected vehicle, and confirmations appear as a
// modal over it instead of replacing it.
import { useState } from 'react'
import type { LogEntry, VehicleCommand, VehicleState } from '../../shared/api/types'
import { hhmmss } from '../../shared/format/time'
import type { Dict } from '../../shared/i18n'
import { entryText } from '../log/format'
import { requestConfirm } from './api'
import { CommandsSheet } from './CommandsSheet'
import { ConfirmDialog } from './ConfirmDialog'
import { runCommand, type RunResult, type SendFn } from './useCommand'

interface Deps {
  readonly send: SendFn
  readonly confirm: typeof requestConfirm
}

interface Props {
  readonly vehicle: VehicleState
  /** The message log, newest first: the panel shows the target vehicle's last command result. */
  readonly entries: readonly LogEntry[]
  readonly dict: Dict
  readonly beside?: boolean
  readonly onClose: () => void
  readonly onOpenGuided: (sysid: number) => void
  /** A send that failed before reaching the vehicle (logged like a command result). */
  readonly onError: (sysid: number, command: VehicleCommand, message: string) => void
  readonly deps?: Deps
}

interface Pending {
  readonly sysid: number
  readonly command: VehicleCommand
  readonly message?: string
}

function LastResult({ sysid, entries, sending, dict }: { sysid: number; entries: readonly LogEntry[]; sending: boolean; dict: Dict }) {
  const last = entries.find((e) => e.sysid === sysid && e.source === 'command')
  return (
    <div className="cmd-last t2" data-testid="cmd-last" aria-live="polite">
      {sending ? (
        <span className="t3">{dict.cmdSending}</span>
      ) : last ? (
        <span className={last.severity === 'error' ? 'bad' : ''}>
          <span className="num t3">{hhmmss(last.ts)}</span> {entryText(last, dict)}
        </span>
      ) : (
        <span className="t3">{dict.cmdNoResult}</span>
      )}
    </div>
  )
}

export function CommandDock({ vehicle, entries, dict, beside = false, onClose, onOpenGuided, onError, deps }: Props) {
  const [confirm, setConfirm] = useState<Pending | null>(null)
  const [sending, setSending] = useState(0)
  const settle = (sysid: number, command: VehicleCommand, r: RunResult) => {
    if (r.kind === 'needs_confirm') setConfirm({ sysid, command, message: r.message })
    else if (r.kind === 'error') onError(sysid, command, r.message)
  }
  const pick = (command: VehicleCommand) => {
    // The target is fixed when the button is pressed, even if the selection changes meanwhile.
    const sysid = vehicle.sysid
    setSending((n) => n + 1)
    void runCommand(sysid, command, undefined, deps?.send)
      .then((r) => settle(sysid, command, r))
      .finally(() => setSending((n) => n - 1))
  }
  return (
    <>
      <CommandsSheet
        vehicle={vehicle}
        dict={dict}
        beside={beside}
        onClose={onClose}
        onOpen={(target) => target === 'guided' && onOpenGuided(vehicle.sysid)}
        onPick={pick}
        footer={<LastResult sysid={vehicle.sysid} entries={entries} sending={sending > 0} dict={dict} />}
      />
      {confirm && (
        <ConfirmDialog
          sysid={confirm.sysid}
          command={confirm.command}
          message={confirm.message}
          vehicleName={confirm.sysid === vehicle.sysid ? vehicle.name : `#${confirm.sysid}`}
          dict={dict}
          deps={deps}
          onCancel={() => setConfirm(null)}
          onDone={(r) => {
            setConfirm(null)
            settle(confirm.sysid, confirm.command, r)
          }}
        />
      )}
    </>
  )
}
