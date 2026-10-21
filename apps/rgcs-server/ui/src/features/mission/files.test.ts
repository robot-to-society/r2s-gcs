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
  fence: [
    { kind: 'circle', inclusion: true, center: { lat: 36.162, lon: 139.372 }, radius: 300 },
    { kind: 'polygon', inclusion: false, vertices: [{ lat: 36.16, lon: 139.37 }, { lat: 36.16, lon: 139.38 }, { lat: 36.17, lon: 139.38 }] },
  ],
  rally: [{ lat: 36.163, lon: 139.373, alt: 60 }],
  surveys: [],
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

  it('rgcsmission_keeps_the_fence_and_rally_and_reads_older_files_without_them', () => {
    expect(parseRgcsMission(serializeRgcsMission(mission))).toEqual({ ...mission, id: null })
    const old = JSON.parse(serializeRgcsMission(mission))
    delete old.mission.fence
    delete old.mission.rally
    const read = parseRgcsMission(JSON.stringify(old))
    expect([read.fence, read.rally]).toEqual([[], []])
    const bad = JSON.parse(serializeRgcsMission(mission))
    bad.mission.fence[0].radius = 'x'
    expect(() => parseRgcsMission(JSON.stringify(bad))).toThrow()
  })
})
