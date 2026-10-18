import type { Dict } from '../../shared/i18n'
import { IconClose } from '../../shared/ui/icons'
import { CMDS, PALETTE } from './cmds'
import { wpLabel } from './labels'

interface Props {
  readonly where: string
  readonly dict: Dict
  readonly onInsert: (key: string) => void
  readonly onClose: () => void
}

const GROUPS = [
  { key: 'pos', label: 'mPalPos', color: 'var(--accent)', radius: '50%' },
  { key: 'do', label: 'mPalDo', color: 'rgba(255,255,255,.25)', radius: '4px' },
  { key: 'cond', label: 'mPalCond', color: 'rgba(255,255,255,.25)', radius: '4px' },
] as const

/** Prototype "コマンドを挿入" palette: drops over the list, three groups, 2-column buttons. */
export function CommandPalette({ where, dict, onInsert, onClose }: Props) {
  return (
    <div className="g-strong cmd-palette" role="dialog" aria-label={dict.mInsertCmd}>
      <div className="row hair" style={{ padding: '10px 14px' }}>
        <span className="h2">{dict.mInsertCmd}</span>
        <span className="t3" style={{ fontSize: 12, marginLeft: 10 }}>
          {where}
        </span>
        <div className="grow" />
        <button type="button" className="btn-icon sm" aria-label={dict.close} onClick={onClose}>
          <IconClose size={16} />
        </button>
      </div>
      <div className="cmd-palette-body">
        {GROUPS.map((g) => (
          <div key={g.key}>
            <div className="t3" style={{ fontSize: 12, padding: '4px 4px 6px' }}>
              {dict[g.label]}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {PALETTE[g.key].map((k) => (
                <button key={k} type="button" className="cmd-btn pal" title={CMDS[k]?.mav} onClick={() => onInsert(k)}>
                  <span style={{ width: 16, height: 16, borderRadius: g.radius, background: k === 'DO_SET_ROI' ? 'var(--ok)' : g.color, flex: 'none' }} />
                  <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span className="ell">{wpLabel(k, dict)}</span>
                    <span className="mono t4 ell" style={{ fontSize: 9 }}>
                      {(CMDS[k]?.mav ?? '').replace('MAV_CMD_', '')}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
