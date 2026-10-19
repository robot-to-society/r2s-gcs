import { describe, expect, it } from 'vitest'
import { toMercator } from '../map/air'
import type { DraftItem } from './model'
import { missionAirData } from './missionAir'

const it_ = (uid: number, lat: number, alt: number, frame: DraftItem['frame'] = 'rel', command = 16): DraftItem => ({ uid, command, frame, params: [0, 0, 0, 0], lat, lon: 139.37, alt, autocontinue: true })
const draft = (items: DraftItem[], home: { lat: number; lon: number; alt: number } | null = null) => ({ mission: { id: null, name: 'm', sysid: null, default_alt: 60, default_frame: 'rel' as const, speed: 8, home, items: [] }, items, nextUid: 99 })
const POST: readonly number[] = [0xbf / 255, 0xe0 / 255, 1]
const AMBER: readonly number[] = [0xf2 / 255, 0xb5 / 255, 0x44 / 255]

describe('missionAirData', () => {
  it('draws one altitude line per leg at the item altitudes', () => {
    const d = missionAirData(draft([it_(1, 36.16, 30), it_(2, 36.161, 80)]) as never, new Set(), () => 100)
    expect(d.lines).toHaveLength(1)
    const line = d.lines[0]!
    expect(line[0]!.z).toBeCloseTo(toMercator(139.37, 36.16, 130).z, 12)
    expect(line.at(-1)!.z).toBeCloseTo(toMercator(139.37, 36.161, 180).z, 12)
    expect(d.alts.get(1)).toBe(130)
  })
  it('colours each leg by its climb: level cyan, steep climb red', () => {
    // 0.001° latitude ≈ 111 m: +0 m level, +200 m steep
    const d = missionAirData(draft([it_(1, 36.16, 50), it_(2, 36.161, 50), it_(3, 36.162, 250)]) as never, new Set(), () => 100)
    expect(d.lines[0]!.every((v) => v.c[0] === 0x9c / 255)).toBe(true)
    expect(d.lines[1]!.every((v) => v.c[0] === 1 && v.c[1] === 0x69 / 255)).toBe(true)
  })
  it('colours a terrain-following leg by the slope it actually flies', () => {
    // ground rises 100 m over the first half (≈ 50 m) then stays flat
    const ground = (_lon: number, lat: number) => (lat < 36.16045 ? 100 + ((lat - 36.16) / 0.00045) * 100 : 200)
    const d = missionAirData(draft([it_(1, 36.16, 40, 'ter'), it_(2, 36.16089, 40, 'ter')]) as never, new Set(), ground)
    const line = d.lines[0]!
    expect(line[0]!.c).toEqual([1, 0x69 / 255, 0x61 / 255])
    expect(line.at(-2)!.c).toEqual([0x9c / 255, 0xc9 / 255, 1])
  })
  it('subdivides a terrain-following leg every 20 m', () => {
    // 0.00089° latitude ≈ 99 m → 5 segments
    const d = missionAirData(draft([it_(1, 36.16, 40, 'ter'), it_(2, 36.16089, 40, 'ter')]) as never, new Set(), () => 100)
    expect(d.lines[0]).toHaveLength(6)
  })
  it('gives each positioned item a post, amber when selected', () => {
    const d = missionAirData(draft([it_(1, 36.16, 30), it_(2, 36.161, 80), it_(3, 0, 0, 'rel', 178)]) as never, new Set([2]), () => 100)
    expect(d.posts).toHaveLength(2)
    expect(d.posts[0]![0]!.c).toEqual(POST)
    expect(d.posts[1]![0]!.c).toEqual(AMBER)
    expect(d.discs.features.map((f) => f.properties.sel)).toEqual([0, 1])
  })
  it('starts at the home when the mission has one', () => {
    const d = missionAirData(draft([it_(1, 36.161, 30)], { lat: 36.16, lon: 139.37, alt: 400 }) as never, new Set(), () => 100)
    expect(d.lines).toHaveLength(1)
    expect(d.lines[0]![0]!.z).toBeCloseTo(toMercator(139.37, 36.16, 100).z, 12)
  })
  it('draws nothing (and no NaN) while the ground is unknown', () => {
    const d = missionAirData(draft([it_(1, 36.16, 30), it_(2, 36.161, 80)]) as never, new Set(), () => null)
    expect(d.lines).toHaveLength(0)
    expect(d.posts).toHaveLength(0)
    expect(d.alts.get(1)).toBeNull()
  })
  it('knows the altitude at each mid-leg handle', () => {
    const d = missionAirData(draft([it_(1, 36.16, 30), it_(2, 36.161, 80)]) as never, new Set(), () => 100)
    expect(d.mids).toEqual([155])
  })
})
