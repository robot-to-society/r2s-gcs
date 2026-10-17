import { afterEach, describe, expect, it, vi } from 'vitest'
import { readLang, writeLang, LANG_KEY } from './lang'

describe('language persistence', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('defaults to ja and ignores unknown stored values', () => {
    expect(readLang()).toBe('ja')
    localStorage.setItem(LANG_KEY, 'fr')
    expect(readLang()).toBe('ja')
  })

  it('round-trips through localStorage', () => {
    writeLang('en')
    expect(localStorage.getItem(LANG_KEY)).toBe('en')
    expect(readLang()).toBe('en')
  })

  it('survives a throwing storage', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    })
    expect(readLang()).toBe('ja')
    expect(() => writeLang('en')).not.toThrow()
  })
})
