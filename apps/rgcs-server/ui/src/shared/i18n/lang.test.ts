import { afterEach, describe, expect, it, vi } from 'vitest'
import { readLang, writeLang, LANG_KEY } from './lang'
import { dictionaries } from './index'
import { aiEn, aiJa } from './ai'

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

describe('dictionaries', () => {
  it('ja and en carry the same non-empty keys', () => {
    const ja = Object.keys(dictionaries.ja).sort()
    expect(Object.keys(dictionaries.en).sort()).toEqual(ja)
    for (const lang of ['ja', 'en'] as const) for (const k of ja) expect(dictionaries[lang][k as keyof typeof dictionaries.ja], `${lang}.${k}`).not.toBe('')
  })

  it('carries the network view strings', () => {
    expect(dictionaries.ja).toMatchObject({ netTitle: 'ネットワーク', netLoadFailed: 'ネットワーク情報を取得できません', netUnconfigured: '未構成' })
    expect(dictionaries.en).toHaveProperty('netLoadFailed')
  })

  it('carries the AI chat strings in both languages', () => {
    for (const k of Object.keys(aiJa)) expect(aiEn, k).toHaveProperty(k)
    expect(dictionaries.ja).toMatchObject({ aiTitle: 'AI', aiTarget: '対象', aiThinking: '考えています…', aiUnconfigured: 'AI は未設定です（config.toml の [ai]）', aiAgo: '{n} 秒前' })
    expect(dictionaries.en).toHaveProperty('aiProposalLabel')
  })
})
