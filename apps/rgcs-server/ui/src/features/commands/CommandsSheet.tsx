import { useState, type ReactElement, type ReactNode } from 'react'
import type { VehicleCommand, VehicleState } from '../../shared/api/types'
import { cmdLabel, type Dict } from '../../shared/i18n'
import {
  IconAltitude,
  IconCamera,
  IconClose,
  IconCrosshair,
  IconEllipsis,
  IconHouse,
  IconLand,
  IconPause,
  IconPlay,
  IconPower,
  IconPowerOff,
  IconRepeat,
  IconSearch,
  IconSpeed,
  IconStepForward,
} from '../../shared/ui/icons'
import { CATALOG, COPTER_MODES, catalogGroups, type CatalogItem, type CommandGroup, type ModalTarget } from './catalog'

interface Props {
  readonly vehicle: VehicleState
  readonly onPick: (command: VehicleCommand) => void
  readonly onOpen: (target: ModalTarget) => void
  readonly onClose: () => void
  readonly dict: Dict
  /** Rendered beside the detail panel (prototype `map-r top2`) when it is open. */
  readonly beside?: boolean
  /** Shown under the commands (the dock's sending / last-result line). */
  readonly footer?: ReactNode
}

const GROUP_LABEL: Record<CommandGroup, keyof Dict> = { flight: 'groupFlight', move: 'groupMove', mode: 'groupMode', payload: 'groupPayload' }
/** Lucide icon per command name (spec 20 §9). */
const ICON: Record<string, () => ReactElement> = {
  pause: () => <IconPause />,
  resume: () => <IconPlay />,
  rtl: () => <IconHouse size={18} />,
  land: () => <IconLand />,
  guided: () => <IconCrosshair />,
  change_alt: () => <IconAltitude />,
  change_speed: () => <IconSpeed size={18} />,
  set_mode: () => <IconRepeat />,
  mission_start: () => <IconPlay />,
  mission_resume: () => <IconStepForward />,
  arm: () => <IconPower />,
  disarm: () => <IconPowerOff />,
  camera: () => <IconCamera />,
  other: () => <IconEllipsis />,
}

function label(item: CatalogItem, dict: Dict): string {
  return item.name === 'camera' ? dict.cmd_camera : cmdLabel(item.name, dict)
}

/** Right-aligned 380 px sheet listing every command by group in a 2-column grid (spec 10 §3.5). */
export function CommandsSheet({ vehicle, onPick, onOpen, onClose, dict, beside = false, footer }: Props) {
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState(vehicle.mode || COPTER_MODES[0]!)
  const [alt, setAlt] = useState('')
  const [speed, setSpeed] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const q = query.trim().toLowerCase()
  const shown = CATALOG.filter((i) => q === '' || label(i, dict).toLowerCase().includes(q) || i.name.includes(q))

  const pick = (item: CatalogItem) => {
    if (item.opens) return onOpen(item.opens)
    if (item.param && open !== item.name) return setOpen(item.name)
    const raw = item.param === 'alt' ? alt : item.param === 'speed' ? speed : ''
    const value = raw === '' ? undefined : Number(raw)
    const command = item.build?.({ mode, value }) ?? null
    if (command) {
      setOpen(null)
      onPick(command)
    }
  }

  const paramRow = (item: CatalogItem) => (
    <div className="cmd-param" key={`${item.name}-param`}>
      {item.param === 'mode' && (
        <select className="rg-sel" aria-label={label(item, dict)} value={mode} onChange={(e) => setMode(e.target.value)}>
          {COPTER_MODES.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
      )}
      {item.param === 'alt' && <input className="rg-num" aria-label={label(item, dict)} placeholder={dict.altInput} value={alt} onChange={(e) => setAlt(e.target.value)} />}
      {item.param === 'speed' && <input className="rg-num" aria-label={label(item, dict)} placeholder={dict.speedInput} value={speed} onChange={(e) => setSpeed(e.target.value)} />}
      <button type="button" className="btn btn-primary btn-sm" onClick={() => pick(item)}>
        {dict.run}
      </button>
    </div>
  )

  return (
    <aside className={`g-strong panel sheet${beside ? ' beside' : ''}`} aria-label={dict.allCommands}>
      <div className="panel-h">
        <span className="h1">{vehicle.name}</span>
        <span className="h1 t2" style={{ fontWeight: 300 }}>
          {dict.allCommands}
        </span>
        <div className="grow" />
        <button type="button" className="btn-icon" aria-label={dict.close} title={dict.close} onClick={onClose}>
          <IconClose />
        </button>
      </div>
      <div className="sheet-search">
        <div className="in">
          <IconSearch />
          <input className="in bare grow" placeholder={dict.searchCommands} value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>
      <div className="sheet-body">
        {catalogGroups(shown).map(({ group, items }) => (
          <div key={group}>
            <div className="cmd-group-title">{dict[GROUP_LABEL[group]]}</div>
            <div className="cmd-grid">
              {items.map((item) => (
                <>
                  <button
                    key={item.name}
                    type="button"
                    className={`cmd-btn${item.name === 'guided' ? ' full' : ''}${open === item.name ? ' on' : ''}`}
                    disabled={!item.enabled(vehicle)}
                    onClick={() => pick(item)}
                  >
                    <span className="glyph" aria-hidden="true">
                      {(ICON[item.name] ?? ICON.other)()}
                    </span>
                    <span className="ell">{label(item, dict)}</span>
                  </button>
                  {open === item.name && item.param && paramRow(item)}
                </>
              ))}
            </div>
          </div>
        ))}
      </div>
      {footer}
    </aside>
  )
}
