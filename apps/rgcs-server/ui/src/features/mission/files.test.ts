import { describe, expect, it } from 'vitest'
import type { Mission } from '../../shared/api/types'
import { parseRgcsMission, serializeRgcsMission } from './files'

const mission: Mission = {
  id: 3,
  name: 'm',
  sysid: 1,
  default_alt: 50,
  default_frame: 'rel',
  speed: 8,
  home: { lat: 36.162, lon: 139.372, alt: 0 },
  items: [{ command: 22, frame: 'rel', params: [0, 0, 0, 0], lat: 36.162, lon: 139.372, alt: 30, autocontinue: true }],
}

describe('.rgcsmission files', () => {
  it('rgcsmission_round_trips_and_rejects_bad_json', () => {
    const text = serializeRgcsMission(mission)
    expect(text).toContain('"format": "rgcsmission"')
    const back = parseRgcsMission(text)
    expect(back).toEqual({ ...mission, id: null })
    expect(() => parseRgcsMission('{"nope":1}')).toThrow()
    expect(() => parseRgcsMission('not json')).toThrow()
    expect(() => parseRgcsMission(JSON.stringify({ format: 'rgcsmission', mission: { ...mission, items: [{ command: 'x' }] } }))).toThrow()
  })
})
