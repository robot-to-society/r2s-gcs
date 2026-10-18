import { hhmm } from '../../shared/format/time'
import type { CameraCommand, CameraSnapshot, Mission, MissionProgress, VehicleMessage, VehicleState, VideoSourceStatus } from '../../shared/api/types'
import { CameraStatusRow, CameraStrip, VideoThumb } from '../camera'
import type { Dict } from '../../shared/i18n'
import { forVehicle, unread } from './messages'
import { messageText, severityClass } from './format'
import { MissionProgressRow } from './MissionProgressRow'

interface Props {
  readonly vehicle: VehicleState
  readonly messages: readonly VehicleMessage[]
  readonly acked: ReadonlySet<number>
  readonly onAck: (id: number) => void
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
}

const NONE_CAPS: CameraSnapshot['caps'] = { kind: 'none', gimbal: null, zoom: null, focus: false, photo: false, record: false, video_modes: [] }
const OFFLINE: CameraSnapshot['state'] = {
  connected: false, last_error: null, firmware: null, recording: 'idle', zoom: 1, zoom_max: 1, video_mode: null, gimbal: null, gimbal_mode: null, stream: null,
}

function dotClass(v: VehicleState): string {
  if (v.link === 'lost') return 'dot lost'
  if (v.warn || v.link === 'delay') return 'dot warn'
  return 'dot copter'
}

/** Right panel, 372 px (spec 10 §3.3) without the camera strip (P2). */
export function DetailPanel({ vehicle: v, messages, acked, onAck, onClose, onOpenCommands, dict, camera, videoSource, cameraPending = false, onCameraCommand, onCameraSettings, vehicleMission, missionProgress, onWriteMission, onStartMission }: Props) {
  const caps = camera?.caps ?? NONE_CAPS
  const camState = camera?.state ?? OFFLINE
  const list = forVehicle(messages, v.sysid)
  const count = unread(messages, v.sysid, acked)
  return (
    <aside className="g panel float float-r detail" aria-label={v.name}>
      <div className="panel-h">
        <span className={dotClass(v)} />
        <span className="h1">{v.name}</span>
        <span className="t3 detail-pin" title={dict.pinned}>
          ⌖
        </span>
        <span className="grow" />
        <button type="button" className="btn-icon" aria-label={dict.close} onClick={onClose}>
          ×
        </button>
      </div>
      <div className="detail-body">
        <VideoThumb sysid={v.sysid} status={videoSource} recording={camState.recording} dict={dict} />
        <CameraStrip caps={caps} state={camState} pending={cameraPending} onCommand={(c) => onCameraCommand?.(c)} onSettings={() => onCameraSettings?.()} dict={dict} />
        <CameraStatusRow caps={caps} state={camState} onSetup={() => onCameraSettings?.()} dict={dict} />
        <div className="detail-telemetry">
          <div className="kv">
            <span className="t3">{dict.altitude}</span>
            <span className="big num" data-testid="alt">
              {Math.round(v.alt_rel)}
              <span className="unit">m</span>
            </span>
          </div>
          <div className="kv">
            <span className="t3">{dict.speed}</span>
            <span className="big num" data-testid="speed">
              {v.ground_speed.toFixed(1)}
              <span className="unit">m/s</span>
            </span>
          </div>
          <div className="kv">
            <span className="t3">{dict.battery}</span>
            <span className="big num" data-testid="batt">
              {v.battery.pct ?? v.battery.volt.toFixed(1)}
              <span className="unit">{v.battery.pct === null ? 'V' : '%'}</span>
            </span>
          </div>
        </div>
        {onWriteMission && (
          <MissionProgressRow progress={missionProgress ?? null} mission={vehicleMission ?? null} vehicle={v} dict={dict} onWrite={onWriteMission} onStart={() => onStartMission?.()} />
        )}
        <div className="detail-tiles">
          <button type="button" className="tile-btn" disabled title={dict.comingSoon}>
            {dict.maintenance}
          </button>
          <button type="button" className="tile-btn" disabled title={dict.comingSoon}>
            {dict.history}
          </button>
          <button type="button" className="tile-btn" onClick={onOpenCommands}>
            {dict.allCommands}
          </button>
        </div>
        <section className="sec detail-messages">
          <div className="sec-title row">
            <span>{dict.messages}</span>
            <span className="count" data-testid="unread">
              {count}
            </span>
          </div>
          {list.length === 0 && <div className="t3">{dict.noMessages}</div>}
          {list.map((m) => {
            const done = acked.has(m.id)
            return (
              <div key={m.id} className={`msg-row${done ? ' acked' : ''}`}>
                <span className="t3 num msg-time">{hhmm(m.ts)}</span>
                <span className={`msg-text ${done ? 'ok' : severityClass(m.severity)}`}>{messageText(m.text, dict)}</span>
                {!done && (
                  <button type="button" className="btn-icon sm" aria-label={dict.ack} title={dict.ack} onClick={() => onAck(m.id)}>
                    ✓
                  </button>
                )}
              </div>
            )
          })}
        </section>
      </div>
    </aside>
  )
}
