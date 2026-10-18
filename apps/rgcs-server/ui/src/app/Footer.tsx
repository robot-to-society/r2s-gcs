import type { CommandResult } from '../shared/api/types'
import { hhmm } from '../shared/format/time'
import { cmdLabel, type Dict } from '../shared/i18n'

interface Props {
  readonly results: readonly CommandResult[]
  readonly dict: Dict
  readonly clock: string
  readonly deadmanLost?: boolean
}

const SHOWN = 2

/** Bottom-centre log bar (spec 10 §1, prototype footer): "全体", the two newest results, the clock. */
export function Footer({ results, dict, clock, deadmanLost = false }: Props) {
  return (
    <footer className="g-ctl footer-log">
      <span className="lead" data-testid="pill">
        {dict.all}
      </span>
      {results.slice(0, SHOWN).map((r) => (
        <span key={r.id} className={`row ell entry${r.ok ? '' : ' danger'}`} data-testid="pill" title={r.reason ?? undefined}>
          <span className={`glyph${r.ok ? '' : ' bad'}`} data-glyph={r.ok ? 'i' : '!'} aria-hidden="true" />
          <span className="num t2">{hhmm(r.ts)}</span>
          <span className="ell">
            {' '}
            {cmdLabel(r.cmd, dict)} {r.ok ? dict.ok : dict.failed}
          </span>
        </span>
      ))}
      {deadmanLost && (
        <span className="row entry danger" data-testid="pill">
          <span className="glyph bad" data-glyph="!" aria-hidden="true" />
          <span className="ell">{dict.joystickLost}</span>
        </span>
      )}
      {clock && <span className="num t3 footer-clock">{clock}</span>}
    </footer>
  )
}
