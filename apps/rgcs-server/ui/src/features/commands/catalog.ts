import type { VehicleCommand, VehicleState } from '../../shared/api/types'

/** Mirror of `rgcs-core::VehicleCommand::requires_confirm` (spec 70 §1); pinned by catalog.test. */
export const REQUIRES_CONFIRM: ReadonlySet<string> = new Set(['arm', 'disarm', 'mission_start'])

/** Commands whose confirm button is rendered as danger. */
export const DESTRUCTIVE: ReadonlySet<string> = new Set(['arm', 'disarm', 'rtl', 'land'])

/** Per airframe: `quick` are the one-click chips above the command groups (operator proposal 5,
 * the modes used most); `all` is the 「モード変更」 list. Names match rgcs-mavlink's mode tables. */
export interface FrameModes {
  readonly quick: readonly string[]
  readonly all: readonly string[]
}

const PLANE_ALL = ['MANUAL', 'STABILIZE', 'ACRO', 'TRAINING', 'FBWA', 'FBWB', 'CRUISE', 'AUTOTUNE', 'TAKEOFF', 'LOITER', 'CIRCLE', 'GUIDED', 'AUTO', 'RTL', 'THERMAL']

const MODES: Readonly<Record<'copter' | 'plane' | 'quadplane' | 'rover', FrameModes>> = {
  copter: {
    quick: ['STABILIZE', 'ALT_HOLD', 'LOITER', 'POSHOLD', 'GUIDED', 'AUTO', 'RTL', 'LAND'],
    all: ['STABILIZE', 'ALT_HOLD', 'LOITER', 'POSHOLD', 'BRAKE', 'GUIDED', 'AUTO', 'CIRCLE', 'RTL', 'SMART_RTL', 'LAND', 'ACRO', 'SPORT', 'DRIFT', 'AUTOTUNE'],
  },
  plane: { quick: ['MANUAL', 'FBWA', 'FBWB', 'CRUISE', 'LOITER', 'GUIDED', 'AUTO', 'RTL'], all: PLANE_ALL },
  quadplane: {
    quick: ['QHOVER', 'QLOITER', 'QLAND', 'QRTL', 'FBWA', 'LOITER', 'AUTO', 'RTL'],
    all: [...PLANE_ALL, 'QSTABILIZE', 'QHOVER', 'QLOITER', 'QLAND', 'QRTL', 'QAUTOTUNE', 'QACRO'],
  },
  rover: {
    quick: ['MANUAL', 'ACRO', 'HOLD', 'LOITER', 'GUIDED', 'AUTO', 'RTL', 'SMART_RTL'],
    all: ['MANUAL', 'ACRO', 'STEERING', 'HOLD', 'LOITER', 'FOLLOW', 'SIMPLE', 'CIRCLE', 'GUIDED', 'AUTO', 'RTL', 'SMART_RTL', 'DOCK'],
  },
}

/** The modes for a vehicle; 'other' gets the copter set, like its icon and model. */
export function modesFor(v: Pick<VehicleState, 'kind' | 'vtol'>): FrameModes {
  if (v.kind === 'plane') return v.vtol ? MODES.quadplane : MODES.plane
  return v.kind === 'rover' ? MODES.rover : MODES.copter
}

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
