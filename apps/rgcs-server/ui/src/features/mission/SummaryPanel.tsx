import type { Finding, MissionStats } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { findingText, type LocalWarning } from './summary'

interface Props {
  readonly stats: MissionStats
  readonly warnings: readonly LocalWarning[]
  readonly findings: readonly Finding[]
  readonly dict: Dict
}

const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`)
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`

/** Distance / time / max altitude plus the local warnings and the server's findings (spec 10 §6). */
export function SummaryPanel({ stats, warnings, findings, dict }: Props) {
  const localCodes = new Set(findings.map((f) => f.code))
  return (
    <div className="mission-summary" data-testid="mission-summary">
      <div className="kv">
        <span className="k">{dict.mDistance}</span>
        <span className="num">{km(stats.distance_m)}</span>
      </div>
      <div className="kv">
        <span className="k">{dict.mDuration}</span>
        <span className="num">{mmss(stats.duration_s)}</span>
      </div>
      <div className="kv">
        <span className="k">{dict.mMaxAlt}</span>
        <span className="num">{`${Math.round(stats.max_alt)} m`}</span>
      </div>
      {(warnings.length > 0 || findings.length > 0) && (
        <div className="warnings" role="list">
          {findings.map((f, i) => (
            <span key={`f${i}`} className={f.level} role="listitem">
              {f.seq !== null && <span className="seq">#{f.seq} </span>}
              <span>{findingText(f.code, dict)}</span>
            </span>
          ))}
          {warnings
            .filter((w) => !localCodes.has(w.code))
            .map((w, i) => (
              <span key={`w${i}`} className="warn" role="listitem">
                {w.seq !== null && <span className="seq">#{w.seq} </span>}
                <span>{findingText(w.code, dict)}</span>
              </span>
            ))}
        </div>
      )}
    </div>
  )
}
