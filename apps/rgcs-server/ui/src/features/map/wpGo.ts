import type { VehicleCommand } from '../../shared/api/types'

/** MAV_CMD_DO_SET_MISSION_CURRENT: param1 is the mission seq to continue from. */
export const MAV_CMD_DO_SET_MISSION_CURRENT = 224

/** A clicked mission badge: its owner, its number and where it sits in the viewport. */
export interface WaypointPick {
  readonly sysid: number
  /** The badge number: items are 1-based and seq 0 is home, so it equals the MAVLink seq. */
  readonly n: number
  readonly x: number
  readonly y: number
}

/** "Go to WP n": the mission continues from seq n; the flight mode is left as it is. */
export function wpGoCommand(n: number): VehicleCommand {
  return { cmd: 'other', args: { mav_cmd: MAV_CMD_DO_SET_MISSION_CURRENT, params: [n, 0, 0, 0, 0, 0, 0] } }
}
