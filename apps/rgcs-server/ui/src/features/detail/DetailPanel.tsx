import type { CameraCommand, CameraSnapshot, Mission, MissionProgress, LogEntry, SysId, VehicleState, VideoSourceStatus } from '../../shared/api/types'
import { CameraStatusRow, CameraStrip, VideoThumb } from '../camera'
import type { Dict } from '../../shared/i18n'
import { IconClock, IconClose, IconGrid, IconPin, IconWrench } from '../../shared/ui/icons'
import { battWidth, dotClass } from '../vehicles/format'
import { DetailMessages } from './DetailMessages'
import { MissionProgressRow } from './MissionProgressRow'

interface Props {
  readonly vehicle: VehicleState
  /** The message log (newest first); the panel shows this vehicle's newest three. */
  readonly entries: readonly LogEntry[]
  readonly onAck: (sysid: SysId, id: number) => void
  /** Opens メッセージ履歴 filtered to the vehicle. */
  readonly onOpenLog: (sysid: SysId) => void
  readonly onClose: () => void
  readonly onOpenCommands: () => void
  readonly dict: Dict
  readonly camera?: CameraSnapshot
  readonly videoSource?: VideoSourceStatus
  readonly cameraPending?: boolean
  readonly onCameraCommand?: (cmd: CameraCommand) => void
  readonly onCameraSettings?: () => void
  readonly vehicleMission?: Mission
  readonly missionProgress?: MissionProgress
  readonly onWriteMission?: () => void
  readonly onStartMission?: () => void
  readonly commandsOpen?: boolean
}

const NONE_CAPS: CameraSnapshot['caps'] = { kind: 'none', gimbal: null, zoom: null, focus: false, photo: false, record: false, video_modes: [] }
const OFFLINE: CameraSnapshot['state'] = {
  connected: false, last_error: null, firmware: null, recording: 'idle', zoom: 1, zoom_max: 1, video_mode: null, gimbal: null, gimbal_mode: null, stream: null,
}

/** Right panel, 372 px (spec 10 §3.3), markup after the Glass prototype's right panel. */
export function DetailPanel(p: Props) {
  const { vehicle: v, onClose, onOpenCommands, dict, camera, videoSource, cameraPending = false, onCameraCommand, onCameraSettings } = p
  const caps = camera?.caps ?? NONE_CAPS
  const camState = camera?.state ?? OFFLINE
  return (
    <aside className="g panel float float-r detail" aria-label={v.name}>
      <div className="panel-h">
        <span className={dotClass(v)} style={{ width: 11, height: 11 }} />
        <span className="h1">{v.name}</span>
        <div className="grow" />
        <button type="button" className="btn-icon" title={dict.pinned} aria-label={dict.pinned} disabled>
          <IconPin />
        </button>
        <button type="button" className="btn-icon" aria-label={dict.close} title={dict.close} onClick={onClose}>
          <IconClose />
        </button>
      </div>
      <div className="detail-body">
        <VideoThumb sysid={v.sysid} status={videoSource} recording={camState.recording} dict={dict} />
        <CameraStrip caps={caps} state={camState} pending={cameraPending} onCommand={(c) => onCameraCommand?.(c)} onSettings={() => onCameraSettings?.()} dict={dict} />
        <CameraStatusRow caps={caps} state={camState} onSetup={() => onCameraSettings?.()} dict={dict} />
        <div className="detail-telemetry num">
          <span className="kv">
            <span className="big" data-testid="alt">
              {Math.round(v.alt_rel)} m
            </span>
            <span className="lbl">{dict.altitude}</span>
          </span>
          <span className="kv">
            <span className="big" data-testid="speed">
              {v.ground_speed.toFixed(1)} m/s
            </span>
            <span className="lbl">{dict.speed}</span>
          </span>
          <span className="kv">
            <span className="big" data-testid="batt">
              {v.battery.pct !== null ? `${v.battery.pct}%` : `${v.battery.volt.toFixed(1)} V`}
            </span>
            <span className="batt">
              <span style={{ width: battWidth(v) }} />
            </span>
          </span>
        </div>
        {p.onWriteMission && (
          <MissionProgressRow progress={p.missionProgress ?? null} mission={p.vehicleMission ?? null} vehicle={v} dict={dict} onWrite={p.onWriteMission} onStart={() => p.onStartMission?.()} />
        )}
        <div className="detail-tiles hair">
          <button type="button" className="tile-btn" disabled title={`${dict.maintenance} (${dict.comingSoon})`} aria-label={dict.maintenance}>
            <IconWrench />
          </button>
          <button type="button" className="tile-btn" disabled title={`${dict.history} (${dict.comingSoon})`} aria-label={dict.history}>
            <IconClock />
          </button>
          <button type="button" className={`tile-btn${p.commandsOpen ? ' on' : ''}`} title={dict.allCommands} aria-label={dict.allCommands} onClick={onOpenCommands}>
            <IconGrid />
          </button>
        </div>
        <DetailMessages sysid={v.sysid} entries={p.entries} dict={dict} onAck={p.onAck} onOpenLog={p.onOpenLog} />
      </div>
    </aside>
  )
}
