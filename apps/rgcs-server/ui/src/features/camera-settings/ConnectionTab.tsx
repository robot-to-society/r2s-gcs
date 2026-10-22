import type { CameraState, VideoSourceMode } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { clockDanger, clockText, sdDanger, sdText } from '../camera/mediaFormat'
import type { CameraProfileDraft, Issue } from './schema'

interface Props {
  readonly draft: CameraProfileDraft
  readonly issue: Issue | null
  readonly cameraState: CameraState | undefined
  readonly onChange: (next: CameraProfileDraft) => void
  /** `caps.clock_sync`: the camera can be synced (今すぐ同期 needs it and a live connection). */
  readonly clockSync: boolean
  readonly onSyncClock: () => void
  readonly dict: Dict
}

const SOURCES: readonly VideoSourceMode[] = ['auto', 'mt11']

/** Prototype 接続 tab: `.form` rows, then an `.inset .kv` status box. */
export function ConnectionTab({ draft, issue, cameraState, onChange, clockSync, onSyncClock, dict }: Props) {
  const bad = (field: string, base: string) => (issue?.path === field ? `${base} invalid` : base)
  return (
    <>
      <div className="form">
        <span>{dict.cameraKind}</span>
        <select id="cam-kind" className="in" aria-label={dict.cameraKind} value={draft.kind} onChange={(e) => onChange({ ...draft, kind: e.target.value as CameraProfileDraft['kind'] })}>
          <option value="none">{dict.cameraKindNone}</option>
          <option value="siyi_mt11">SIYI MT11</option>
          <option value="mavlink" disabled>
            MAVLink ({dict.comingSoon})
          </option>
        </select>
      </div>
      {draft.kind === 'siyi_mt11' && (
        <>
          <div className="form">
            <span>{dict.cameraHost}</span>
            <input id="cam-host" className={bad('host', 'in mono')} aria-label={dict.cameraHost} value={draft.host} onChange={(e) => onChange({ ...draft, host: e.target.value })} />
            <span>{dict.cameraPort}</span>
            <input id="cam-port" type="number" className={bad('port', 'in num')} aria-label={dict.cameraPort} value={draft.port} onChange={(e) => onChange({ ...draft, port: Number(e.target.value) })} />
            <span>RTSP</span>
            <span className="mono t2 ell" style={{ fontSize: 12 }}>{`rtsp://${draft.host}:8554/video1`}</span>
            <span>{dict.videoSource}</span>
            <div className="seg n3 sm" role="group" aria-label={dict.videoSource} style={{ width: 220 }}>
              <span className="lens" style={{ transform: `translateX(${SOURCES.indexOf(draft.video_source_mode) * 100}%)` }} />
              <button type="button" className={draft.video_source_mode === 'auto' ? 'on' : ''} onClick={() => onChange({ ...draft, video_source_mode: 'auto' })}>
                AUTO
              </button>
              <button type="button" className={draft.video_source_mode === 'mt11' ? 'on' : ''} onClick={() => onChange({ ...draft, video_source_mode: 'mt11' })}>
                MT11
              </button>
              <button type="button" aria-disabled="true" title={dict.comingSoon} className="off">
                {dict.auxSource}
              </button>
            </div>
          </div>
          <StatusBox cameraState={cameraState} canSync={clockSync && cameraState?.connected === true} onSyncClock={onSyncClock} dict={dict} />
        </>
      )}
      {issue && <span className="danger settings-issue">{issue.path}: {issue.message}</span>}
    </>
  )
}

interface StatusProps {
  readonly cameraState: CameraState | undefined
  readonly canSync: boolean
  readonly onSyncClock: () => void
  readonly dict: Dict
}

const dangerStyle = (on: boolean) => (on ? { color: 'var(--danger)' } : undefined)

/** The `.inset .kv` status box: connection, firmware, SD card, camera clock + 今すぐ同期. */
function StatusBox({ cameraState, canSync, onSyncClock, dict }: StatusProps) {
  const fw = cameraState?.firmware
  const storage = cameraState?.storage
  const clock = cameraState?.clock
  return (
    <div className="inset" style={{ padding: '12px 14px' }}>
      <div className="kv">
        <span>{dict.camConn}</span>
        <span className="row" style={{ gap: 6 }}>
          <span className={`dot ${cameraState?.connected ? 'ok' : 'lost'}`} style={{ width: 8, height: 8 }} />
          {cameraState?.connected ? dict.camConnected : dict.disconnected}
        </span>
        <span>{dict.camFw}</span>
        <span className="mono" style={{ fontSize: 12 }}>
          {fw ? `cam ${fw.camera} gimbal ${fw.gimbal} zoom ${fw.zoom}` : dict.unknown}
        </span>
        <span>{dict.camSd}</span>
        <span style={dangerStyle(sdDanger(storage))}>{sdText(storage, dict) ?? dict.unknown}</span>
        <span>{dict.camClock}</span>
        <span className="row" style={{ gap: 10 }}>
          <span style={dangerStyle(clockDanger(clock))}>{clockText(clock, dict)}</span>
          <button type="button" className="btn btn-sm" disabled={!canSync} onClick={onSyncClock}>
            {dict.syncNow}
          </button>
        </span>
      </div>
    </div>
  )
}
