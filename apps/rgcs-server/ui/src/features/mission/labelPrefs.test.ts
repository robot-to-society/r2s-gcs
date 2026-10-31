import { describe, expect, it } from 'vitest'
import { DEFAULT_LABELS, LABELS_KEY, LabelPrefsStore, labelClasses } from './labelPrefs'

const memory = (init: Record<string, string> = {}) => {
  const items = { ...init }
  return { getItem: (k: string) => items[k] ?? null, setItem: (k: string, v: string) => void (items[k] = v), items }
}

describe('label prefs', () => {
  it('both_labels_show_by_default', () => {
    expect(new LabelPrefsStore(memory()).getState()).toEqual({ wpNumbers: true, altitudes: true })
    expect(DEFAULT_LABELS).toEqual({ wpNumbers: true, altitudes: true })
  })

  it('a_toggle_is_remembered_in_the_browser', () => {
    const storage = memory()
    const s = new LabelPrefsStore(storage)
    s.toggle('wpNumbers')
    expect(s.getState()).toEqual({ wpNumbers: false, altitudes: true })
    expect(JSON.parse(storage.items[LABELS_KEY]!)).toEqual({ wpNumbers: false, altitudes: true })
    expect(new LabelPrefsStore(storage).getState()).toEqual({ wpNumbers: false, altitudes: true })
  })

  it('a_corrupt_or_unreadable_entry_falls_back_to_the_defaults', () => {
    expect(new LabelPrefsStore(memory({ [LABELS_KEY]: '{' })).getState()).toEqual(DEFAULT_LABELS)
    expect(new LabelPrefsStore(memory({ [LABELS_KEY]: '{"wpNumbers":"no"}' })).getState()).toEqual(DEFAULT_LABELS)
    const broken = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
    const s = new LabelPrefsStore(broken)
    expect(s.getState()).toEqual(DEFAULT_LABELS)
    expect(() => s.toggle('altitudes')).not.toThrow()
    expect(s.getState().altitudes).toBe(false)
  })

  it('hidden_labels_become_classes_on_the_planner', () => {
    expect(labelClasses({ wpNumbers: true, altitudes: true })).toBe('')
    expect(labelClasses({ wpNumbers: false, altitudes: false })).toBe(' labels-no-num labels-no-alt')
  })
})
