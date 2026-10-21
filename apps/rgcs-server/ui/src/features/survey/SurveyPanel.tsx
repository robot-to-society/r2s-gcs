// Right-side panel for one survey (spec §5.2): camera, settings, numbers, warnings and
// 「ウェイポイントに展開」. Every change regenerates the survey's items as one undo step.
import { useMemo, useState } from 'react'
import type { Dict } from '../../shared/i18n'
import { TerrainSampler } from '../map/terrain'
import type { LatLon } from '../mission/geo'
import type { Predicted } from '../mission/missionAir'
import type { Draft } from '../mission/model'
import { CameraFields } from './CameraFields'
import { SurveyFields } from './SurveyFields'
import { SurveyNumbers } from './SurveyNumbers'
import { SurveyWarnings } from './SurveyWarnings'
import { useSurvey } from './useSurvey'
import { useSurveyCameras } from './useSurveyCameras'

/** What the mission screen hands the panel besides the draft. */
export interface SurveyContext {
  /** Commits one undo step. */
  readonly change: (fn: (d: Draft) => Draft) => void
  readonly home: LatLon | null
  /** Terrarium DEM tiles for the ground range; null = no terrain. */
  readonly terrainTiles: string | null
  /** The connected vehicle's parameters (ROLL_LIMIT_DEG shown beside the bank). */
  readonly vehicleParams: ReadonlyMap<string, number>
  readonly predict?: (d: Draft) => Predicted | null
}

interface Props extends SurveyContext {
  /** A selected item of the survey. */
  readonly uid: number
  readonly draft: Draft
  readonly dict: Dict
}

/** The DEM sampler (same source as the elevation sheet) and a counter that bumps as tiles arrive. */
function useTerrain(terrainTiles: string | null) {
  const [tick, setTick] = useState(0)
  const sampler = useMemo(() => (terrainTiles ? new TerrainSampler(terrainTiles, () => setTick((n) => n + 1)) : null), [terrainTiles])
  return { elevAt: sampler ? sampler.elevAt : null, tick }
}

export function SurveyPanel({ uid, draft, dict, change, home, terrainTiles, vehicleParams, predict }: Props) {
  const terrain = useTerrain(terrainTiles)
  const sv = useSurvey({ draft, change, home, elevAt: terrain.elevAt, vehicleParams, predict, terrainTick: terrain.tick })
  const cams = useSurveyCameras()
  const survey = sv.surveyFor(uid)
  if (!survey) return null
  const { id, spec } = survey
  const m = sv.metrics(id)
  const set = (patch: Parameters<typeof sv.update>[1], phase?: Parameters<typeof sv.update>[2]) => sv.update(id, patch, phase)
  return (
    <div className="sec survey-panel" data-testid="survey-panel">
      <div className="row" style={{ gap: 10, marginBottom: 12 }}>
        <span className="h1">{dict.svPanelTitle}</span>
        <span className="t2 sv-name">{spec.name}</span>
      </div>
      {cams.error && <div className="hint caution sv-warn">{`${dict.svCamLoadFailed}: ${cams.error}`}</div>}
      {/* camera values are typed per keystroke: previewed live, committed on blur / Enter */}
      <div onBlur={() => set({}, 'done')} onKeyDown={(e) => e.key === 'Enter' && set({}, 'done')}>
        <CameraFields
          values={spec.camera}
          orientation={spec.orientation}
          cameras={cams.cameras}
          dict={dict}
          onChange={(camera) => set({ camera }, 'live')}
          onOrientation={(orientation) => set({ orientation })}
          onPick={(camera) => set({ camera })}
          onSaveAs={(name) => void cams.saveAs(spec.camera, name)}
          onUpdate={(cid) => void cams.update(cid, spec.camera)}
          onDelete={(cid) => void cams.remove(cid)}
        />
      </div>
      <SurveyFields spec={spec} metrics={m} dict={dict} onChange={set} />
      {m ? <SurveyNumbers spec={spec} metrics={m} dict={dict} /> : <div className="hint caution sv-warn">{dict.svInvalidPolygon}</div>}
      {m && <SurveyWarnings spec={spec} metrics={m} dict={dict} />}
      <button type="button" className="btn sv-expand" onClick={() => sv.expand(id)}>
        {dict.svExpand}
      </button>
    </div>
  )
}
