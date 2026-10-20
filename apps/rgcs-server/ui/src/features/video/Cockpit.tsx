import type { ReactNode } from 'react'
import { KindIcon } from '../../shared/ui/KindIcon'
import type { CameraCommand, CameraSnapshot, VehicleState, VideoSourceStatus } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { IconMinimize, IconVideoOff, IconWarn } from '../../shared/ui/icons'
import { isLive, recDuration, useRecElapsed, useWhepFeed } from '../camera'
import { altText, battText, modeLabel, speedText } from '../vehicles/format'
import { CamBar } from './CamBar'
import { CamCard } from './CamCard'
import { latencyText } from './cockpitView'

interface Props {
  readonly vehicle: VehicleState
  readonly camera: CameraSnapshot | undefined
  readonly status: VideoSourceStatus | undefined
  readonly pending: boolean
  readonly dict: Dict
  readonly onCommand: (cmd: CameraCommand) => void
  readonly onSettings: () => void
  readonly onRestore: () => void
  /** The mini map (the operations map's layers, centred on this vehicle). */
  readonly map: ReactNode
}

/** Spec 10 §4.2 / prototype `isVideoMax`: video 2.6fr, mini map + camera card 1fr. */
export function Cockpit({ vehicle: v, camera, status, pending, dict, onCommand, onSettings, onRestore, map }: Props) {
  const live = isLive(status)
  const { ref, latency } = useWhepFeed(v.sysid, live)
  const has = camera !== undefined && camera.caps.kind !== 'none'
  const recording = camera?.state.recording ?? 'idle'
  const elapsedMs = useRecElapsed(recording)
  const source = (status?.source ?? 'none').toUpperCase()
  const delay = latencyText(latency)
  return (
    <section className="float top1 cockpit">
      <div className="vtile" style={{ cursor: 'default' }}>
        {live ? (
          <video ref={ref} className="feed" muted autoPlay playsInline />
        ) : (
          <div className="t3 vtile-off">
            <div>
              <IconVideoOff />
              <div>{dict.videoNotConnected}</div>
            </div>
          </div>
        )}
        <div className="cockpit-pills">
          <div className="g-ctl row" style={{ gap: 12, padding: '8px 14px', borderRadius: 999 }}>
            <KindIcon kind={v.kind} />
            <span style={{ fontSize: 19, fontWeight: 500 }}>{v.name}</span>
            {v.warn && <IconWarn size={20} />}
            <span className="badge" style={{ color: v.armed ? 'var(--accent)' : 'var(--text-2)' }}>
              {modeLabel(v, dict)}
            </span>
          </div>
          <div className="g-ctl row num" style={{ gap: 18, fontSize: 14, padding: '6px 14px', borderRadius: 999, color: 'var(--text-2)' }}>
            <span>▲ {altText(v)}</span>
            <span>◔ {speedText(v)}</span>
            <span>▮ {battText(v)}</span>
          </div>
          {recording === 'recording' && (
            <span className="pill pill-rec">
              <span className="rdot" /> AUTO REC <span className="num">{recDuration(0, elapsedMs)}</span>
            </span>
          )}
        </div>
        {has && (
          <div className="g-ctl row num cockpit-source">
            <span>{source}</span>
            <span className="cockpit-sep" />
            <span>{delay}</span>
          </div>
        )}
        <button type="button" className="g-ctl btn-icon lg cockpit-restore" aria-label={dict.restore} title={dict.restore} onClick={onRestore}>
          <IconMinimize size={18} />
        </button>
        {has && <CamBar caps={camera.caps} state={camera.state} pending={pending} dict={dict} onCommand={onCommand} onSettings={onSettings} />}
      </div>
      <div className="cockpit-side">
        <div className="surface cockpit-map">{map}</div>
        {has && <CamCard caps={camera.caps} state={camera.state} videoText={`${source}  ${delay}`} dict={dict} />}
      </div>
    </section>
  )
}
