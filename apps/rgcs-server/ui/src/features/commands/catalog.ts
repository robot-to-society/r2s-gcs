import type { VehicleCommand, VehicleState } from '../../shared/api/types'

/** Mirror of `rgcs-core::VehicleCommand::requires_confirm` (spec 70 §1); pinned by catalog.test. */
export const REQUIRES_CONFIRM: ReadonlySet<string> = new Set(['arm', 'disarm', 'mission_start'])

/** Commands whose confirm button is rendered as danger. */
export const DESTRUCTIVE: ReadonlySet<string> = new Set(['arm', 'disarm', 'rtl', 'land'])

/** One-click mode chips above the command groups (operator proposal 5). */
export const QUICK_MODES: readonly string[] = ['LOITER', 'GUIDED', 'AUTO', 'RTL']

export const COPTER_MODES: readonly string[] = ['STABILIZE', 'ALT_HOLD', 'LOITER', 'AUTO', 'GUIDED', 'RTL', 'LAND', 'BRAKE', 'POSHOLD']

export type CommandGroup = 'flight' | 'move' | 'mode' | 'payload'
export type ModalTarget = 'guided' | 'camera'

export interface BuildCtx {
  readonly mode?: string
  readonly value?: number
}

export interface CatalogItem {
  readonly name: string
  readonly group: CommandGroup
  readonly enabled: (v: VehicleState) => boolean
  /** Present for commands sent through the queue; absent for items that open a modal. */
  readonly build?: (ctx: BuildCtx) => VehicleCommand | null
  readonly opens?: ModalTarget
  /** Inline parameter the sheet renders before the button. */
  readonly param?: 'mode' | 'alt' | 'speed'
}

export function commandName(c: VehicleCommand): string {
  return c.cmd
}

const always = () => true
const simple = (cmd: 'pause' | 'resume' | 'rtl' | 'land' | 'mission_start' | 'mission_resume' | 'arm' | 'disarm') => (): VehicleCommand => ({ cmd })

export const CATALOG: readonly CatalogItem[] = [
  { name: 'pause', group: 'flight', enabled: always, build: simple('pause') },
  { name: 'resume', group: 'flight', enabled: always, build: simple('resume') },
  { name: 'rtl', group: 'flight', enabled: always, build: simple('rtl') },
  { name: 'land', group: 'flight', enabled: always, build: simple('land') },
  { name: 'guided', group: 'move', enabled: always, opens: 'guided' },
  {
    name: 'change_alt',
    group: 'move',
    enabled: always,
    param: 'alt',
    build: ({ value }) => (value === undefined || Number.isNaN(value) ? null : { cmd: 'change_alt', args: { alt_rel: value } }),
  },
  {
    name: 'change_speed',
    group: 'move',
    enabled: always,
    param: 'speed',
    build: ({ value }) => (value === undefined || Number.isNaN(value) ? null : { cmd: 'change_speed', args: { mps: value } }),
  },
  { name: 'set_mode', group: 'mode', enabled: always, param: 'mode', build: ({ mode }) => (mode ? { cmd: 'set_mode', args: { mode } } : null) },
  { name: 'mission_start', group: 'mode', enabled: always, build: simple('mission_start') },
  { name: 'mission_resume', group: 'mode', enabled: always, build: simple('mission_resume') },
  // Prototype order: arm / disarm / camera / other under 機体・ペイロード.
  { name: 'arm', group: 'payload', enabled: (v) => !v.armed, build: simple('arm') },
  { name: 'disarm', group: 'payload', enabled: (v) => v.armed, build: simple('disarm') },
  { name: 'camera', group: 'payload', enabled: () => false, opens: 'camera' },
  { name: 'other', group: 'payload', enabled: () => false },
]

const GROUP_ORDER: readonly CommandGroup[] = ['flight', 'move', 'mode', 'payload']

export function catalogGroups(items: readonly CatalogItem[] = CATALOG): readonly { group: CommandGroup; items: readonly CatalogItem[] }[] {
  return GROUP_ORDER.map((group) => ({ group, items: items.filter((i) => i.group === group) })).filter((g) => g.items.length > 0)
}
