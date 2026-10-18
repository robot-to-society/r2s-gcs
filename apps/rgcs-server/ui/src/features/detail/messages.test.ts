import { describe, expect, it } from 'vitest'
import type { LogEntry } from '../../shared/api/types'
import { lastForVehicle, pendingAlerts } from './messages'

const e = (id: number, over: Partial<LogEntry> = {}): LogEntry => ({ id, ts: id, sysid: 1, source: 'vehicle', severity: 'warn', text: `m${id}`, ackable: true, acked_by: null, acked_at: null, ...over })

describe('detail messages', () => {
  it('takes the newest three of one vehicle', () => {
    const list = [e(5), e(4, { sysid: 2 }), e(3), e(2), e(1)]
    expect(lastForVehicle(list, 1).map((x) => x.id)).toEqual([5, 3, 2])
  })

  it('counts ackable alerts that nobody acknowledged', () => {
    const list = [e(4), e(3, { acked_by: 'admin', acked_at: 1 }), e(2, { ackable: false, source: 'command', severity: 'error' }), e(1, { sysid: 2 })]
    expect(pendingAlerts(list, 1)).toBe(1)
  })
})
