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

/** Prototype `.wrow` list: badge, Japanese command name + MAV id, summary line, ▲▼. */
export function MissionList({ items, selected, kind, dict, onSelect, onReorder, onContext }: Props) {
  const legs = legDistances(items)
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
            className={`wrow${sel ? ' sel' : ''}`}
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
