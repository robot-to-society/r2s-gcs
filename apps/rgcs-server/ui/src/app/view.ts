export type View = 'ops' | 'video' | 'mission' | 'network' | 'ai' | 'maint' | 'present'

/** Order of the six header buttons (spec 10 §1, 2026-10-18). `present` is a separate route, not a tab. */
export const NAV_VIEWS: readonly View[] = ['ops', 'video', 'mission', 'network', 'ai', 'maint']

/** Views that have an implementation; the rest render disabled (P5 adds the rest). */
export const ENABLED_VIEWS: ReadonlySet<View> = new Set<View>(['ops', 'video', 'mission', 'network', 'maint'])
