import { describe, expect, it } from 'vitest'
import type { Draft, DraftItem } from '../mission/model'
import { emptyDraft } from '../mission/model'
import { crossLabels } from './crossings'

const LAT0 = 36.2509
const LON0 = 137.6385
const M_LAT = 111_320
const M_LON = M_LAT * Math.cos((LAT0 * Math.PI) / 180)

type P = readonly [x: number, y: number, alt: number]

function draftOf(pts: readonly P[]): Draft {
  const items = pts.map(
    ([x, y, alt], i) =>
      ({ seq: i + 1, command: 16, frame: 'rel', lat: LAT0 + y / M_LAT, lon: LON0 + x / M_LON, alt, params: [0, 0, 0, 0], uid: i + 1 }) as unknown as DraftItem,
  )
  return { ...emptyDraft(), items, nextUid: items.length + 1 }
}

describe('crossLabels', () => {
  it('crossing_legs_get_one_label_with_both_interpolated_altitudes', () => {
    const labels = crossLabels([
      { key: 'A', draft: draftOf([[-100, 0, 40], [100, 0, 60]]) },
      { key: 'B', draft: draftOf([[0, -100, 80], [0, 100, 80]]) },
    ])
    expect(labels).toHaveLength(1)
    const l = labels[0]
    expect(l.kind).toBe('cross')
    expect(l.lat).toBeCloseTo(LAT0, 6)
    expect(l.lon).toBeCloseTo(LON0, 6)
    expect(l.a.key).toBe('A')
    expect(l.a.alt).toBeCloseTo(50, 6)
    expect(l.b.key).toBe('B')
    expect(l.b.alt).toBeCloseTo(80, 6)
    expect(l.a.frame).toBe('rel')
  })

  it('legs_within_30m_get_a_near_label_and_31m_do_not', () => {
    const run = (gap: number) =>
      crossLabels([
        { key: 'A', draft: draftOf([[0, 0, 50], [200, 0, 50]]) },
        { key: 'B', draft: draftOf([[0, gap, 70], [200, gap, 70]]) },
      ])
    const near = run(29)
    expect(near).toHaveLength(1)
    expect(near[0].kind).toBe('near')
    expect(run(31)).toHaveLength(0)
  })

  it('a_long_parallel_leg_10m_apart_merges_to_a_few_labels', () => {
    const labels = crossLabels([
      { key: 'A', draft: draftOf([[0, 0, 50], [1000, 0, 50]]) },
      { key: 'B', draft: draftOf([[0, 10, 70], [1000, 10, 70]]) },
    ])
    expect(labels.length).toBeGreaterThanOrEqual(1)
    expect(labels.length).toBeLessThanOrEqual(13)
  })

  it('same_mission_legs_never_label_each_other', () => {
    const labels = crossLabels([{ key: 'A', draft: draftOf([[-100, 0, 40], [100, 0, 40], [0, 100, 40], [0, -100, 40]]) }])
    expect(labels).toHaveLength(0)
  })
})
