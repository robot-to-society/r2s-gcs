// Copy for the MAVLink camera driver (spec 10 §3.3 / §5, spec 40 §2 `mavlink_cam`, spec 50 §1).

export const mavlinkCameraJa = {
  mavlinkCamera: 'MAVLink カメラ',
  compId: 'コンポーネント ID',
  rtspUrl: 'RTSP URL',
  camErr_camera_rejected: 'カメラがコマンドを拒否しました',
  roiNativeNote: 'ArduPilot がジンバルを目標に向けます',
} as const

export const mavlinkCameraEn: Record<keyof typeof mavlinkCameraJa, string> = {
  mavlinkCamera: 'MAVLink camera',
  compId: 'Component ID',
  rtspUrl: 'RTSP URL',
  camErr_camera_rejected: 'The camera refused the command',
  roiNativeNote: 'ArduPilot points the gimbal at the target',
}
