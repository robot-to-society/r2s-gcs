import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_LTE_OVERLAY, LTE_OVERLAY_KEY, LteOverlayStore } from './prefs'

const memory = (init: Record<string, string> = {}) => {
  const items = { ...init }
  return { getItem: (k: string) => items[k] ?? null, setItem: (k: string, v: string) => void (items[k] = v), items }
}

describe('LTE overlay prefs', () => {
  it('is_off_at_60_percent_by_default', () => {
    expect(DEFAULT_LTE_OVERLAY).toEqual({ on: false, opacity: 60 })
    expect(new LteOverlayStore(memory()).getState()).toEqual({ on: false, opacity: 60 })
  })

  it('remembers_the_switch_and_the_opacity_in_the_browser', () => {
    const storage = memory()
    const s = new LteOverlayStore(storage)
    const listener = vi.fn()
    s.subscribe(listener)
    s.toggle()
    s.setOpacity(35)
    expect(listener).toHaveBeenCalledTimes(2)
    expect(JSON.parse(storage.items[LTE_OVERLAY_KEY]!)).toEqual({ on: true, opacity: 35 })
    expect(new LteOverlayStore(storage).getState()).toEqual({ on: true, opacity: 35 })
  })

  it('keeps_the_opacity_between_10_and_100_percent', () => {
    const s = new LteOverlayStore(memory())
    s.setOpacity(3)
    expect(s.getState().opacity).toBe(10)
    s.setOpacity(250)
    expect(s.getState().opacity).toBe(100)
    s.setOpacity(42.6)
    expect(s.getState().opacity).toBe(43)
    s.setOpacity(Number.NaN)
    expect(s.getState().opacity).toBe(43)
  })

  it('a_state_object_is_never_mutated', () => {
    const s = new LteOverlayStore(memory())
    const before = s.getState()
    s.toggle()
    expect(before).toEqual({ on: false, opacity: 60 })
    expect(s.getState()).not.toBe(before)
  })

  it('falls_back_to_the_defaults_on_a_corrupt_or_blocked_storage', () => {
    expect(new LteOverlayStore(memory({ [LTE_OVERLAY_KEY]: '{' })).getState()).toEqual(DEFAULT_LTE_OVERLAY)
    expect(new LteOverlayStore(memory({ [LTE_OVERLAY_KEY]: '{"on":"yes","opacity":50}' })).getState()).toEqual(DEFAULT_LTE_OVERLAY)
    expect(new LteOverlayStore(memory({ [LTE_OVERLAY_KEY]: '{"on":true,"opacity":500}' })).getState()).toEqual({ on: true, opacity: 100 })
    const broken = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
    const s = new LteOverlayStore(broken)
    expect(s.getState()).toEqual(DEFAULT_LTE_OVERLAY)
    expect(() => s.toggle()).not.toThrow()
    expect(s.getState().on).toBe(true)
  })
})
