// 割当どおり書き込む confirmation (spec 2026-10-20 §5.5): the assignments, what fence / rally each
// vehicle still holds (消す / 残す, default 残す), then per-row progress while the batch runs.
import { useState, type ReactNode } from 'react'
import type { Mission } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { IconCheck, IconClose, IconError } from '../../shared/ui/icons'
import { km } from '../mission/labels'
import { BATCH_REASONS, type BatchJob, type BatchState, type Leftover } from './batch'
import type { BatchSheet } from './batchStore'

export interface SheetLine {
  readonly key: string
  readonly color: string
  readonly name: string
  readonly sysid: number
  readonly vehicle: string
  readonly distanceM: number
  readonly mission: Mission
}

interface Props {
  readonly lines: readonly SheetLine[]
  /** null while the vehicles are being read. */
  readonly leftovers: ReadonlyMap<number, Leftover> | null
  readonly states: ReadonlyMap<string, BatchState>
  readonly running: boolean
  readonly dict: Dict
  readonly onWrite: (jobs: readonly BatchJob[]) => void
  readonly onClose: () => void
}

type Clear = { readonly fence: boolean; readonly rally: boolean }
const KEEP: Clear = { fence: false, rally: false }

function reasonText(reason: string | null, dict: Dict): string {
  const known: Record<string, string> = {
    [BATCH_REASONS.offline]: dict.bfOffline,
    [BATCH_REASONS.mismatch]: dict.bfMismatch,
    [BATCH_REASONS.fenceMismatch]: dict.bfFenceMismatch,
    [BATCH_REASONS.rallyMismatch]: dict.bfRallyMismatch,
    [BATCH_REASONS.fatal]: dict.upFatal,
  }
  return reason === null ? '' : (known[reason] ?? reason)
}

/** 消す only counts where the line shows the control: a known leftover > 0 and none in the mission. */
const erasable = (own: number, left: number | null | undefined): boolean => own === 0 && typeof left === 'number' && left > 0

function toJobs(lines: readonly SheetLine[], leftovers: ReadonlyMap<number, Leftover> | null, clear: ReadonlyMap<string, Clear>): BatchJob[] {
  return lines.map((l) => {
    const left = leftovers?.get(l.sysid)
    const c = clear.get(l.key) ?? KEEP
    return {
      key: l.key,
      sysid: l.sysid,
      mission: l.mission,
      clearFence: c.fence && erasable(l.mission.fence.length, left?.fence),
      clearRally: c.rally && erasable(l.mission.rally.length, left?.rally),
    }
  })
}

/** Waiting / writing as text; done and failed with a Lucide mark (spec 20 §9: no text glyphs). */
function phaseText(s: BatchState | undefined, dict: Dict): ReactNode {
  if (!s) return null
  if (s.phase === 'waiting') return dict.bfWaiting
  if (s.phase === 'writing') return dict.bfWriting
  const [icon, text] = s.phase === 'done' ? [<IconCheck size={14} />, dict.bfDone] : [<IconError size={14} />, reasonText(s.reason, dict)]
  return (
    <span className="row" style={{ gap: 4 }}>
      {icon}
      {text}
    </span>
  )
}

interface ChoiceProps {
  readonly text: string
  readonly erase: boolean
  readonly disabled: boolean
  readonly dict: Dict
  readonly onChange: (erase: boolean) => void
}

/** 前のフェンス N 区画が残っています + 消す / 残す. */
function Choice({ text, erase, disabled, dict, onChange }: ChoiceProps) {
  return (
    <div className="row brief-left">
      <span className="hint caution grow">{text}</span>
      <div className="seg sm" role="group" aria-label={text}>
        <span className="lens" style={{ transform: `translateX(${erase ? 0 : 100}%)` }} />
        <button type="button" className={erase ? 'on' : ''} disabled={disabled} onClick={() => onChange(true)}>
          {dict.bfErase}
        </button>
        <button type="button" className={erase ? '' : 'on'} disabled={disabled} onClick={() => onChange(false)}>
          {dict.bfKeep}
        </button>
      </div>
    </div>
  )
}

interface LeftProps {
  readonly own: number
  readonly left: number | null | undefined
  readonly texts: readonly [string, string]
  readonly erase: boolean
  readonly disabled: boolean
  readonly dict: Dict
  readonly onChange: (erase: boolean) => void
}

/** Nothing when the mission brings its own (or nothing is left); 不明 when the read failed. */
function LeftoverLine({ own, left, texts, ...rest }: LeftProps) {
  if (own > 0 || left === undefined || left === 0) return null
  if (left === null) return <div className="t3 brief-left">{texts[1]}</div>
  return <Choice text={texts[0].replace('{n}', String(left))} {...rest} />
}

export function BatchWriteSheet({ lines, leftovers, states, running, dict, onWrite, onClose }: Props) {
  const [clear, setClear] = useState<ReadonlyMap<string, Clear>>(new Map())
  const started = running || states.size > 0
  const choose = (key: string, patch: Partial<Clear>) => setClear((m) => new Map([...m, [key, { ...(m.get(key) ?? KEEP), ...patch }]]))
  return (
    <aside className="g-strong sheet up-sheet brief-sheet" aria-label={dict.bfWriteAll} role="dialog">
      <div className="panel-h">
        <span className="h1">{dict.bfWriteAll}</span>
        <span className="grow" />
        <button type="button" className="btn-icon" aria-label={dict.close} disabled={running} onClick={onClose}>
          <IconClose />
        </button>
      </div>
      {leftovers === null && <div className="t3 brief-reading">{dict.bfReading}</div>}
      <ul className="brief-sheet-list">
        {lines.map((l) => {
          const left = leftovers?.get(l.sysid)
          const c = clear.get(l.key) ?? KEEP
          const phase = phaseText(states.get(l.key), dict)
          return (
            <li key={l.key} className="brief-sheet-row">
              <div className="row" style={{ gap: 8 }}>
                <span className="brief-dot" style={{ background: l.color }} aria-hidden="true" />
                <span className="brief-sheet-name">{`${l.name} → ${l.vehicle}`}</span>
                <span className="grow" />
                <span className="num t2">{km(l.distanceM)}</span>
              </div>
              <LeftoverLine own={l.mission.fence.length} left={left?.fence} texts={[dict.bfLeftFence, dict.bfLeftFenceUnknown]} erase={c.fence} disabled={started} dict={dict} onChange={(fence) => choose(l.key, { fence })} />
              <LeftoverLine own={l.mission.rally.length} left={left?.rally} texts={[dict.bfLeftRally, dict.bfLeftRallyUnknown]} erase={c.rally} disabled={started} dict={dict} onChange={(rally) => choose(l.key, { rally })} />
              {phase !== null && <div className={`brief-phase ${states.get(l.key)?.phase ?? ''}`}>{phase}</div>}
            </li>
          )
        })}
      </ul>
      <div className="up-foot" style={{ gap: 8 }}>
        <button type="button" className="btn" disabled={running} onClick={onClose}>
          {started ? dict.bfClose : dict.bfCancel}
        </button>
        {!started && (
          <button type="button" className="btn btn-primary" disabled={leftovers === null} onClick={() => onWrite(toJobs(lines, leftovers, clear))}>
            {dict.bfWrite}
          </button>
        )}
      </div>
    </aside>
  )
}

/** One sheet per session: a re-open starts with every choice back at 残す. */
export function BatchSheetView({ sheet, ...rest }: { readonly sheet: BatchSheet } & Pick<Props, 'dict' | 'onWrite' | 'onClose'>) {
  const { session, ...props } = sheet
  return <BatchWriteSheet key={session} {...props} {...rest} />
}
