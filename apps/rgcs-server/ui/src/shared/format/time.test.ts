import { describe, expect, it } from 'vitest'
import { hhmm, hhmmss, jstDateTime, jstTime } from './time'

describe('clock formats', () => {
  it('pads hours, minutes and seconds in local time', () => {
    const ts = new Date(2026, 9, 18, 9, 5, 7).getTime()
    expect(hhmm(ts)).toBe('09:05')
    expect(hhmmss(ts)).toBe('09:05:07')
  })
})

describe('JST formats', () => {
  it('formats unix ms in Asia/Tokyo whatever the browser zone', () => {
    expect(jstTime(1_761_400_000_000)).toBe('22:46:40')
    expect(jstDateTime(1_761_400_000_000)).toBe('2025-10-25 22:46')
    expect(jstTime(Date.UTC(2026, 0, 1, 15, 0, 0))).toBe('00:00:00')
  })
})
