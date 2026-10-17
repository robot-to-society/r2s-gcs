import { describe, expect, it } from 'vitest'
import { appendWaypoint, emptyDraft, fromMission, insertAfter, moveItem, removeItems, reorder, setAltBulk, setCommand, toMission, updateItem } from './model'

describe('mission draft model', () => {
  it('first_point_is_takeoff_then_waypoints', () => {
    const d0 = emptyDraft()
    expect(d0.items).toEqual([])
    expect(d0.mission.default_alt).toBe(50)
    const d1 = appendWaypoint(d0, 36.162, 139.372)
    expect(d1.items[0]).toMatchObject({ command: 22, lat: 36.162, lon: 139.372, alt: 50, frame: 'rel', autocontinue: true })
    const d2 = appendWaypoint(d1, 36.163, 139.373)
    expect(d2.items[1]?.command).toBe(16)
    expect(d2.items[1]?.params).toEqual([0, 0, 0, 0])
    expect(d2.items.map((i) => i.uid)).toEqual([1, 2])
    expect(d2.nextUid).toBe(3)
  })

  it('insert_remove_move_reorder_are_immutable', () => {
    const d = appendWaypoint(appendWaypoint(appendWaypoint(emptyDraft(), 36.1, 139.1), 36.2, 139.2), 36.3, 139.3)
    const ins = insertAfter(d, 1, 36.15, 139.15)
    expect(ins.items.map((i) => i.uid)).toEqual([1, 4, 2, 3])
    expect(ins.items[1]?.command).toBe(16)
    expect(d.items).toHaveLength(3)
    const rem = removeItems(ins, new Set([4, 3]))
    expect(rem.items.map((i) => i.uid)).toEqual([1, 2])
    const mv = moveItem(d, 2, 36.25, 139.25)
    expect(mv.items[1]).toMatchObject({ lat: 36.25, lon: 139.25 })
    expect(d.items[1]).toMatchObject({ lat: 36.2, lon: 139.2 })
    expect(mv.items[0]).toBe(d.items[0])
    const re = reorder(d, 3, -1)
    expect(re.items.map((i) => i.uid)).toEqual([1, 3, 2])
    expect(reorder(d, 1, -1)).toBe(d)
    expect(reorder(d, 3, 1)).toBe(d)
  })

  it('set_command_resets_params_to_defaults', () => {
    const d = updateItem(appendWaypoint(appendWaypoint(emptyDraft(), 36.1, 139.1), 36.2, 139.2), 2, { params: [5, 0, 0, 0] })
    const speed = setCommand(d, 2, 'DO_CHANGE_SPEED')
    expect(speed.items[1]).toMatchObject({ command: 178, params: [1, 8, -1, 0], lat: 0, lon: 0, alt: 0 })
    const back = setCommand(speed, 2, 'LOITER_TIME')
    expect(back.items[1]).toMatchObject({ command: 19, params: [10, 0, 0, 0], lat: 0, lon: 0 })
    const kept = setCommand(d, 2, 'SPLINE_WAYPOINT')
    expect(kept.items[1]).toMatchObject({ command: 82, lat: 36.2, lon: 139.2, alt: 50, params: [0, 0, 0, 0] })
    expect(setCommand(d, 2, 'NOPE')).toBe(d)
  })

  it('bulk_alt_touches_only_selected_and_round_trips_to_mission', () => {
    const d = appendWaypoint(appendWaypoint(appendWaypoint(emptyDraft(), 36.1, 139.1), 36.2, 139.2), 36.3, 139.3)
    const bulk = setAltBulk(d, new Set([2, 3]), 80, 'abs')
    expect(bulk.items.map((i) => [i.alt, i.frame])).toEqual([
      [50, 'rel'],
      [80, 'abs'],
      [80, 'abs'],
    ])
    const m = toMission(bulk)
    expect(m.items).toHaveLength(3)
    expect('uid' in (m.items[0] as object)).toBe(false)
    const again = fromMission({ ...m, id: 7 })
    expect(again.items.map((i) => i.uid)).toEqual([1, 2, 3])
    expect(again.mission.id).toBe(7)
  })
})
