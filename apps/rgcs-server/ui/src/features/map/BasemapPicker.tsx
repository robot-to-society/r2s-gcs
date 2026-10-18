import { useState } from 'react'
import type { Basemap } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { IconCheck, IconLayers } from '../../shared/ui/icons'

interface Props {
  readonly basemaps: readonly Basemap[]
  readonly current: string
  readonly dict: Dict
  readonly onPick: (id: string) => void
  /** Placement classes (prototype `float map-r top1|top2`). */
  readonly className?: string
}

/** Map type button + menu (top right of the visible map, under the 2D / 3D control). */
export function BasemapPicker({ basemaps, current, dict, onPick, className = 'float map-r top1' }: Props) {
  const [open, setOpen] = useState(false)
  return (
    <div className={`basemap-picker ${className}`}>
      <button type="button" className="g-ctl btn-icon" aria-label={dict.basemap} title={dict.basemap} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <IconLayers />
      </button>
      {open && (
        <div className="g-strong basemap-menu" role="menu" aria-label={dict.basemap}>
          {basemaps.map((b) => (
            <button
              key={b.id}
              type="button"
              role="menuitemradio"
              aria-checked={b.id === current}
              className={b.id === current ? 'on' : ''}
              onClick={() => {
                setOpen(false)
                onPick(b.id)
              }}
            >
              <span className="grow">{b.label}</span>
              {b.id === current && <IconCheck size={16} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
