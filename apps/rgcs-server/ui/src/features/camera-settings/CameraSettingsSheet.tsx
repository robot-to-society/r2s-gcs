import { useState } from 'react'
import type { CameraProfile, CameraState, GimbalInputProfile } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { IconClose } from '../../shared/ui/icons'
import { profileSchema } from '../gimbal-joystick'
import { ConnectionTab } from './ConnectionTab'
import { InputTab } from './InputTab'
import { cameraProfileSchema, firstIssue, type CameraProfileDraft } from './schema'

type Tab = 'connection' | 'input'

interface Props {
  readonly sysid: number
  readonly profile: CameraProfile
  readonly inputProfile: GimbalInputProfile
  readonly cameraState: CameraState | undefined
  readonly gamepadIds: readonly string[]
  readonly onSave: (camera: CameraProfileDraft, input: GimbalInputProfile) => void
  readonly onCancel: () => void
  readonly onCenter: () => void
  readonly dict: Dict
}

/** Spec 10 §5 / prototype camera settings: 接続 / 操作 (ROI / 映像 after the demo). zod blocks invalid saves. */
export function CameraSettingsSheet({ profile, inputProfile, cameraState, gamepadIds, onSave, onCancel, onCenter, dict }: Props) {
  const [tab, setTab] = useState<Tab>('connection')
  const [camera, setCamera] = useState<CameraProfileDraft>({ kind: profile.kind, host: profile.host, port: profile.port, video_source_mode: profile.video_source_mode })
  const [input, setInput] = useState<GimbalInputProfile>(inputProfile)
  const cameraIssue = firstIssue(cameraProfileSchema.safeParse(camera))
  const inputIssue = firstIssue(profileSchema.safeParse(input))
  const valid = cameraIssue === null && inputIssue === null
  const name = `UAV-${String(profile.sysid).padStart(2, '0')}`
  return (
    <aside className="g-strong panel sheet settings" aria-label={dict.cameraSettings}>
      <div className="panel-h">
        <span className="h1">{name}</span>
        <span className="h1 t2" style={{ fontWeight: 300 }}>
          {dict.cameraSettings}
        </span>
        <span className="grow" />
        <button type="button" className="btn-icon" aria-label={dict.close} title={dict.close} onClick={onCancel}>
          <IconClose />
        </button>
      </div>
      <div className="settings-tabs">
        <div className="seg n4" role="group" style={{ height: 36 }}>
          <span className="lens" style={{ transform: `translateX(${tab === 'connection' ? 0 : 100}%)` }} />
          <button type="button" className={tab === 'connection' ? 'on' : ''} onClick={() => setTab('connection')}>
            {dict.tabConnection}
          </button>
          <button type="button" className={tab === 'input' ? 'on' : ''} onClick={() => setTab('input')}>
            {dict.tabInput}
          </button>
          <button type="button" aria-disabled="true" title={dict.comingSoon} className="off">
            {dict.tabRoi}
          </button>
          <button type="button" aria-disabled="true" title={dict.comingSoon} className="off">
            {dict.tabVideo}
          </button>
        </div>
      </div>
      <div className="sheet-body settings-body">
        {tab === 'connection' ? (
          <ConnectionTab draft={camera} issue={cameraIssue} cameraState={cameraState} onChange={setCamera} dict={dict} />
        ) : (
          <InputTab draft={input} issue={inputIssue} gamepadIds={gamepadIds} onChange={setInput} onCenter={onCenter} dict={dict} />
        )}
      </div>
      <div className="settings-actions">
        <button type="button" className="btn" onClick={onCancel}>
          {dict.cancel}
        </button>
        <button type="button" className="btn btn-primary" disabled={!valid} onClick={() => onSave(camera, input)}>
          {dict.save}
        </button>
      </div>
    </aside>
  )
}
