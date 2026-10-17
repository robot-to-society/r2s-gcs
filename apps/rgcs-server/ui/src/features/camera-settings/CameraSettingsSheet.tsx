import { useState } from 'react'
import type { CameraProfile, CameraState, GimbalInputProfile } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
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

/** Spec 10 §5 (P2: 接続 / 操作 tabs). Invalid values block save (zod, same ranges as the server). */
export function CameraSettingsSheet({ profile, inputProfile, cameraState, gamepadIds, onSave, onCancel, onCenter, dict }: Props) {
  const [tab, setTab] = useState<Tab>('connection')
  const [camera, setCamera] = useState<CameraProfileDraft>({ kind: profile.kind, host: profile.host, port: profile.port })
  const [input, setInput] = useState<GimbalInputProfile>(inputProfile)
  const cameraIssue = firstIssue(cameraProfileSchema.safeParse(camera))
  const inputIssue = firstIssue(profileSchema.safeParse(input))
  const valid = cameraIssue === null && inputIssue === null
  return (
    <aside className="g-strong sheet settings" aria-label={dict.cameraSettings}>
      <div className="panel-h">
        <span className="h1">{dict.cameraSettings}</span>
        <span className="t2">UAV-{String(profile.sysid).padStart(2, '0')}</span>
        <span className="grow" />
        <button type="button" className="btn-icon" aria-label={dict.close} onClick={onCancel}>
          ×
        </button>
      </div>
      <div className="seg sm settings-tabs" role="group">
        <span className="lens" style={{ transform: `translateX(${tab === 'connection' ? 0 : 100}%)` }} />
        <button type="button" className={tab === 'connection' ? 'on' : ''} onClick={() => setTab('connection')}>
          {dict.tabConnection}
        </button>
        <button type="button" className={tab === 'input' ? 'on' : ''} onClick={() => setTab('input')}>
          {dict.tabInput}
        </button>
      </div>
      <div className="sheet-body sec">
        {tab === 'connection' ? (
          <ConnectionTab draft={camera} issue={cameraIssue} cameraState={cameraState} onChange={setCamera} dict={dict} />
        ) : (
          <InputTab draft={input} issue={inputIssue} gamepadIds={gamepadIds} onChange={setInput} onCenter={onCenter} dict={dict} />
        )}
      </div>
      <div className="sec settings-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          {dict.cancel}
        </button>
        <button type="button" className="btn btn-primary" disabled={!valid} onClick={() => onSave(camera, input)}>
          {dict.save}
        </button>
      </div>
    </aside>
  )
}
