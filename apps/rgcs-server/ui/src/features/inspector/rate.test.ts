import { describe, expect, it } from 'vitest'
import { intervalCommand, intervalUs, MAV_CMD_SET_MESSAGE_INTERVAL, parseHz } from './rate'

describe('parseHz', () => {
  it('accepts 0 < hz <= 50', () => {
    expect(parseHz('10')).toBe(10)
    expect(parseHz(' 0.5 ')).toBe(0.5)
    expect(parseHz('50')).toBe(50)
  })
  it('rejects empty, zero, negative, non-numeric, infinite and > 50', () => {
    for (const s of ['', ' ', '0', '-1', 'abc', 'Infinity', 'NaN', '50.1', '1e9']) expect(parseHz(s)).toBeNull()
  })
})

describe('intervalCommand', () => {
  it('maps hz to microseconds', () => {
    expect(intervalUs(10)).toBe(100000)
    expect(intervalUs(3)).toBe(333333)
  })
  it('builds SET_MESSAGE_INTERVAL (511) as an other command', () => {
    expect(MAV_CMD_SET_MESSAGE_INTERVAL).toBe(511)
    expect(intervalCommand(30, 100000)).toEqual({ cmd: 'other', args: { mav_cmd: 511, params: [30, 100000, 0, 0, 0, 0, 0] } })
  })
})
