// Survey editing for the panel: reads a survey (with its live preview), regenerates its items on a
// change (one undo step), and derives the numbers, terrain worst case and warnings per spec.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MissionItem } from '../../shared/api/types'
import { planeParams } from '../flightpath/params'
import type { ElevAt } from '../map/air'
import type { LatLon } from '../mission/geo'
import type { Predicted } from '../mission/missionAir'
import type { Draft, DraftSurvey } from '../mission/model'
import { expandSurvey, regenerateSurvey, surveyAt } from './draftOps'
import { generateSurvey, surveyNumbers, type SurveyGeometry, type SurveyNumbers } from './generate'
import { surveySpecSchema, type SurveySpec } from './spec'
import { surveyWarnings, type SurveyWarning } from './warnings'
import { groundRange, worstCase, type GroundRange, type WorstCase } from './worst'

export interface SurveyArgs {
  readonly draft: Draft
  /** Commits one undo step. */
  readonly change: (fn: (d: Draft) => Draft) => void
  readonly home: LatLon | null
  /** Terrain sampler, null without DEM tiles. */
  readonly elevAt: ElevAt | null
  /** Parameters read from the connected vehicle (name → value); ROLL_LIMIT_DEG feeds the bank check. */
  readonly vehicleParams: ReadonlyMap<string, number>
  /** The predicted flight for a draft (plane entry check); absent without a vehicle model. */
  readonly predict?: (d: Draft) => Predicted | null
  /** Bumps when terrain tiles arrive, so cached metrics are recomputed. */
  readonly terrainTick?: number
}

export interface SurveyMetrics {
  readonly spec: SurveySpec
  readonly items: readonly MissionItem[]
  readonly geometry: SurveyGeometry
  readonly numbers: SurveyNumbers
  readonly ground: GroundRange | null
  readonly worst: WorstCase | null
  readonly warnings: readonly SurveyWarning[]
  /** ROLL_LIMIT_DEG of the connected vehicle, when read. */
  readonly rollLimitDeg?: number
}

/** `live`: a drag in progress (preview, once per frame); `done`: its release (commit); none: a typed value (commit). */
export type UpdatePhase = 'live' | 'done'

interface Preview {
  readonly id: string
  readonly spec: SurveySpec
}

const frame = (cb: () => void): number => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(cb) : window.setTimeout(cb, 16))
const cancelFrame = (h: number) => (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame(h) : window.clearTimeout(h))

interface MetricsCtx {
  readonly draft: Draft
  readonly id: string
  readonly home: LatLon | null
  readonly elevAt: ElevAt | null
  readonly rollLimitDeg?: number
  readonly predict?: (d: Draft) => Predicted | null
}

function computeMetrics(spec: SurveySpec, c: MetricsCtx): SurveyMetrics | null {
  const gen = generateSurvey(spec, c.home)
  if ('error' in gen) return null
  const { items, geometry } = gen
  const numbers = surveyNumbers(spec, geometry, items)
  const ground = c.elevAt ? groundRange(spec.polygon, c.elevAt) : null
  const homeAmsl = c.elevAt && c.home ? c.elevAt(c.home.lon, c.home.lat) : null
  const worst = ground && homeAmsl !== null ? worstCase(spec, geometry, ground, homeAmsl) : null
  const predicted = spec.airframe === 'plane' && c.predict ? c.predict(regenerateSurvey(c.draft, c.id, spec, items))?.points : undefined
  const warnings = surveyWarnings({ spec, geometry, numbers, worst, items, home: c.home, predicted, rollLimitDeg: c.rollLimitDeg })
  return { spec, items, geometry, numbers, ground, worst, warnings, rollLimitDeg: c.rollLimitDeg }
}

export function useSurvey({ draft, change, home, elevAt, vehicleParams, predict, terrainTick = 0 }: SurveyArgs) {
  const [preview, setPreview] = useState<Preview | null>(null)
  const pending = useRef<Preview | null>(null)
  const scheduled = useRef<number | null>(null)
  useEffect(() => () => void (scheduled.current !== null && cancelFrame(scheduled.current)), [])

  const rollLimitDeg = vehicleParams.has('ROLL_LIMIT_DEG') ? planeParams(vehicleParams).params.rollLimitDeg : undefined
  const [hLat, hLon] = [home?.lat, home?.lon]
  // memoised on the spec object; a new cache whenever the inputs besides the spec change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cache = useMemo(() => new WeakMap<SurveySpec, SurveyMetrics | null>(), [hLat, hLon, elevAt, terrainTick, rollLimitDeg, predict])

  const specOf = useCallback(
    (id: string): SurveySpec | null => (pending.current?.id === id ? pending.current.spec : (draft.surveys.find((s) => s.id === id)?.spec ?? null)),
    [draft],
  )

  const commit = useCallback(
    (id: string, spec: SurveySpec) => {
      if (!surveySpecSchema.safeParse(spec).success) return
      const gen = generateSurvey(spec, home)
      if ('error' in gen) return
      change((d) => regenerateSurvey(d, id, spec, gen.items))
    },
    [change, home],
  )

  const update = useCallback(
    (id: string, patch: Partial<SurveySpec>, phase?: UpdatePhase) => {
      const base = specOf(id)
      if (!base) return
      const spec = { ...base, ...patch }
      // a release without a drag, or a value typed back unchanged, is not an edit
      const unchanged = (Object.keys(patch) as (keyof SurveySpec)[]).every((k) => patch[k] === base[k])
      if (phase !== 'live' && unchanged && pending.current?.id !== id) return
      if (phase === 'live') {
        pending.current = { id, spec }
        if (scheduled.current === null) {
          scheduled.current = frame(() => {
            scheduled.current = null
            setPreview(pending.current)
          })
        }
        return
      }
      if (scheduled.current !== null) cancelFrame(scheduled.current)
      scheduled.current = null
      pending.current = null
      setPreview(null)
      commit(id, spec)
    },
    [specOf, commit],
  )

  const surveyFor = (uid: number): DraftSurvey | null => {
    const s = surveyAt(draft, uid)
    return s && preview?.id === s.id ? { ...s, spec: preview.spec } : s
  }

  const metrics = (id: string): SurveyMetrics | null => {
    const spec = preview?.id === id ? preview.spec : draft.surveys.find((s) => s.id === id)?.spec
    if (!spec) return null
    if (!cache.has(spec)) cache.set(spec, computeMetrics(spec, { draft, id, home, elevAt, rollLimitDeg, predict }))
    return cache.get(spec) ?? null
  }

  const expand = (id: string) => change((d) => expandSurvey(d, id))

  return { surveyFor, update, expand, metrics }
}
