import { useRef, useState, type DragEvent } from 'react'
import type { VehicleKind } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { CMDS, mavFontSize } from './cmds'
import { haversineM, hasPosition } from './geo'
import { itemSummary, km, wpLabel } from './labels'
import { badgeText } from './mapEdit'
import { cmdKey, type DraftItem } from './model'

interface Props {
  readonly items: readonly DraftItem[]
  readonly selected: ReadonlySet<number>
  readonly kind: VehicleKind | null
  readonly dict: Dict
  readonly onSelect: (uid: number, additive: boolean, range: boolean) => void
  readonly onReorder: (uid: number, dir: -1 | 1) => void
  /** Drag & drop: move these items to the slot before index `before`. */
  readonly onMove: (uids: ReadonlySet<number>, before: number) => void
  readonly onContext: (uid: number, x: number, y: number) => void
}

/** Metres from the previous positioned item (0 for the first and for non-positioned items). */
function legDistances(items: readonly DraftItem[]): readonly number[] {
  const out: number[] = []
  let prev: DraftItem | null = null
  for (const it of items) {
    if (!hasPosition(it) || it.command === 201) {
      out.push(0)
      continue
    }
    out.push(prev ? haversineM(prev.lat, prev.lon, it.lat, it.lon) : 0)
    prev = it
  }
  return out
}

/** The slot a drop over row `i` means: before it in the upper half, after it in the lower. */
function slotAt(e: DragEvent<HTMLElement>, i: number): number {
  const r = e.currentTarget.getBoundingClientRect()
  return e.clientY < r.top + r.height / 2 ? i : i + 1
}

/** Prototype `.wrow` list: badge, Japanese command name + MAV id, summary line, ▲▼. */
export function MissionList({ items, selected, kind, dict, onSelect, onReorder, onMove, onContext }: Props) {
  const legs = legDistances(items)
  const dragging = useRef<ReadonlySet<number> | null>(null)
  const [slot, setSlot] = useState<number | null>(null)
  const end = () => {
    dragging.current = null
    setSlot(null)
  }
  if (items.length === 0) return <div className="t3 wp-empty">{dict.mNoWp}</div>
  return (
    <div className="wp-list" role="listbox" aria-label={dict.mWaypoints}>
      {items.map((it, i) => {
        const key = cmdKey(it)
        const spec = CMDS[key]
        const pos = spec?.pos === true
        const roi = key === 'DO_SET_ROI'
        const sel = selected.has(it.uid)
        const sub = `${legs[i]! > 0 ? `${km(legs[i]!)} · ` : ''}${itemSummary(it, kind, dict) || '—'}`
        return (
          <div
            key={it.uid}
            className={`wrow${sel ? ' sel' : ''}${slot === i ? ' drop-before' : ''}${slot === items.length && i === items.length - 1 ? ' drop-after' : ''}`}
            draggable
            onDragStart={(e) => {
              dragging.current = sel ? selected : new Set([it.uid])
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('text/plain', String(it.uid))
            }}
            onDragOver={(e) => {
              if (!dragging.current) return
              e.preventDefault()
              const next = slotAt(e, i)
              // "after row i" and "before row i + 1" are one slot: mark it on the lower row
              if (next !== slot) setSlot(next)
            }}
            onDrop={(e) => {
              e.preventDefault()
              if (dragging.current) onMove(dragging.current, slotAt(e, i))
              end()
            }}
            onDragEnd={end}
            role="option"
            aria-selected={sel}
            style={{ paddingLeft: pos ? 12 : 28 }}
            onClick={(e) => onSelect(it.uid, e.metaKey || e.ctrlKey, e.shiftKey)}
            onContextMenu={(e) => {
              e.preventDefault()
              onContext(it.uid, e.clientX, e.clientY)
            }}
          >
            <span className={`wbadge${sel ? ' sel' : pos ? ' pos' : ''}${roi ? ' roi' : key === 'RTL' ? ' rtl' : ''}`} style={{ borderRadius: pos ? '50%' : 6 }}>
              {badgeText(i + 1, key)}
            </span>
            <div style={{ minWidth: 0 }}>
              <div className="row" style={{ alignItems: 'baseline', gap: 8 }}>
                <span className="ell cmd-label">{wpLabel(key, dict)}</span>
                <span className="mono t3 mav" title={`${spec?.mav ?? key} (#${it.command})`} style={{ flex: 'none', fontSize: mavFontSize(spec?.mav ?? key), lineHeight: 1 }}>
                  {spec?.mav ?? `#${it.command}`}
                </span>
              </div>
              <div className="t3 num ell sub" style={{ fontSize: 11 }}>
                {sub}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <button type="button" className="updown" aria-label={dict.mUp} disabled={i === 0} onClick={(e) => (e.stopPropagation(), onReorder(it.uid, -1))}>
                ▲
              </button>
              <button type="button" className="updown" aria-label={dict.mDown} disabled={i === items.length - 1} onClick={(e) => (e.stopPropagation(), onReorder(it.uid, 1))}>
                ▼
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
