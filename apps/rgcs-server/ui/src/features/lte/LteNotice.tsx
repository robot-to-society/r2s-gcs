import type { Dict } from '../../shared/i18n'
import { lteAreasStore, useLteAreas, type LteAreasStore } from './areasStore'
import { lteNoticeDates } from './layer'
import { lteOverlayStore, useLteOverlayPrefs, type LteOverlayStore } from './prefs'

interface Props {
  readonly dict: Dict
  readonly prefs?: LteOverlayStore
  readonly areas?: LteAreasStore
}

/** While the LTE layer is on: the source and its limits (docomo's public map, nothing about the air). */
export function LteNotice({ dict, prefs = lteOverlayStore(), areas = lteAreasStore() }: Props) {
  const { on } = useLteOverlayPrefs(prefs)
  const state = useLteAreas(on, areas)
  if (!on) return null
  const dates = lteNoticeDates(state.areas)
  const text = dates ? dict.lteNotice.replace('{fetched}', dates.fetched).replace('{data}', dates.data ?? dict.lteUnknown) : dict.lteNone
  return (
    <div className="g-ctl lte-notice" role="note">
      {text}
    </div>
  )
}
