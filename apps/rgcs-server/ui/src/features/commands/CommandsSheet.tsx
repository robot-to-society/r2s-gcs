import { useState } from 'react'
import type { VehicleCommand, VehicleState } from '../../shared/api/types'
import { cmdLabel, type Dict } from '../../shared/i18n'
import { CATALOG, COPTER_MODES, catalogGroups, type CatalogItem, type CommandGroup, type ModalTarget } from './catalog'

interface Props {
  readonly vehicle: VehicleState
  readonly onPick: (command: VehicleCommand) => void
  readonly onOpen: (target: ModalTarget) => void
  readonly onClose: () => void
  readonly dict: Dict
}

const GROUP_LABEL: Record<CommandGroup, keyof Dict> = { flight: 'groupFlight', move: 'groupMove', mode: 'groupMode', payload: 'groupPayload' }

function label(item: CatalogItem, dict: Dict): string {
  return item.name === 'camera' ? dict.cmd_camera : cmdLabel(item.name, dict)
}

/** Right-aligned 380 px sheet listing every command by group (spec 10 §3.5). */
export function CommandsSheet({ vehicle, onPick, onOpen, onClose, dict }: Props) {
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState(vehicle.mode || COPTER_MODES[0]!)
  const [alt, setAlt] = useState('')
  const [speed, setSpeed] = useState('')
  const q = query.trim().toLowerCase()
  const shown = CATALOG.filter((i) => q === '' || label(i, dict).toLowerCase().includes(q) || i.name.includes(q))

  const pick = (item: CatalogItem) => {
    if (item.opens) return onOpen(item.opens)
    const value = item.param === 'alt' ? Number(alt) : item.param === 'speed' ? Number(speed) : undefined
    const command = item.build?.({ mode, value: item.param && value !== undefined && (alt !== '' || speed !== '') ? value : undefined }) ?? null
    if (command) onPick(command)
  }

  return (
    <aside className="g-strong sheet" aria-label={dict.allCommands}>
      <div className="panel-h">
        <span className="h1">{dict.allCommands}</span>
        <span className="t2">{vehicle.name}</span>
        <span className="grow" />
        <button type="button" className="btn-icon" aria-label={dict.close} onClick={onClose}>
          ×
        </button>
      </div>
      <div className="vlist-search">
        <input className="in" placeholder={dict.searchCommands} value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="sheet-body">
        {catalogGroups(shown).map(({ group, items }) => (
          <section key={group} className="sec">
            <div className="sec-title">{dict[GROUP_LABEL[group]]}</div>
            <div className="cmd-grid">
              {items.map((item) => (
                <div key={item.name} className="cmd-row">
                  {item.param === 'mode' && (
                    <select className="rg-sel" aria-label={label(item, dict)} value={mode} onChange={(e) => setMode(e.target.value)}>
                      {COPTER_MODES.map((m) => (
                        <option key={m}>{m}</option>
                      ))}
                    </select>
                  )}
                  {item.param === 'alt' && (
                    <input className="rg-num" aria-label={label(item, dict)} placeholder={dict.altInput} value={alt} onChange={(e) => setAlt(e.target.value)} />
                  )}
                  {item.param === 'speed' && (
                    <input className="rg-num" aria-label={label(item, dict)} placeholder={dict.speedInput} value={speed} onChange={(e) => setSpeed(e.target.value)} />
                  )}
                  <button type="button" className="cmd-btn" disabled={!item.enabled(vehicle)} onClick={() => pick(item)}>
                    {label(item, dict)}
                  </button>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </aside>
  )
}
