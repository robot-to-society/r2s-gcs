// Survey warnings as caution hints: colour only, none blocks writing.
import type { Dict } from '../../shared/i18n'
import { fmtNum } from './NumField'
import type { SurveySpec } from './spec'
import type { SurveyMetrics } from './useSurvey'
import { MAX_SURVEY_ITEMS, suggestSkip, type SurveyWarning } from './warnings'

interface Props {
  readonly spec: SurveySpec
  readonly metrics: SurveyMetrics
  readonly dict: Dict
}

function text(code: Exclude<SurveyWarning, 'wp_radius'>, { metrics, dict }: Props): string {
  const g = metrics.geometry
  const copy: Record<typeof code, string> = {
    blur: dict.svWarnBlur,
    interval: dict.svWarnInterval,
    skip: dict.svWarnSkip.replace('{n}', String(suggestSkip(g.spacingM, g.turnRadiusM))),
    bank: dict.svWarnBank,
    overlap: dict.svWarnOverlap,
    arc: dict.svWarnArc,
    entry: dict.svWarnEntry,
    too_many: dict.svWarnTooMany.replace('{n}', String(MAX_SURVEY_ITEMS)),
    no_home: dict.svWarnNoHome,
  }
  return copy[code]
}

/** WP_RADIUS: split turns cut short, and (in any turn mode) photos starting / stopping early — not drawn by the predicted path. */
function WpRadius({ spec, dict }: Props) {
  return (
    <div className="hint caution sv-warn">
      {spec.turn === 'split' && <span>{dict.svWarnWpRadius.replace('{n}', fmtNum(spec.wpRadiusM, 0))}</span>}
      {spec.turn === 'split' && ' '}
      <span>{dict.svWarnWpRadiusShots}</span>
    </div>
  )
}

export function SurveyWarnings(p: Props) {
  if (p.metrics.warnings.length === 0) return null
  return (
    <div className="sv-warns" data-testid="survey-warnings">
      {p.metrics.warnings.map((code) =>
        code === 'wp_radius' ? (
          <WpRadius key={code} {...p} />
        ) : (
          <div key={code} className="hint caution sv-warn">
            {text(code, p)}
          </div>
        ),
      )}
    </div>
  )
}
