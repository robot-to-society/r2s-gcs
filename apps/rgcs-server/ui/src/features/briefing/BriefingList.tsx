// The briefing list at the top of the planner's left panel: one compact row per open mission
// (colour chip, name, unsaved mark, assigned vehicle, ↑ / ↓, remove). Spec 2026-10-20 §5.1 / §5.5.
import { useEffect, useRef, useState } from 'react'
import type { VehicleState } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { IconChevronDown, IconChevronUp, IconClose, IconEye, IconEyeOff } from '../../shared/ui/icons'
import { PALETTE, type Row, type Workspace } from './model'
import { NAME_MAX } from './persistence'

interface Props {
  readonly workspace: Workspace
  readonly liveDirty: boolean
  /** The live editor is saving / writing / reading: its row cannot be removed meanwhile. */
  readonly busy?: boolean
  readonly vehicles: readonly VehicleState[]
  readonly dict: Dict
  readonly onSwitch: (key: string) => void
  readonly onAssign: (key: string, sysid: number | null) => void
  readonly onRemove: (key: string) => void
  readonly onMove: (key: string, delta: -1 | 1) => void
  readonly onColor: (key: string, color: string) => void
  readonly onHidden: (key: string, hidden: boolean) => void
  /** The briefing's name and its save / open buttons (absent: the list alone). */
  readonly header?: BriefingHeader
}

export interface BriefingHeader {
  readonly name: string
  /** A valid name and nothing running. */
  readonly canSave: boolean
  /** A save / open is running. */
  readonly busy: boolean
  readonly onName: (name: string) => void
  readonly onSave: () => void
  readonly onOpen: () => void
}

type RowProps = Omit<Props, 'workspace' | 'liveDirty' | 'busy' | 'header'> & {
  readonly row: Row
  readonly active: boolean
  readonly dirty: boolean
  readonly first: boolean
  readonly last: boolean
  readonly locked: boolean
}

const stop = (e: React.SyntheticEvent) => e.stopPropagation()

export function BriefingList({ workspace, liveDirty, busy = false, header, ...rest }: Props) {
  const n = workspace.rows.length
  return (
    <>
      {header && <Header {...header} dict={rest.dict} />}
      <div className="brief-list hair" role="list" aria-label={rest.dict.bfList}>
        {workspace.rows.map((row, i) => {
          const active = row.key === workspace.active
          return <BriefRow key={row.key} {...rest} row={row} active={active} dirty={active ? liveDirty : row.ui.dirty} first={i === 0} last={i === n - 1} locked={active && busy} />
        })}
      </div>
    </>
  )
}

function Header({ name, canSave, busy, onName, onSave, onOpen, dict }: BriefingHeader & { readonly dict: Dict }) {
  return (
    <div className="brief-head">
      <input className="in brief-head-name" aria-label={dict.bfName} placeholder={dict.bfName} maxLength={NAME_MAX} value={name} onChange={(e) => onName(e.target.value)} />
      <div className="brief-head-btns">
        <button type="button" className="btn sm" title={canSave ? dict.bfSave : dict.bfNameHint} disabled={!canSave} onClick={onSave}>
          {dict.bfSave}
        </button>
        <button type="button" className="btn sm" disabled={busy} onClick={onOpen}>
          {dict.bfOpen}
        </button>
      </div>
    </div>
  )
}

function BriefRow({ row, active, dirty, first, last, locked, vehicles, dict, onSwitch, onAssign, onRemove, onMove, onColor, onHidden }: RowProps) {
  const [palette, setPalette] = useState(false)
  const shown = !row.hidden
  const known = row.sysid === null || vehicles.some((v) => v.sysid === row.sysid)
  return (
    <div className={`brief-row${active ? ' on' : ''}`} role="listitem" aria-current={active ? 'true' : undefined} onClick={() => !active && onSwitch(row.key)}>
      <span className="brief-chip-wrap" onClick={stop}>
        <button type="button" className="brief-chip" aria-label={dict.bfColor} style={{ background: row.color }} onClick={() => setPalette((p) => !p)} />
        {palette && <ColorPopover current={row.color} dict={dict} onPick={(c) => onColor(row.key, c)} onClose={() => setPalette(false)} />}
      </span>
      <span className="brief-name" title={row.ui.history.present.mission.name}>
        {row.ui.history.present.mission.name}
      </span>
      {dirty && (
        <span className="brief-dirty" title={dict.bfUnsaved} aria-label={dict.bfUnsaved}>
          ●
        </span>
      )}
      {row.missing && <span className="rg-natag brief-missing">{dict.bfMissing}</span>}
      <select className="rg-sel brief-sel" aria-label={dict.bfVehicle} value={row.sysid ?? ''} onClick={stop} onChange={(e) => onAssign(row.key, e.target.value === '' ? null : Number(e.target.value))}>
        <option value="">{dict.bfUnassigned}</option>
        {vehicles.map((v) => (
          <option key={v.sysid} value={v.sysid}>
            {v.name}
          </option>
        ))}
        {!known && <option value={row.sysid ?? ''}>{`#${row.sysid}`}</option>}
      </select>
      <span className="brief-ctl" onClick={stop}>
        <button type="button" className="btn-icon sm" aria-label={dict.bfShow} title={dict.bfShow} aria-pressed={shown} disabled={active} onClick={() => onHidden(row.key, shown)}>
          {shown ? <IconEye /> : <IconEyeOff />}
        </button>
        <button type="button" className="btn-icon sm" aria-label={dict.bfUp} title={dict.bfUp} disabled={first} onClick={() => onMove(row.key, -1)}>
          <IconChevronUp size={14} />
        </button>
        <button type="button" className="btn-icon sm" aria-label={dict.bfDown} title={dict.bfDown} disabled={last} onClick={() => onMove(row.key, 1)}>
          <IconChevronDown size={14} />
        </button>
        <button type="button" className="btn-icon sm" aria-label={dict.bfRemove} title={dict.bfRemove} disabled={locked} onClick={() => onRemove(row.key)}>
          <IconClose size={14} />
        </button>
      </span>
    </div>
  )
}

interface PopoverProps {
  readonly current: string
  readonly dict: Dict
  readonly onPick: (color: string) => void
  readonly onClose: () => void
}

/** The 8 palette swatches; a press anywhere outside closes it. */
function ColorPopover({ current, dict, onPick, onClose }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) onClose()
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [onClose])
  return (
    <div ref={ref} className="g-strong brief-pop" role="dialog" aria-label={dict.bfColor}>
      {PALETTE.map((c) => (
        <button
          key={c}
          type="button"
          className={`brief-swatch${c === current ? ' on' : ''}`}
          aria-label={c}
          style={{ background: c }}
          onClick={() => {
            onPick(c)
            onClose()
          }}
        />
      ))}
    </div>
  )
}
