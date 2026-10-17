import type { ButtonFunction, CameraCommand, CameraState, VideoMode } from '../../shared/api/types'

const VIDEO_CYCLE: readonly VideoMode[] = ['rgb', 'thermal', 'side_by_side']

/** The camera command a button function means given the current camera state (spec 40 §6). */
export function buttonCommand(fn: ButtonFunction, state: CameraState | null): CameraCommand | null {
  switch (fn) {
    case 'shutter':
      return { cmd: 'photo' }
    case 'record_toggle':
      return state?.recording === 'recording' ? { cmd: 'record_stop' } : { cmd: 'record_start' }
    case 'center_gimbal':
      return { cmd: 'gimbal_center', args: { mode: 'one_key_reset' } }
    case 'thermal_toggle': {
      const i = VIDEO_CYCLE.indexOf(state?.video_mode ?? 'rgb')
      return { cmd: 'video_mode', args: { mode: VIDEO_CYCLE[(i + 1) % VIDEO_CYCLE.length]! } }
    }
    case 'zoom_in_step':
      return { cmd: 'zoom_step', args: { steps: 1 } }
    case 'zoom_out_step':
      return { cmd: 'zoom_step', args: { steps: -1 } }
    case 'zoom_1x':
      return { cmd: 'zoom_reset' }
    case 'mode_lock':
      return { cmd: 'gimbal_mode', args: { mode: 'lock' } }
    case 'mode_follow':
      return { cmd: 'gimbal_mode', args: { mode: 'follow' } }
    case 'mode_fpv':
      return { cmd: 'gimbal_mode', args: { mode: 'fpv' } }
    case 'mode_cycle': {
      const order = ['lock', 'follow', 'fpv'] as const
      const i = order.indexOf(state?.gimbal_mode ?? 'lock')
      return { cmd: 'gimbal_mode', args: { mode: order[(i + 1) % order.length]! } }
    }
    case 'gimbal_stop':
    case 'none':
      return null
  }
}
