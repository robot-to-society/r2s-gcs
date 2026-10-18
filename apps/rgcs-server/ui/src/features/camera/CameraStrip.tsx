import type { CameraCaps, CameraCommand, CameraState, VideoMode } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { IconCamera, IconGear } from '../../shared/ui/icons'
import { zoomText } from './format'

interface Props {
  readonly caps: CameraCaps
  readonly state: CameraState
  readonly pending: boolean
  readonly onCommand: (cmd: CameraCommand) => void
  readonly onSettings: () => void
  readonly dict: Dict
}

const MODE_LABEL: Record<VideoMode, string> = { rgb: 'RGB', thermal: 'IR', side_by_side: '2画面' }

/** Spec 10 §3.3 item 3 / prototype `.cam-strip`: record, photo, zoom, video-type segment, gear. */
export function CameraStrip({ caps, state, pending, onCommand, onSettings, dict }: Props) {
  if (caps.kind === 'none') return null
  const recording = state.recording === 'recording'
  const modes = caps.video_modes
  const current = Math.max(0, modes.indexOf(state.video_mode ?? 'rgb'))
  return (
    <div className="cam-strip">
      {caps.record && (
        <button
          type="button"
          className={`rec-btn${recording ? ' on' : ''}`}
          aria-label={dict.record}
          title={dict.record}
          aria-pressed={recording}
          disabled={pending}
          onClick={() => onCommand({ cmd: recording ? 'record_stop' : 'record_start' })}
        >
          <span className="rdot" />
        </button>
      )}
      {caps.photo && (
        <button type="button" className="rec-btn" aria-label={dict.photo} title={dict.photo} onClick={() => onCommand({ cmd: 'photo' })}>
          <IconCamera />
        </button>
      )}
      {caps.zoom?.step && (
        <div className="zoom">
          <button type="button" className="btn-icon sm" aria-label={dict.zoomOut} onClick={() => onCommand({ cmd: 'zoom_step', args: { steps: -1 } })}>
            −
          </button>
          <span className="big num val">{zoomText(state.zoom)}</span>
          <button type="button" className="btn-icon sm" aria-label={dict.zoomIn} onClick={() => onCommand({ cmd: 'zoom_step', args: { steps: 1 } })}>
            +
          </button>
        </div>
      )}
      <span className="grow" />
      {modes.length > 1 && (
        <div className={`seg n${Math.min(modes.length, 4)} sm`} role="group" aria-label={dict.videoType}>
          <span className="lens" style={{ transform: `translateX(${current * 100}%)` }} />
          {modes.map((m) => (
            <button key={m} type="button" className={state.video_mode === m ? 'on' : ''} onClick={() => onCommand({ cmd: 'video_mode', args: { mode: m } })}>
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
      )}
      <button type="button" className="btn-icon" aria-label={dict.cameraSettings} title={dict.cameraSettings} onClick={onSettings}>
        <IconGear size={18} />
      </button>
    </div>
  )
}
