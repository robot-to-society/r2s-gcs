export type View = 'ops' | 'video' | 'mission' | 'ai' | 'maint' | 'present'

/** Order of the five header buttons (spec 10 §1). `present` is a separate route, not a tab. */
export const NAV_VIEWS: readonly View[] = ['ops', 'video', 'mission', 'ai', 'maint']

/** Views that have an implementation; the rest render disabled (P2/P3 extend this). */
export const ENABLED_VIEWS: ReadonlySet<View> = new Set<View>(['ops', 'mission'])
