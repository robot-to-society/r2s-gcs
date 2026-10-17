import type { CommandResult } from '../shared/api/types'
import { hhmm } from '../shared/format/time'
import { cmdLabel, type Dict } from '../shared/i18n'

interface Props {
  readonly results: readonly CommandResult[]
  readonly dict: Dict
  readonly clock: string
}

const SHOWN = 2

/** Bottom-centre log pills: "all", the two newest command results, the clock (spec 10 §1). */
export function Footer({ results, dict, clock }: Props) {
  return (
    <footer className="footer-log">
      <span className="g pill" data-testid="pill">
        {dict.all}
      </span>
      {results.slice(0, SHOWN).map((r) => (
        <span key={r.id} className={`g pill${r.ok ? '' : ' danger'}`} data-testid="pill" title={r.reason ?? undefined}>
          {hhmm(r.ts)} {cmdLabel(r.cmd, dict)} {r.ok ? dict.ok : dict.failed}
        </span>
      ))}
      {clock && <span className="num t2 footer-clock">{clock}</span>}
    </footer>
  )
}
