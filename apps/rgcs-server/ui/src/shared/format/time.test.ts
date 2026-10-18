import { describe, expect, it } from 'vitest'
import { hhmm, hhmmss } from './time'

describe('clock formats', () => {
  it('pads hours, minutes and seconds in local time', () => {
    const ts = new Date(2026, 9, 18, 9, 5, 7).getTime()
    expect(hhmm(ts)).toBe('09:05')
    expect(hhmmss(ts)).toBe('09:05:07')
  })
})
