import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Draft } from '../mission/model'
import { HOME, surveyDraft } from './surveyFixture'
import { useSurvey, type SurveyArgs } from './useSurvey'

/** A draft holder standing in for the mission store: `change` replaces the draft and counts commits. */
function setup(over: Partial<SurveyArgs> = {}) {
  const start = surveyDraft()
  let draft: Draft = start.draft
  const commits = vi.fn()
  const change = (fn: (d: Draft) => Draft) => {
    draft = fn(draft)
    commits()
  }
  const args = (): SurveyArgs => ({ draft, change, home: HOME, elevAt: null, vehicleParams: new Map(), ...over })
  const hook = renderHook(() => useSurvey(args()))
  return { id: start.id, hook, commits, draft: () => draft, rerender: () => hook.rerender() }
}

afterEach(() => vi.useRealTimers())

describe('useSurvey', () => {
  it('update_regenerates_the_items_in_one_commit', () => {
    const s = setup()
    const before = s.draft().surveys[0]!.uids
    act(() => s.hook.result.current.update(s.id, { altM: 120 }))
    expect(s.commits).toHaveBeenCalledTimes(1)
    const now = s.draft().surveys[0]!
    expect(now.spec.altM).toBe(120)
    expect(now.uids).not.toEqual(before)
  })

  it('an_invalid_patch_is_not_committed', () => {
    const s = setup()
    act(() => s.hook.result.current.update(s.id, { altM: 2 }))
    expect(s.commits).not.toHaveBeenCalled()
  })

  it('a_commit_that_yields_no_lanes_keeps_the_items_and_reports_rejected_until_the_next_good_commit', () => {
    const s = setup()
    const items = s.draft().items
    const poly = s.draft().surveys[0]!.spec.polygon
    act(() => s.hook.result.current.update(s.id, { polygon: poly.slice(0, 2) }))
    expect(s.commits).not.toHaveBeenCalled()
    expect(s.draft().items).toBe(items)
    s.rerender()
    expect(s.hook.result.current.rejected).toBe('invalid_polygon')
    act(() => s.hook.result.current.update(s.id, { altM: 120 }))
    expect(s.hook.result.current.rejected).toBeNull()
  })

  it('a_spec_failing_the_schema_is_rejected_as_invalid_spec', () => {
    const s = setup()
    act(() => s.hook.result.current.update(s.id, { altM: 2 }))
    expect(s.hook.result.current.rejected).toBe('invalid_spec')
  })

  it('live_updates_preview_once_per_frame_and_done_commits_once', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] })
    const s = setup()
    const uid = s.draft().surveys[0]!.uids[0]!
    act(() => {
      s.hook.result.current.update(s.id, { angleDeg: 10 }, 'live')
      s.hook.result.current.update(s.id, { angleDeg: 20 }, 'live')
    })
    expect(s.hook.result.current.surveyFor(uid)?.spec.angleDeg).toBe(90)
    act(() => vi.advanceTimersToNextFrame())
    expect(s.hook.result.current.surveyFor(uid)?.spec.angleDeg).toBe(20)
    expect(s.hook.result.current.metrics(s.id)?.spec.angleDeg).toBe(20)
    expect(s.commits).not.toHaveBeenCalled()
    act(() => s.hook.result.current.update(s.id, { angleDeg: 30 }, 'done'))
    expect(s.commits).toHaveBeenCalledTimes(1)
    expect(s.draft().surveys[0]!.spec.angleDeg).toBe(30)
  })

  it('metrics_has_numbers_ground_and_worst_case_from_the_terrain', () => {
    const elevAt = (lon: number) => (lon > HOME.lon ? 40 : 0)
    const s = setup({ elevAt })
    const m = s.hook.result.current.metrics(s.id)!
    expect(m.numbers.lanes).toBeGreaterThan(0)
    expect(m.ground).toEqual({ min: 40, max: 40 })
    expect(m.worst?.minGsdCm).toBeLessThan(m.worst!.gsdCm + 1e-9)
    expect(m.warnings).toContain('wp_radius')
    expect(s.hook.result.current.metrics(s.id)).toBe(m)
  })

  it('the_bank_warning_uses_the_vehicle_roll_limit', () => {
    const s = setup({ vehicleParams: new Map([['ROLL_LIMIT_DEG', 25]]) })
    const m = s.hook.result.current.metrics(s.id)!
    expect(m.rollLimitDeg).toBe(25)
    expect(m.warnings).toContain('bank')
  })

  it('expand_removes_the_tag_and_keeps_the_items', () => {
    const s = setup()
    const n = s.draft().items.length
    act(() => s.hook.result.current.expand(s.id))
    expect(s.draft().surveys).toEqual([])
    expect(s.draft().items).toHaveLength(n)
  })
})
