// The mission screen's survey hooks in one place: palette entries, keys and map clicks while an
// area is drawn, the KML file input, and the camera list (fetched the first time it is needed).
import { useEffect, useRef, useState } from 'react'
import type { SurveyCamera, VehicleKind } from '../../shared/api/types'
import { SURVEY_KEY, SURVEY_KML_KEY } from '../mission/cmds'
import type { LatLon } from '../mission/geo'
import type { Draft } from '../mission/model'
import type { PlanTab } from '../mission/fenceMap'
import { selectOne, type MissionStore } from '../mission/store'
import { listCameras } from './cameraApi'
import type { SurveyDrawMap } from './surveyDrawLayer'
import { useSurveyDraw } from './useSurveyDraw'

interface Args {
  readonly store: MissionStore
  readonly change: (fn: (d: Draft) => Draft) => void
  /** The last selected item: a new survey goes after it. */
  readonly afterUid: number | null
  readonly home: LatLon | null
  readonly kind: VehicleKind | null
  /** Parameters read from the vehicle (ROLL_LIMIT_DEG, WP_RADIUS). */
  readonly params: ReadonlyMap<string, number>
  readonly tab: PlanTab
  /** Frames a polygon read from KML. */
  readonly onFit: (points: readonly LatLon[]) => void
}

/** The camera list, fetched once on first use rather than every time the planner opens. */
function useLazyCameras() {
  const [cameras, setCameras] = useState<readonly SurveyCamera[]>([])
  const asked = useRef(false)
  const load = () => {
    if (asked.current) return
    asked.current = true
    listCameras()
      .then(setCameras)
      .catch(() => {
        // the α7R IV default stands in; the next use asks again
        asked.current = false
      })
  }
  return { cameras, load }
}

export function useSurveyWiring({ store, change, afterUid, home, kind, params, tab, onFit }: Args) {
  const cams = useLazyCameras()
  const kmlInput = useRef<HTMLInputElement>(null)
  const select = (uid: number) => store.update((u) => selectOne(u, uid, false))
  const draw = useSurveyDraw({ change, afterUid, home, cameras: cams.cameras, vehicle: kind === null ? null : { kind, params }, select })
  // leaving the mission tab abandons a drawing
  const cancel = useRef(draw.cancel)
  cancel.current = draw.cancel
  useEffect(() => {
    if (tab !== 'mission') cancel.current()
  }, [tab])

  /** Handles the palette's survey entries; false for a mission command. */
  const onPalette = (key: string): boolean => {
    if (key !== SURVEY_KEY && key !== SURVEY_KML_KEY) return false
    cams.load()
    if (key === SURVEY_KEY) draw.start()
    else kmlInput.current?.click()
    return true
  }
  /** Enter finishes and Esc cancels a drawing; true when the key was used. */
  const onKey = (e: { key: string; preventDefault: () => void }): boolean => {
    if (!draw.drawing || (e.key !== 'Enter' && e.key !== 'Escape')) return false
    if (e.key === 'Enter') draw.finish()
    else draw.cancel()
    e.preventDefault()
    return true
  }
  const onKml = (ring: readonly LatLon[], name: string) => {
    draw.fromKml(ring, name)
    onFit(ring)
  }
  const mapDraw: SurveyDrawMap | null = draw.drawing ? { ring: draw.drawing, onClick: (lat, lon) => draw.addVertex({ lat, lon }), onClose: draw.finish } : null

  return { onPalette, onKey, mapDraw, slot: { drawing: draw.drawing, error: draw.error, onFinish: draw.finish, onCancel: draw.cancel, onDismiss: draw.dismissError, kmlInput, onKml } }
}
