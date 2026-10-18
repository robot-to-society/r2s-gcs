import { describe, expect, it } from 'vitest'
import type { Mission } from '../../shared/api/types'
import { missionHomes } from './homes'

const mission = (sysid: number, home: Mission['home']): Mission => ({ id: sysid, name: 'm', sysid, default_alt: 60, default_frame: 'rel', speed: 8, home, items: [] })

describe('missionHomes', () => {
  it('takes each known mission home and skips missing or null-island ones', () => {
    const homes = missionHomes(
      new Map([
        [1, mission(1, { lat: 36.1, lon: 139.3, alt: 400 })],
        [2, mission(2, null)],
        [3, mission(3, { lat: 0, lon: 0, alt: 0 })],
      ]),
    )
    expect([...homes]).toEqual([[1, { lat: 36.1, lon: 139.3 }]])
  })
})
