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

  it('raises each fence zone as a wall up to the FENCE_ALT_MAX ceiling (green inclusion, red exclusion)', () => {
    const base = draft([it_(1, 36.16, 30)], { lat: 36.16, lon: 139.37, alt: 400 }) as never as Parameters<typeof missionAirData>[0]
    const fenced = { ...base, mission: { ...base.mission, fence: [{ kind: 'polygon', inclusion: true, vertices: [{ lat: 36.16, lon: 139.37 }, { lat: 36.16, lon: 139.38 }, { lat: 36.17, lon: 139.38 }] }, { kind: 'circle', inclusion: false, center: { lat: 36.165, lon: 139.375 }, radius: 50 }] } } as never
    const plain = missionAirData(fenced, new Set(), () => 100)
    const walled = missionAirData(fenced, new Set(), () => 100, 120)
    expect(walled.lines.length).toBe(plain.lines.length + 2) // a top ring per zone
    const ring = walled.lines.at(-2)!
    expect(ring).toHaveLength(4) // closed triangle
    expect(ring[0]!.z).toBeCloseTo(toMercator(139.37, 36.16, 220).z, 12)
    expect(ring[0]!.c).toEqual([0x5f / 255, 0xd3 / 255, 0x9b / 255])
    expect(walled.lines.at(-1)![0]!.c).toEqual([1, 0x69 / 255, 0x61 / 255])
    expect(walled.posts.length).toBe(plain.posts.length + 3 + 4) // polygon vertices + 4 around the circle
  })

  it('without a mission home or items the walls stand on the vehicle\'s home (FENCE_ALT_MAX is above it)', () => {
    const empty = draft([]) as never as Parameters<typeof missionAirData>[0]
    const fenced = { ...empty, mission: { ...empty.mission, fence: [{ kind: 'circle', inclusion: true, center: { lat: 36.165, lon: 139.375 }, radius: 50 }] } } as never
    expect(missionAirData(fenced, new Set(), () => 100, 120).lines).toHaveLength(0)
    const walled = missionAirData(fenced, new Set(), () => 100, 120, { lat: 36.16, lon: 139.37 })
    expect(walled.lines).toHaveLength(1)
    expect(walled.lines[0]![0]!.z).toBeCloseTo(toMercator(139.375, 36.165 + 50 / 110_540, 220).z, 9)
  })
  it('adds the predicted flight path as a thin translucent line above the home ground (posts pass)', () => {
    const home = { lat: 36.16, lon: 139.37 }
    const points = [{ ...home, alt: 0 }, { ...home, alt: 40 }, { lat: 36.161, lon: 139.37, alt: 40 }]
    const d = missionAirData(draft([]) as never, new Set(), () => 100, null, null, { home, points })
    expect(d.lines).toHaveLength(0)
    expect(d.posts).toHaveLength(1)
    expect(d.posts[0]!.map((v) => v.z)).toEqual(points.map((p) => toMercator(p.lon, p.lat, 100 + p.alt).z))
    expect(missionAirData(draft([]) as never, new Set(), () => null, null, null, { home, points }).posts).toHaveLength(0)
  })
})
