import { useSyncExternalStore } from 'react'
import type { Lang } from './index'

export const LANG_KEY = 'rgcs.lang'
const LANGS: readonly Lang[] = ['ja', 'en']

function isLang(v: unknown): v is Lang {
  return typeof v === 'string' && (LANGS as readonly string[]).includes(v)
}

/** Per-browser preference; storage may be blocked, so every access is guarded. */
export function readLang(): Lang {
  try {
    const stored = localStorage.getItem(LANG_KEY)
    return isLang(stored) ? stored : 'ja'
  } catch {
    return 'ja'
  }
}

export function writeLang(lang: Lang): void {
  try {
    localStorage.setItem(LANG_KEY, lang)
  } catch {
    // storage blocked: the choice lives for this page only
  }
}

let current: Lang = readLang()
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setLang(lang: Lang): void {
  if (lang === current) return
  current = lang
  writeLang(lang)
  listeners.forEach((l) => l())
}

export function useLang(): [Lang, (lang: Lang) => void] {
  const lang = useSyncExternalStore(subscribe, () => current, () => current)
  return [lang, setLang]
}
