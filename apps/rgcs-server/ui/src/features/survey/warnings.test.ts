import { describe, expect, it } from 'vitest'
import type { Home } from '../../shared/api/types'
import type { LatLon } from '../mission/geo'
import { PLANE_DEFAULTS } from '../flightpath/params'
import { predictPlane, type PathPoint } from '../flightpath/planePath'
import { generateSurvey, surveyNumbers } from './generate'
import { gsdCm } from './photo'
import { ALPHA7R4, defaultSpec, type SurveySpec } from './spec'
import { shootingStarts, suggestSkip, surveyWarnings, type SurveyWarning, type WarningInput } from './warnings'
import type { WorstCase } from './worst'

const O: LatLon = { lat: 36.25, lon: 139.0 }
const M_LAT = 110_540
const M_LON = 111_320 * Math.cos((36.25 * Math.PI) / 180)
const at = (e: number, n: number): LatLon => ({ lat: O.lat + n / M_LAT, lon: O.lon + e / M_LON })
// 400 m east-west x 300 m north-south
const RECT = [at(0, 0), at(400, 0), at(400, 300), at(0, 300)]
const HOME: Home = { ...at(-150, 150), alt: 0 }
/** 1/2000 s: 0.9 cm of motion against 1.07 cm GSD at 100 m; photos every 0.76 s. */
const CAM = { ...ALPHA7R4, shutterS: 1 / 2000, minIntervalS: 0.5 }
/** Defaults that raise nothing: skip 3 (4 × 30.6 m ≥ 2R = 114.4 m), WP_RADIUS 5 m. */
const spec = (o: Partial<SurveySpec> = {}): SurveySpec => ({
  ...defaultSpec(RECT, CAM, 'plane'),
  angleDeg: 90,
  start: 'nw',
  skip: 3,
  wpRadiusM: 5,
  ...o,
})

function input(s: SurveySpec, o: Partial<WarningInput> = {}): WarningInput {
  const r = generateSurvey(s, HOME)
  if ('error' in r) throw new Error(r.error)
  const numbers = surveyNumbers(s, r.geometry, r.items)
  return { spec: s, geometry: r.geometry, numbers, worst: null, items: r.items, home: HOME, ...o }
}
const warn = (s: SurveySpec, o: Partial<WarningInput> = {}): SurveyWarning[] => surveyWarnings(input(s, o))
const predicted = (s: SurveySpec, wpRadius: number): PathPoint[] => {
  const { items } = input(s)
  return predictPlane(items, HOME, { ...PLANE_DEFAULTS, airspeed: s.speedMs, rollLimitDeg: s.bankDeg, wpRadius })
}

describe('surveyWarnings', () => {
  it('nothing for a sound plane survey', () => {
    expect(warn(spec())).toEqual([])
  })

  it('blur: more than 1 px at the smallest GSD', () => {
    // 18 m/s × 1/1000 s = 1.8 cm against 1.07 cm at 100 m
    expect(warn(spec({ camera: { ...CAM, shutterS: 1 / 1000 } }))).toContain('blur')
    // 0.9 cm: fine at 100 m AGL (0.84 px), blurred where the ground rises to 70 m AGL (1.2 px)
    const s = spec()
    expect(warn(s)).not.toContain('blur')
    const worst: WorstCase = { gsdCm: 2, minGsdCm: gsdCm(CAM, 70), frontPct: 80, sidePct: 70 }
    expect(warn(s, { worst })).toContain('blur')
  })

  it('interval: photos closer in time than the camera allows', () => {
    // 13.6 m at 18 m/s: 0.756 s
    expect(warn(spec({ camera: { ...CAM, minIntervalS: 0.75 } }))).not.toContain('interval')
    expect(warn(spec({ camera: { ...CAM, minIntervalS: 0.76 } }))).toContain('interval')
  })

  it('skip: plane and (skip + 1) × spacing < 2R', () => {
    expect(warn(spec({ skip: 0 }))).toContain('skip')
    expect(warn(spec({ skip: 3 }))).not.toContain('skip')
    expect(warn(spec({ skip: 0, airframe: 'copter', speedMs: 8 }))).not.toContain('skip')
  })

  it('bank: the set bank exceeds the vehicle roll limit', () => {
    expect(warn(spec({ bankDeg: 35 }), { rollLimitDeg: 30 })).toContain('bank')
    expect(warn(spec({ bankDeg: 30 }), { rollLimitDeg: 30 })).not.toContain('bank')
    expect(warn(spec({ bankDeg: 35 }))).not.toContain('bank')
  })

  it('overlap: worst front or side more than 10 points under the set value', () => {
    const w = (frontPct: number, sidePct: number): WorstCase => ({ gsdCm: 1, minGsdCm: 1, frontPct, sidePct })
    const s = spec()
    expect(warn(s, { worst: w(70, 60) })).not.toContain('overlap')
    expect(warn(s, { worst: w(69.9, 70) })).toContain('overlap')
    expect(warn(s, { worst: w(80, 59.9) })).toContain('overlap')
  })

  it('arc: ARC turns', () => {
    expect(warn(spec({ turn: 'arc' }))).toContain('arc')
  })

  it('wp_radius (a): split turns and WP_RADIUS > half the 30° chord', () => {
    // R 57.2: chord 29.6 m, half 14.8 m (lead-in 60, overshoot 30 + margin 34 do not bind)
    expect(warn(spec({ wpRadiusM: 15 }))).toContain('wp_radius')
    expect(warn(spec({ wpRadiusM: 14 }))).not.toContain('wp_radius')
    expect(warn(spec({ wpRadiusM: 15, turn: 'arc' }))).not.toContain('wp_radius')
  })

  it('wp_radius (b): WP_RADIUS beyond the lead-in (photos would start in the turn)', () => {
    expect(warn(spec({ turn: 'arc', wpRadiusM: 50, leadInM: 49 }))).toContain('wp_radius')
    expect(warn(spec({ turn: 'arc', wpRadiusM: 50, leadInM: 50 }))).not.toContain('wp_radius')
  })

  it('wp_radius (c): WP_RADIUS beyond overshoot + along-track margin (trigger off before the shooting end)', () => {
    const s = (overshootM: number) => spec({ turn: 'arc', wpRadiusM: 50, leadInM: 60, marginM: 20, overshootM })
    expect(warn(s(29))).toContain('wp_radius')
    expect(warn(s(30))).not.toContain('wp_radius')
  })

  it('wp_radius never for copter', () => {
    expect(warn(spec({ airframe: 'copter', speedMs: 8, wpRadiusM: 200 }))).not.toContain('wp_radius')
  })

  it('too_many: more than 700 items', () => {
    const base = input(spec())
    const extra = Array.from({ length: 701 - base.items.length }, () => base.items[1])
    expect(base.items.length).toBeLessThanOrEqual(700)
    expect(surveyWarnings({ ...base, items: [...base.items, ...extra] })).toContain('too_many')
  })

  it('no_home', () => {
    expect(warn(spec(), { home: null })).toContain('no_home')
  })

  it('order follows the code list', () => {
    const s = spec({ skip: 0, turn: 'arc', camera: { ...CAM, minIntervalS: 2 }, bankDeg: 50, wpRadiusM: 90 })
    expect(warn(s, { home: null, rollLimitDeg: 45 })).toEqual(['interval', 'skip', 'bank', 'arc', 'wp_radius', 'no_home'] satisfies SurveyWarning[])
  })
})

describe('entry warning (predicted path)', () => {
  // split survey, R 57 (18 m/s, 30° bank). predictPlane flies waypoint corners as fillets of the
  // turn radius (capped at half the leg) and uses WP_RADIUS only for loiters, so the collinear
  // shooting-start WP is always on the predicted path with the auto 60 m lead-in, whatever WP_RADIUS.
  it('auto lead-in: the predicted path passes every shooting start (WP_RADIUS 90 and 5)', () => {
    for (const r of [90, 5]) {
      const s = spec({ wpRadiusM: r })
      expect(warn(s, { predicted: predicted(s, r) })).not.toContain('entry')
    }
  })

  it('no lead-in: the turn from home into the first lane misses its shooting start (8.8 m)', () => {
    const s = spec({ leadInM: 0, wpRadiusM: 90 })
    expect(warn(s, { predicted: predicted(s, 90) })).toContain('entry')
  })

  it('needs a predicted path and a plane', () => {
    const s = spec({ wpRadiusM: 90 })
    expect(warn(s)).not.toContain('entry')
    const far: PathPoint[] = [{ ...at(5000, 5000), alt: 100 }]
    expect(warn(s, { predicted: far })).toContain('entry')
    expect(warn(spec({ airframe: 'copter', speedMs: 8 }), { predicted: far })).not.toContain('entry')
  })
})

describe('shootingStarts', () => {
  it('the WAYPOINT before each trigger-on, one per lane, also when the lead-in WP took its place', () => {
    for (const leadInM of [null, 0]) {
      const { items, geometry } = input(spec({ leadInM }))
      const starts = shootingStarts(items)
      expect(starts).toHaveLength(geometry.lanes.length)
      starts.forEach((wp) => expect(wp.command).toBe(16))
    }
  })
})

describe('suggestSkip', () => {
  it('max(0, ceil(2R / spacing) − 1)', () => {
    expect(suggestSkip(30.6, 57.2)).toBe(3)
    expect(suggestSkip(200, 57.2)).toBe(0)
    expect(suggestSkip(57.2, 57.2)).toBe(1)
  })
})
