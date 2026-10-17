import { describe, expect, it } from 'vitest'
import type { Mission } from '../../shared/api/types'
import { appendWaypoint, emptyDraft } from './model'
import { INITIAL_MISSION_UI, MissionStore, clearSelection, edit, loaded, markSaved, redoUi, removeSelected, selectOne, selectRange, setTool, undoUi } from './store'

const threePoints = () => appendWaypoint(appendWaypoint(appendWaypoint(emptyDraft(), 36.1, 139.1), 36.2, 139.2), 36.3, 139.3)

describe('mission ui transitions', () => {
  it('edit_pushes_history_and_marks_dirty', () => {
    const ui0 = INITIAL_MISSION_UI
    expect(ui0.dirty).toBe(false)
    const ui1 = edit(ui0, appendWaypoint(ui0.history.present, 36.1, 139.1))
    expect(ui1.dirty).toBe(true)
    expect(ui1.history.past).toHaveLength(1)
    expect(ui1.history.present.items).toHaveLength(1)
    const ui2 = undoUi(ui1)
    expect(ui2.history.present.items).toHaveLength(0)
    expect(redoUi(ui2).history.present).toBe(ui1.history.present)
  })

  it('select_range_follows_list_order', () => {
    const ui = loaded(INITIAL_MISSION_UI, { ...emptyDraft().mission, items: threePoints().items.map(({ uid: _u, ...it }) => it) } as Mission, null)
    const one = selectOne(ui, 1, false)
    expect([...one.selected]).toEqual([1])
    const range = selectRange(one, 3)
    expect([...range.selected].sort()).toEqual([1, 2, 3])
    const toggled = selectOne(range, 2, true)
    expect([...toggled.selected].sort()).toEqual([1, 3])
    expect(selectOne(toggled, 3, false).selected).toEqual(new Set([3]))
    expect(clearSelection(toggled).selected.size).toBe(0)
    expect(setTool(ui, 'add').tool).toBe('add')
    expect(selectRange(clearSelection(ui), 2).selected).toEqual(new Set([2]))
  })

  it('undo_keeps_selection_of_surviving_items', () => {
    const base = loaded(INITIAL_MISSION_UI, { ...emptyDraft().mission, items: threePoints().items.map(({ uid: _u, ...it }) => it) } as Mission, 4)
    expect(base.savedId).toBe(4)
    expect(base.dirty).toBe(false)
    const sel = selectOne(selectOne(base, 2, false), 3, true)
    const removed = removeSelected(sel)
    expect(removed.history.present.items.map((i) => i.uid)).toEqual([1])
    expect(removed.selected.size).toBe(0)
    const back = undoUi(removed)
    expect(back.history.present.items).toHaveLength(3)
    const again = removeSelected(selectOne(back, 3, false))
    expect(again.selected.size).toBe(0)
    const marked = markSaved(again, 4)
    expect(marked.dirty).toBe(false)
  })

  it('store_notifies_subscribers_on_change_only', () => {
    const s = new MissionStore()
    let n = 0
    s.subscribe(() => n++)
    expect(s.getState().tool).toBe('add')
    s.update((ui) => setTool(ui, 'select'))
    s.update((ui) => setTool(ui, 'select'))
    expect(n).toBe(1)
    expect(s.getState().tool).toBe('select')
  })
})
