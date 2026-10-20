import { describe, expect, it, vi } from 'vitest'
import type { FenceZone, Mission, RallyPoint, UploadReport } from '../../shared/api/types'
import { emptyDraft, toMission } from '../mission/model'
import { leftovers, runBatch, type BatchDeps, type BatchJob, type BatchState } from './batch'

const ZONE: FenceZone = { kind: 'circle', inclusion: true, center: { lat: 35, lon: 139 }, radius: 100 }
const RALLY: RallyPoint = { lat: 35, lon: 139, alt: 30 }
const mission = (name: string, extra: Partial<Mission> = {}): Mission => ({ ...toMission(emptyDraft()), name, ...extra })
const job = (key: string, sysid: number, m: Mission = mission(key), clear = { fence: false, rally: false }): BatchJob => ({ key, sysid, mission: m, clearFence: clear.fence, clearRally: clear.rally })
const report = (verified = true): UploadReport => ({ items: 1, verified, mismatched: verified ? [] : [2], findings: [] })

function deps(over: Partial<BatchDeps> = {}): BatchDeps {
  return {
    validate: vi.fn(async () => ({ findings: [], stats: { distance_m: 0, duration_s: 0, max_alt: 0 } })) as unknown as BatchDeps['validate'],
    upload: vi.fn(async () => report()),
    writeFence: vi.fn(async () => report()),
    writeRally: vi.fn(async () => report()),
    connected: () => true,
    ...over,
  }
}

const finals = (states: BatchState[]) => {
  const last = new Map<string, BatchState>()
  for (const s of states) last.set(s.key, s)
  return [...last.values()].map((s) => [s.key, s.phase, s.reason])
}

describe('runBatch', () => {
  it('writes_each_job_in_order_and_continues_after_a_failure', async () => {
    const d = deps({ connected: (sysid) => sysid !== 2 })
    const states: BatchState[] = []
    await runBatch([job('a', 1), job('b', 2), job('c', 3)], d, (s) => states.push(s))
    expect(finals(states)).toEqual([
      ['a', 'done', null],
      ['b', 'failed', 'offline'],
      ['c', 'done', null],
    ])
    expect(vi.mocked(d.upload).mock.calls.map((c) => c[0])).toEqual([1, 3])
    // every job is announced as waiting first, then written one at a time
    expect(states.slice(0, 3).map((s) => s.phase)).toEqual(['waiting', 'waiting', 'waiting'])
    expect(states.filter((s) => s.key === 'a').map((s) => s.phase)).toEqual(['waiting', 'writing', 'done'])
  })

  it('fatal_validation_stops_only_that_job', async () => {
    const validate = vi.fn(async (_m: Mission, sysid: number | null) => ({
      findings: sysid === 1 ? [{ level: 'fatal' as const, code: 'x', seq: null, message: 'x' }] : [],
      stats: { distance_m: 0, duration_s: 0, max_alt: 0 },
    }))
    const d = deps({ validate: validate as unknown as BatchDeps['validate'], upload: vi.fn(async (sysid: number) => report(sysid !== 3)) })
    const states: BatchState[] = []
    await runBatch([job('a', 1), job('b', 2), job('c', 3), job('e', 4)], d, (s) => states.push(s))
    expect(finals(states)).toEqual([
      ['a', 'failed', 'fatal'],
      ['b', 'done', null],
      ['c', 'failed', 'mismatch'],
      ['e', 'done', null],
    ])
    expect(vi.mocked(d.upload).mock.calls.map((c) => c[0])).toEqual([2, 3, 4])
  })

  it('reports_a_thrown_error_with_its_message_and_continues', async () => {
    const d = deps({ upload: vi.fn(async (sysid: number) => (sysid === 1 ? Promise.reject(new Error('timeout')) : report())) })
    const states: BatchState[] = []
    await runBatch([job('a', 1), job('b', 2)], d, (s) => states.push(s))
    expect(finals(states)).toEqual([
      ['a', 'failed', 'timeout'],
      ['b', 'done', null],
    ])
  })

  it('clear_flags_write_empty_fence_and_rally_only_when_the_mission_has_none', async () => {
    const d = deps()
    const withBoth = mission('a', { fence: [ZONE], rally: [RALLY] })
    await runBatch(
      [job('a', 1, withBoth, { fence: true, rally: true }), job('b', 2, mission('b'), { fence: true, rally: false }), job('c', 3, mission('c'), { fence: false, rally: true }), job('e', 4)],
      d,
      () => {},
    )
    expect(vi.mocked(d.writeFence).mock.calls).toEqual([
      [1, [ZONE]],
      [2, []],
    ])
    expect(vi.mocked(d.writeRally).mock.calls).toEqual([
      [1, [RALLY]],
      [3, []],
    ])
  })
})

describe('leftovers', () => {
  it('leftovers_reads_only_what_is_needed_and_reports_unknown_on_error', async () => {
    const fence = vi.fn(async (sysid: number) => (sysid === 3 ? Promise.reject(new Error('no link')) : { zones: sysid === 2 ? [ZONE, ZONE] : [] }))
    const rally = vi.fn(async (sysid: number) => ({ points: sysid === 2 ? [RALLY] : [] }))
    const got = await leftovers(
      [
        { sysid: 1, mission: mission('a', { fence: [ZONE], rally: [RALLY] }) },
        { sysid: 2, mission: mission('b') },
        { sysid: 3, mission: mission('c', { rally: [RALLY] }) },
      ],
      { fence, rally },
    )
    expect(fence.mock.calls.map((c) => c[0])).toEqual([2, 3])
    expect(rally.mock.calls.map((c) => c[0])).toEqual([2])
    expect(got.has(1)).toBe(false)
    expect(got.get(2)).toEqual({ fence: 2, rally: 1 })
    expect(got.get(3)).toEqual({ fence: null, rally: 0 })
  })
})
