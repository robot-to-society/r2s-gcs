import { describe, expect, it } from 'vitest'
import { CMDS, FRAMES, PALETTE, cmdKeyOf, fieldsOf } from './cmds'

describe('mission command table', () => {
  it('takeoff_and_waypoint_have_the_prototype_ids', () => {
    expect(CMDS.TAKEOFF?.id).toBe(22)
    expect(CMDS.WAYPOINT?.id).toBe(16)
    expect(CMDS.WAYPOINT?.mav).toBe('MAV_CMD_NAV_WAYPOINT')
    expect(CMDS.DO_JUMP?.id).toBe(177)
    expect(FRAMES.ter.mav).toBe(10)
    expect(FRAMES.rel.name).toBe('MAV_FRAME_GLOBAL_RELATIVE_ALT')
    expect(cmdKeyOf(20)).toBe('RTL')
    expect(cmdKeyOf(9999)).toBeNull()
    expect(PALETTE.pos).toContain('WAYPOINT')
    expect(PALETTE.cond).toContain('DO_JUMP')
    expect(Object.keys(CMDS)).toHaveLength(27)
  })

  it('fields_mark_params_the_vehicle_ignores_as_unused', () => {
    const copter = fieldsOf('WAYPOINT', 'copter')
    expect(copter.map((f) => [f.key, f.unused])).toEqual([
      ['delay', false],
      ['acceptRadius', true],
      ['passRadius', true],
    ])
    const plane = fieldsOf('WAYPOINT', 'plane')
    expect(plane.find((f) => f.key === 'acceptRadius')?.unused).toBe(false)
    expect(fieldsOf('WAYPOINT', null).every((f) => !f.unused)).toBe(true)
    expect(fieldsOf('NOPE', 'copter')).toEqual([])
  })
})
