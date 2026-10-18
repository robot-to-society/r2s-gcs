import type { MissionFrame } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { CMDS, FRAMES, mavFontSize } from './cmds'
import { cmdKey, type DraftItem } from './model'

interface Props {
  readonly items: readonly DraftItem[]
  readonly selected: ReadonlySet<number>
  readonly dict: Dict
  readonly onSelect: (uid: number, additive: boolean, range: boolean) => void
  readonly onReorder: (uid: number, dir: -1 | 1) => void
}

const chip = (alt: number, frame: MissionFrame) => `${Math.round(alt)} m ${FRAMES[frame].short}`

export function MissionList({ items, selected, dict, onSelect, onReorder }: Props) {
  return (
    <ul className="wp-list" aria-label={dict.mWaypoints}>
      {items.map((it, i) => {
        const key = cmdKey(it)
        const spec = CMDS[key]
        return (
          <li
            key={it.uid}
            className={`wp-row${selected.has(it.uid) ? ' sel' : ''}`}
            onClick={(e) => onSelect(it.uid, e.shiftKey, e.metaKey || e.ctrlKey)}
            aria-selected={selected.has(it.uid)}
          >
            <span className="badge num">{i + 1}</span>
            <span className="cmd">
              <span className="key">{key}</span>
              <span className="mav" style={{ fontSize: mavFontSize(spec?.mav ?? key) }}>
                {spec?.mav ?? `#${it.command}`}
              </span>
            </span>
            {spec?.alt ? <span className="chip">{chip(it.alt, it.frame)}</span> : <span />}
            <span className="reorder">
              <button
                type="button"
                aria-label={dict.mUp}
                disabled={i === 0}
                onClick={(e) => {
                  e.stopPropagation()
                  onReorder(it.uid, -1)
                }}
              >
                ▲
              </button>
              <button
                type="button"
                aria-label={dict.mDown}
                disabled={i === items.length - 1}
                onClick={(e) => {
                  e.stopPropagation()
                  onReorder(it.uid, 1)
                }}
              >
                ▼
              </button>
            </span>
          </li>
        )
      })}
    </ul>
  )
}
