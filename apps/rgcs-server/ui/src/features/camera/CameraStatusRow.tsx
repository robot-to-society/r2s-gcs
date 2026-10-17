import type { CameraCaps, CameraState, GimbalMode } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { angleText } from './format'

interface Props {
  readonly caps: CameraCaps
  readonly state: CameraState
  readonly onSetup: () => void
  readonly dict: Dict
}

const MODE: Record<GimbalMode, string> = { lock: 'Lock', follow: 'Follow', fpv: 'FPV' }

/** Spec 10 §3.3 item 4: "Lock | ↔ yaw ↕ pitch", or the setup prompt when no camera. */
export function CameraStatusRow({ caps, state, onSetup, dict }: Props) {
  if (caps.kind === 'none') {
    return (
      <div className="cam-status" data-testid="cam-status">
        <span>{dict.cameraNotConfigured}</span>
        <span className="sep" />
        <button type="button" className="btn btn-sm btn-ghost" onClick={onSetup}>
          {dict.setUp}
        </button>
      </div>
    )
  }
  return (
    <div className="cam-status" data-testid="cam-status">
      {!state.connected && <span className="danger">{dict.disconnected}</span>}
      {state.connected && <span>{state.gimbal_mode ? MODE[state.gimbal_mode] : '—'}</span>}
      {caps.gimbal?.attitude && state.gimbal && (
        <>
          <span className="sep" />
          <span className="num">↔ {angleText(state.gimbal.yaw)}</span>
          <span className="num">↕ {angleText(state.gimbal.pitch)}</span>
        </>
      )}
    </div>
  )
}
