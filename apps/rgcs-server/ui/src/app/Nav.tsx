import type { Dict } from '../shared/i18n'
import { ENABLED_VIEWS, NAV_VIEWS, type View } from './view'

interface Props {
  readonly view: View
  readonly onView: (view: View) => void
  readonly dict: Dict
}

const LABEL: Record<(typeof NAV_VIEWS)[number], keyof Dict> = {
  ops: 'navMap',
  video: 'navVideo',
  mission: 'navMission',
  ai: 'navAi',
  maint: 'navSettings',
  present: 'navMap',
}

/** Five-way segment with a sliding lens (`.seg.n5`, spec 20 §5). */
export function Nav({ view, onView, dict }: Props) {
  const index = Math.max(0, NAV_VIEWS.indexOf(view))
  return (
    <nav className="seg n5 nav" aria-label="views">
      <span className="lens" data-testid="lens" style={{ transform: `translateX(${index * 100}%)` }} />
      {NAV_VIEWS.map((v) => {
        const enabled = ENABLED_VIEWS.has(v)
        return (
          <button
            key={v}
            type="button"
            className={v === view ? 'on' : ''}
            aria-current={v === view ? 'page' : undefined}
            aria-disabled={enabled ? undefined : 'true'}
            title={enabled ? undefined : dict.comingSoon}
            onClick={() => enabled && onView(v)}
          >
            {dict[LABEL[v]]}
          </button>
        )
      })}
    </nav>
  )
}
