import { hhmm } from '../../shared/format/time'
import type { CameraCommand, CameraSnapshot, Mission, MissionProgress, VehicleMessage, VehicleState, VideoSourceStatus } from '../../shared/api/types'
import { CameraStatusRow, CameraStrip, VideoThumb } from '../camera'
import type { Dict } from '../../shared/i18n'
import { IconCheck, IconChevron, IconClock, IconClose, IconGrid, IconPin, IconWrench } from '../../shared/ui/icons'
import { battWidth, dotClass } from '../vehicles/format'
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
  readonly commandsOpen?: boolean
}

const NONE_CAPS: CameraSnapshot['caps'] = { kind: 'none', gimbal: null, zoom: null, focus: false, photo: false, record: false, video_modes: [] }
const OFFLINE: CameraSnapshot['state'] = {
  connected: false, last_error: null, firmware: null, recording: 'idle', zoom: 1, zoom_max: 1, video_mode: null, gimbal: null, gimbal_mode: null, stream: null,
}

/** Right panel, 372 px (spec 10 §3.3), markup after the Glass prototype's right panel. */
export function DetailPanel(p: Props) {
  const { vehicle: v, messages, acked, onAck, onClose, onOpenCommands, dict, camera, videoSource, cameraPending = false, onCameraCommand, onCameraSettings } = p
  const caps = camera?.caps ?? NONE_CAPS
  const camState = camera?.state ?? OFFLINE
  const list = forVehicle(messages, v.sysid)
  const count = unread(messages, v.sysid, acked)
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
        <section className="detail-messages">
          <div className="row head">
            <span className="h2">{dict.messages}</span>
            <div className="grow" />
            <span className="count" data-testid="unread">
              {count}
            </span>
            <button type="button" className="btn-icon sm" title={dict.messageHistory} aria-label={dict.messageHistory} disabled>
              <IconChevron />
            </button>
          </div>
          {list.length === 0 && <div className="t3 detail-empty">{dict.noMessages}</div>}
          {list.map((m) => {
            const done = acked.has(m.id)
            const cls = done ? 'ok' : severityClass(m.severity)
            return (
              <div key={m.id} className={`msg-row${done ? ' acked' : ''}`}>
                <span className={`dot ${cls === 'ok' ? 'ok' : cls === 'danger' ? 'lost' : 'warn'}`} />
                <div>
                  <div className="row ttl-row">
                    <span className="num t2">{hhmm(m.ts)}</span>
                    <span className={`msg-text ${cls}`} style={{ fontWeight: 500 }}>
                      {messageText(m.text, dict)}
                    </span>
                  </div>
                </div>
                <div className="row acts">
                  {!done && (
                    <button type="button" className="btn-icon ack" aria-label={dict.ack} title={dict.ack} onClick={() => onAck(m.id)}>
                      <IconCheck />
                    </button>
                  )}
                  <button type="button" className="btn-icon" title={dict.history} aria-label={`${dict.messageHistory} ${m.id}`} disabled>
                    <IconClock size={16} />
                  </button>
                </div>
              </div>
            )
          })}
        </section>
      </div>
    </aside>
  )
}
