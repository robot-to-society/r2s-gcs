import { hhmm } from '../../shared/format/time'
import type { VehicleMessage, VehicleState } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { forVehicle, unread } from './messages'
import { messageText, severityClass } from './format'

interface Props {
  readonly vehicle: VehicleState
  readonly messages: readonly VehicleMessage[]
  readonly acked: ReadonlySet<number>
  readonly onAck: (id: number) => void
  readonly onClose: () => void
  readonly onOpenCommands: () => void
  readonly dict: Dict
}

function dotClass(v: VehicleState): string {
  if (v.link === 'lost') return 'dot lost'
  if (v.warn || v.link === 'delay') return 'dot warn'
  return 'dot copter'
}

/** Right panel, 372 px (spec 10 §3.3) without the camera strip (P2). */
export function DetailPanel({ vehicle: v, messages, acked, onAck, onClose, onOpenCommands, dict }: Props) {
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
        <div className="detail-video inset">
          <span className="t3">{dict.videoNotConnected}</span>
        </div>
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
