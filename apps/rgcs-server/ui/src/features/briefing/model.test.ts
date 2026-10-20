import { describe, expect, it } from 'vitest'
import { INITIAL_MISSION_UI } from '../mission/store'
import { PALETTE, activate, activeRow, addRow, assign, emptyWorkspace, moveRow, parkActive, removeRow, reseedKeys, setColor, setHidden } from './model'

const saved = (id: number) => ({ ...INITIAL_MISSION_UI, savedId: id })

describe('briefing workspace model', () => {
  it('add_assigns_the_next_unused_colour_and_activates', () => {
    const ws = addRow(emptyWorkspace(), saved(1))
    expect(ws.rows).toHaveLength(2)
    expect(ws.rows[0].color).toBe(PALETTE[0])
    expect(ws.rows[1].color).toBe(PALETTE[1])
    expect(ws.active).toBe(ws.rows[1].key)
    expect(new Set(ws.rows.map((r) => r.key)).size).toBe(2)
  })

  it('adding_a_mission_already_in_the_workspace_selects_it_instead', () => {
    const a = addRow(emptyWorkspace(), saved(7))
    const b = addRow(a, saved(8))
    const c = addRow(b, saved(7))
    expect(c.rows).toHaveLength(3)
    expect(c.active).toBe(a.rows[1].key)
  })

  it('assigning_a_taken_vehicle_moves_it', () => {
    const ws = addRow(emptyWorkspace(), saved(1))
    const [r0, r1] = ws.rows
    const a = assign(ws, r0.key, 5)
    const b = assign(a, r1.key, 5)
    expect(b.rows[0].sysid).toBeNull()
    expect(b.rows[1].sysid).toBe(5)
    expect(assign(b, r1.key, null).rows[1].sysid).toBeNull()
  })

  it('removing_the_active_row_activates_a_neighbour_and_never_leaves_zero_rows', () => {
    const ws = addRow(addRow(emptyWorkspace(), saved(1)), saved(2))
    const mid = activate(ws, ws.rows[1].key)
    const r = removeRow(mid, ws.rows[1].key)
    expect(r.rows).toHaveLength(2)
    expect(r.active).toBe(ws.rows[2].key)
    const last = removeRow(r, r.rows[1].key)
    expect(last.active).toBe(r.rows[0].key)
    const none = removeRow(last, last.rows[0].key)
    expect(none.rows).toHaveLength(1)
    expect(none.active).toBe(none.rows[0].key)
    expect(none.rows[0].ui.savedId).toBeNull()
  })

  it('move_and_colour_are_immutable', () => {
    const ws = addRow(emptyWorkspace(), saved(1))
    const snap = JSON.stringify(ws)
    const moved = moveRow(ws, ws.rows[1].key, -1)
    const col = setColor(ws, ws.rows[0].key, '#000000')
    expect(JSON.stringify(ws)).toBe(snap)
    expect(moved.rows[0].key).toBe(ws.rows[1].key)
    expect(moveRow(ws, ws.rows[0].key, -1)).toBe(ws)
    expect(col.rows[0].color).toBe('#000000')
  })

  it('park_activate_and_active_row', () => {
    const ws = addRow(emptyWorkspace(), saved(1))
    const parked = parkActive(ws, saved(9))
    expect(activeRow(parked).ui.savedId).toBe(9)
    expect(activate(parked, ws.rows[0].key).active).toBe(ws.rows[0].key)
  })

  it('reseedKeys_avoids_collisions', () => {
    reseedKeys([{ key: 'r500' }])
    const ws = addRow(emptyWorkspace(), saved(1))
    expect(ws.rows.every((r) => r.key !== 'r500')).toBe(true)
    expect(Number(ws.rows[1].key.slice(1))).toBeGreaterThan(500)
  })

  it('set_hidden_ignores_the_active_row_and_activate_shows_the_row', () => {
    const ws = addRow(emptyWorkspace(), saved(1))
    const [first, second] = ws.rows
    expect(ws.rows.every((r) => !r.hidden)).toBe(true)
    expect(setHidden(ws, second.key, true)).toBe(ws)
    const hid = setHidden(ws, first.key, true)
    expect(hid.rows[0].hidden).toBe(true)
    expect(hid.rows[1].hidden).toBe(false)
    const shown = activate(hid, first.key)
    expect(shown.active).toBe(first.key)
    expect(shown.rows[0].hidden).toBe(false)
  })

  it('removing_the_active_row_shows_the_hidden_neighbour_that_takes_over', () => {
    const ws = addRow(addRow(emptyWorkspace(), saved(1)), saved(2))
    const hid = setHidden(activate(ws, ws.rows[0].key), ws.rows[1].key, true)
    const after = removeRow(hid, hid.active)
    expect(after.active).toBe(ws.rows[1].key)
    expect(activeRow(after).hidden).toBe(false)
  })
})
