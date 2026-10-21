// Which survey items the map gives a badge: a survey is hundreds of items, so its badges (DOM
// markers, re-floated in 3D) exist only while it is selected, and none of them is ever dragged.
import { surveyLocked, type Draft } from './model'

export interface SurveyBadges {
  /** Survey items: badges never draggable. */
  readonly locked: ReadonlySet<number>
  /** Items of surveys with nothing selected: no badge at all. */
  readonly hidden: ReadonlySet<number>
}

export function surveyBadges(d: Draft, selected: ReadonlySet<number>): SurveyBadges {
  const hidden = new Set(d.surveys.filter((s) => !s.uids.some((uid) => selected.has(uid))).flatMap((s) => s.uids))
  return { locked: surveyLocked(d), hidden }
}
