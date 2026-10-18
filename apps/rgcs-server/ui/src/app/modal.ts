import type { VehicleCommand } from '../shared/api/types'

export type Modal =
  | { readonly kind: 'none' }
  | { readonly kind: 'commands'; readonly sysid: number }
  | { readonly kind: 'confirm'; readonly sysid: number; readonly command: VehicleCommand; readonly message?: string }
  | { readonly kind: 'guided'; readonly sysid: number }
  | { readonly kind: 'camera-settings'; readonly sysid: number }
  | { readonly kind: 'present-settings' }
  | { readonly kind: 'mission-pick'; readonly sysid: number }

export const NO_MODAL: Modal = { kind: 'none' }
