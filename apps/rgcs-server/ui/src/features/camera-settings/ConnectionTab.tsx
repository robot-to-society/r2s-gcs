import type { CameraState } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import type { CameraProfileDraft, Issue } from './schema'

interface Props {
  readonly draft: CameraProfileDraft
  readonly issue: Issue | null
  readonly cameraState: CameraState | undefined
  readonly onChange: (next: CameraProfileDraft) => void
  readonly dict: Dict
}

export function ConnectionTab({ draft, issue, cameraState, onChange, dict }: Props) {
  const bad = (field: string) => (issue?.path === field ? 'in invalid' : 'in')
  return (
    <div className="form wide settings-form">
      <label htmlFor="cam-kind">{dict.cameraKind}</label>
      <select id="cam-kind" className="rg-sel" value={draft.kind} onChange={(e) => onChange({ ...draft, kind: e.target.value as CameraProfileDraft['kind'] })}>
        <option value="none">{dict.cameraKindNone}</option>
        <option value="siyi_mt11">SIYI MT11</option>
        <option value="mavlink" disabled>
          MAVLink ({dict.comingSoon})
        </option>
      </select>
      {draft.kind === 'siyi_mt11' && (
        <>
          <label htmlFor="cam-host">{dict.cameraHost}</label>
          <input id="cam-host" className={bad('host')} value={draft.host} onChange={(e) => onChange({ ...draft, host: e.target.value })} />
          <label htmlFor="cam-port">{dict.cameraPort}</label>
          <input id="cam-port" type="number" className={bad('port')} value={draft.port} onChange={(e) => onChange({ ...draft, port: Number(e.target.value) })} />
          <span className="t3">RTSP</span>
          <span className="mono t2">{`rtsp://${draft.host}:8554/video1`}</span>
          <span className="t3">{dict.status}</span>
          <span className="t2">
            {cameraState?.connected ? dict.connected : dict.disconnected}
            {cameraState?.firmware && ` · FW ${cameraState.firmware.camera} / ${cameraState.firmware.gimbal}`}
          </span>
        </>
      )}
      {issue && <span className="danger settings-issue">{issue.path}: {issue.message}</span>}
    </div>
  )
}
