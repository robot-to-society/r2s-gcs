// Drawing a survey area on the map (click vertices, Enter / first vertex to finish, Esc to cancel)
// or taking one from a KML file: either way the survey is generated with the defaults and inserted
// after the selected item as one undo step, then selected.
import { useState } from 'react'
import type { SurveyCamera, VehicleKind } from '../../shared/api/types'
import { planeParams } from '../flightpath/params'
import type { LatLon } from '../mission/geo'
import type { Draft } from '../mission/model'
import { toValues } from './cameraApi'
import { addSurvey } from './draftOps'
import { generateSurvey } from './generate'
import { ALPHA7R4, defaultSpec, type SurveyCameraValues, type SurveySpec } from './spec'

/** The connected vehicle: its kind and the parameters read from it (ROLL_LIMIT_DEG, WP_RADIUS). */
export interface DrawVehicle {
  readonly kind: VehicleKind
  readonly params: ReadonlyMap<string, number>
}

interface Args {
  /** Commits one undo step. */
  readonly change: (fn: (d: Draft) => Draft) => void
  /** The survey goes after this item (after its whole survey when inside one); null = at the end. */
  readonly afterUid: number | null
  readonly home: LatLon | null
  readonly cameras: readonly SurveyCamera[]
  readonly vehicle: DrawVehicle | null
  /** Selects the new survey's first item (its panel opens). */
  readonly select: (uid: number) => void
}

/** The bank the defaults never exceed (spec: 30°). */
const MAX_DEFAULT_BANK = 30
const MIN_VERTICES = 3

export type DrawError = 'invalid_polygon'

const pickCamera = (cameras: readonly SurveyCamera[]): SurveyCameraValues => {
  const builtin = cameras.find((c) => c.builtin)
  return builtin ? toValues(builtin) : ALPHA7R4
}

/** Airframe, bank (≤ 30°, ROLL_LIMIT_DEG) and WP_RADIUS from the vehicle; plane defaults without one. */
function vehicleOpts(v: DrawVehicle | null): { airframe: SurveySpec['airframe']; bankDeg: number; wpRadiusM?: number } {
  const airframe = v?.kind === 'copter' ? 'copter' : 'plane'
  if (!v) return { airframe, bankDeg: MAX_DEFAULT_BANK }
  const { params } = planeParams(v.params)
  const bankDeg = v.params.has('ROLL_LIMIT_DEG') ? Math.min(MAX_DEFAULT_BANK, params.rollLimitDeg) : MAX_DEFAULT_BANK
  const wpRadiusM = v.params.has('WP_RADIUS') && params.wpRadius > 0 ? params.wpRadius : undefined
  return { airframe, bankDeg, wpRadiusM }
}

export function useSurveyDraw({ change, afterUid, home, cameras, vehicle, select }: Args) {
  const [drawing, setDrawing] = useState<readonly LatLon[] | null>(null)
  const [error, setError] = useState<DrawError | null>(null)

  /** Generates and inserts the survey; false when no lane fits the polygon. */
  const create = (ring: readonly LatLon[], name: string | null): boolean => {
    const { airframe, ...opts } = vehicleOpts(vehicle)
    const base = defaultSpec(ring, pickCamera(cameras), airframe, opts)
    const gen = generateSurvey(base, home)
    if ('error' in gen) {
      setError(gen.error)
      return false
    }
    let first: number | null = null
    change((d) => {
      const spec = { ...base, name: name ?? String(d.surveys.length + 1) }
      const added = addSurvey(d, afterUid, spec, gen.items)
      first = added.draft.surveys.find((s) => s.id === added.id)?.uids[0] ?? null
      return added.draft
    })
    setError(null)
    if (first !== null) select(first)
    return true
  }

  const start = () => {
    setError(null)
    setDrawing([])
  }
  const addVertex = (p: LatLon) => setDrawing((ring) => (ring ? [...ring, { lat: p.lat, lon: p.lon }] : ring))
  const cancel = () => {
    setError(null)
    setDrawing(null)
  }
  const finish = () => {
    if (!drawing || drawing.length < MIN_VERTICES) return
    if (create(drawing, null)) setDrawing(null)
  }
  const fromKml = (ring: readonly LatLon[], name: string) => {
    if (create(ring, name)) setDrawing(null)
  }

  const dismissError = () => setError(null)

  return { drawing, error, start, addVertex, finish, cancel, fromKml, dismissError }
}
