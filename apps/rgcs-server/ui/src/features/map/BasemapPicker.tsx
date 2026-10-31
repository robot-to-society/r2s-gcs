import { useRef, useState } from 'react'
import type { Basemap } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { IconCheck, IconLayers } from '../../shared/ui/icons'
import { LteAreasSheet, LteMenuSection, type LteMapKey } from '../lte'
import { useDismiss } from './useDismiss'

interface Props {
  readonly basemaps: readonly Basemap[]
  readonly current: string
  readonly dict: Dict
  readonly onPick: (id: string) => void
  /** Placement classes (prototype `float map-r top1|top2`). */
  readonly className?: string
  /** The map this menu sits on: adds the 「オーバーレイ」 section (docomo LTE area). */
  readonly lte?: LteMapKey
}

/** Map type button + menu (top right of the visible map, under the 2D / 3D control). */
export function BasemapPicker({ basemaps, current, dict, onPick, className = 'float map-r top1', lte }: Props) {
  const [open, setOpen] = useState(false)
  const [sheet, setSheet] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useDismiss(open, box, () => setOpen(false))
  return (
    <div ref={box} className={`basemap-picker ${className}`}>
      <button type="button" className="g-ctl btn-icon" aria-label={dict.basemap} title={dict.basemap} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <IconLayers />
      </button>
      {open && (
        <div className="g-strong basemap-menu" role="menu" aria-label={dict.basemap}>
          {basemaps.length > 1 &&
            basemaps.map((b) => (
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
          {lte && (
            <LteMenuSection
              dict={dict}
              onManage={() => {
                setOpen(false)
                setSheet(true)
              }}
            />
          )}
        </div>
      )}
      {lte && sheet && <LteAreasSheet dict={dict} mapKey={lte} onClose={() => setSheet(false)} />}
    </div>
  )
}
