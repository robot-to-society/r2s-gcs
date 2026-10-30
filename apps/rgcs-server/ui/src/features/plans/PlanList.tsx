// The open plans list at the top of the planner's left panel: one compact row per open mission
// (colour chip, name, unsaved mark, assigned vehicle, ↑ / ↓, remove). Spec 2026-10-20 §5.1 / §5.5.
import { useEffect, useRef, useState } from 'react'
import type { VehicleState } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { IconChevronDown, IconChevronUp, IconClose, IconEye, IconEyeOff } from '../../shared/ui/icons'
import { PALETTE, type Row, type Workspace } from './model'

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
  /** Double-click on the row (not its controls): frame that row's mission on the map. */
  readonly onFrame?: (key: string) => void
}

type RowProps = Omit<Props, 'workspace' | 'liveDirty' | 'busy'> & {
  readonly row: Row
  readonly active: boolean
  readonly dirty: boolean
  readonly first: boolean
  readonly last: boolean
  readonly locked: boolean
}

const stop = (e: React.SyntheticEvent) => e.stopPropagation()

export function PlanList({ workspace, liveDirty, busy = false, ...rest }: Props) {
  const n = workspace.rows.length
  return (
    <>
      <div className="plans-list hair" role="list" aria-label={rest.dict.plList}>
        {workspace.rows.map((row, i) => {
          const active = row.key === workspace.active
          return <OpenPlanRow key={row.key} {...rest} row={row} active={active} dirty={active ? liveDirty : row.ui.dirty} first={i === 0} last={i === n - 1} locked={active && busy} />
        })}
      </div>
    </>
  )
}

function OpenPlanRow({ row, active, dirty, first, last, locked, vehicles, dict, onSwitch, onAssign, onRemove, onMove, onColor, onHidden, onFrame }: RowProps) {
  const [palette, setPalette] = useState(false)
  const shown = !row.hidden
  const known = row.sysid === null || vehicles.some((v) => v.sysid === row.sysid)
  return (
    <div className={`plans-row${active ? ' on' : ''}`} role="listitem" aria-current={active ? 'true' : undefined} onClick={() => !active && onSwitch(row.key)} onDoubleClick={() => onFrame?.(row.key)}>
      <span className="plans-chip-wrap" onClick={stop} onDoubleClick={stop}>
        <button type="button" className="plans-chip" aria-label={dict.plColor} style={{ background: row.color }} onClick={() => setPalette((p) => !p)} />
        {palette && <ColorPopover current={row.color} dict={dict} onPick={(c) => onColor(row.key, c)} onClose={() => setPalette(false)} />}
      </span>
      <span className="plans-name" title={`${row.ui.history.present.mission.name}\n${dict.plFrameHint}`}>
        {row.ui.history.present.mission.name}
      </span>
      {dirty && (
        <span className="plans-dirty" title={dict.plUnsaved} aria-label={dict.plUnsaved}>
          ●
        </span>
      )}
      {row.missing && <span className="rg-natag plans-missing">{dict.plMissing}</span>}
      <select className="rg-sel plans-sel" aria-label={dict.plVehicle} value={row.sysid ?? ''} onClick={stop} onDoubleClick={stop} onChange={(e) => onAssign(row.key, e.target.value === '' ? null : Number(e.target.value))}>
        <option value="">{dict.plUnassigned}</option>
        {vehicles.map((v) => (
          <option key={v.sysid} value={v.sysid}>
            {v.name}
          </option>
        ))}
        {!known && <option value={row.sysid ?? ''}>{`#${row.sysid}`}</option>}
      </select>
      <span className="plans-ctl" onClick={stop} onDoubleClick={stop}>
        <button type="button" className="btn-icon sm" aria-label={dict.plShow} title={dict.plShow} aria-pressed={shown} disabled={active} onClick={() => onHidden(row.key, shown)}>
          {shown ? <IconEye /> : <IconEyeOff />}
        </button>
        <button type="button" className="btn-icon sm" aria-label={dict.plUp} title={dict.plUp} disabled={first} onClick={() => onMove(row.key, -1)}>
          <IconChevronUp size={14} />
        </button>
        <button type="button" className="btn-icon sm" aria-label={dict.plDown} title={dict.plDown} disabled={last} onClick={() => onMove(row.key, 1)}>
          <IconChevronDown size={14} />
        </button>
        <button type="button" className="btn-icon sm" aria-label={dict.plRemove} title={dict.plRemove} disabled={locked} onClick={() => onRemove(row.key)}>
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
    <div ref={ref} className="g-strong plans-pop" role="dialog" aria-label={dict.plColor}>
      {PALETTE.map((c) => (
        <button
          key={c}
          type="button"
          className={`plans-swatch${c === current ? ' on' : ''}`}
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
