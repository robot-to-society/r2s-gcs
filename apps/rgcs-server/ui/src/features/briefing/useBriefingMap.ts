// What the planner map takes from the briefing: the other open missions, the crossing labels and
// the name / colour of every row. `workspace` already holds the live editor in the active row.
import { useMemo } from 'react'
import { crossLabels, type CrossLabel } from './crossings'
import type { Workspace } from './model'
import type { OtherMission } from './overlay'

export interface BriefingMap {
  readonly others: readonly OtherMission[]
  readonly labels: readonly CrossLabel[]
  readonly names: ReadonlyMap<string, string>
  readonly colors: ReadonlyMap<string, string>
}

export function briefingMapOf(ws: Workspace): BriefingMap {
  const rows = ws.rows.filter((r) => !r.missing)
  // a hidden row is neither drawn nor labelled (the active row is never hidden)
  const shown = rows.filter((r) => !r.hidden)
  // predicting a parked row needs its vehicle's parameters: only its plan is drawn
  const others = shown.filter((r) => r.key !== ws.active).map((r): OtherMission => ({ key: r.key, color: r.color, draft: r.ui.history.present, predicted: null }))
  const labels = shown.length > 1 ? crossLabels(shown.map((r) => ({ key: r.key, draft: r.ui.history.present }))) : []
  return {
    others,
    labels,
    names: new Map(rows.map((r) => [r.key, r.ui.history.present.mission.name])),
    colors: new Map(rows.map((r) => [r.key, r.color])),
  }
}

/** MissionMap's briefing props; a label click moves the view there through `onFocus`. */
export function useBriefingMap(ws: Workspace, onFocus: (lat: number, lon: number) => void): BriefingMap & { readonly onLabel: (l: CrossLabel) => void } {
  const data = useMemo(() => briefingMapOf(ws), [ws])
  return { ...data, onLabel: (l) => onFocus(l.lat, l.lon) }
}
