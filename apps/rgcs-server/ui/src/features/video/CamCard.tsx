import type { CameraCaps, CameraState } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { dialOffset, gimbalText } from './cockpitView'

interface Props {
  readonly caps: CameraCaps
  readonly state: CameraState
  readonly videoText: string
  readonly dict: Dict
}

/** Prototype `.cam-card`: gimbal dial + rows; rows the camera cannot report are left out (spec 10 §4.2). */
export function CamCard({ caps, state, videoText, dict }: Props) {
  const att = caps.gimbal?.attitude && state.gimbal ? state.gimbal : null
  const dial = dialOffset(att)
  return (
    <div className="surface cam-card">
      {att && (
        <div className="cam-dial" title={dict.gimbal}>
          <span className="nose" />
          <span className="pt" style={{ transform: `translate(${dial.x}px, ${dial.y}px)` }} />
        </div>
      )}
      <div className="kv grow">
        {att && (
          <>
            <span>{dict.gimbal}</span>
            <span>{gimbalText(state.gimbal_mode, att)}</span>
          </>
        )}
        <span>{dict.videoRow}</span>
        <span>{videoText}</span>
      </div>
    </div>
  )
}
