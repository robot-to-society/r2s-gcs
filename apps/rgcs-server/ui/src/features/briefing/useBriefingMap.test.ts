import { describe, expect, it } from 'vitest'
import type { DraftItem } from '../mission/model'
import { INITIAL_MISSION_UI, type MissionUi } from '../mission/store'
import { addRow, emptyWorkspace, setHidden, type Workspace } from './model'
import { briefingMapOf } from './useBriefingMap'

const LAT0 = 36.25
const LON0 = 137.64

/** A two-point route; `dir` 'ew' runs east–west through the origin, 'ns' north–south. */
function ui(name: string, dir: 'ew' | 'ns', alt: number, savedId: number): MissionUi {
  const d = 0.002
  const pts = dir === 'ew' ? [[LAT0, LON0 - d], [LAT0, LON0 + d]] : [[LAT0 - d, LON0], [LAT0 + d, LON0]]
  const items = pts.map(([lat, lon], i) => ({ seq: i + 1, command: 16, frame: 'rel', lat, lon, alt, params: [0, 0, 0, 0], uid: i + 1 }) as unknown as DraftItem)
  const p = INITIAL_MISSION_UI.history.present
  return { ...INITIAL_MISSION_UI, savedId, history: { ...INITIAL_MISSION_UI.history, present: { ...p, items, nextUid: 3, mission: { ...p.mission, name } } } }
}

function three(): Workspace {
  const ws = addRow(addRow(addRow(emptyWorkspace(), ui('A', 'ew', 40, 1)), ui('B', 'ns', 80, 2)), ui('C', 'ns', 60, 3))
  // the starting row stays empty; C is marked missing
  return { ...ws, rows: ws.rows.slice(1).map((r, i) => (i === 2 ? { ...r, missing: true } : r)), active: ws.rows[1]!.key }
}

describe('briefingMapOf', () => {
  it('others_leave_out_the_active_and_missing_rows', () => {
    const ws = three()
    const m = briefingMapOf(ws)
    expect(m.others.map((o) => o.key)).toEqual([ws.rows[1]!.key])
    expect(m.others[0]!.color).toBe(ws.rows[1]!.color)
    expect(m.others[0]!.predicted).toBeNull()
  })

  it('labels_cover_the_active_row_too_and_names_colours_follow_the_rows', () => {
    const ws = three()
    const m = briefingMapOf(ws)
    expect(m.labels).toHaveLength(1)
    expect(new Set([m.labels[0]!.a.key, m.labels[0]!.b.key])).toEqual(new Set([ws.rows[0]!.key, ws.rows[1]!.key]))
    expect(m.names.get(ws.rows[0]!.key)).toBe('A')
    expect(m.colors.get(ws.rows[1]!.key)).toBe(ws.rows[1]!.color)
  })

  it('a_single_mission_has_no_others_and_no_labels', () => {
    const m = briefingMapOf(emptyWorkspace())
    expect(m.others).toEqual([])
    expect(m.labels).toEqual([])
  })

  it('hidden_rows_are_not_drawn_or_labelled', () => {
    const ws = three()
    const shown = briefingMapOf(ws)
    expect(shown.others).toHaveLength(1)
    expect(shown.labels).toHaveLength(1)
    const hid = briefingMapOf(setHidden(ws, ws.rows[1]!.key, true))
    expect(hid.others).toEqual([])
    expect(hid.labels).toEqual([])
  })
})
