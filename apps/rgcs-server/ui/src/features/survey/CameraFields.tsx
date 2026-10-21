// Camera picker + editable camera values for a survey. Picking copies the values into the spec
// (the spec never holds a camera id); user cameras can be updated or deleted, built-ins cannot.
import { useState } from 'react'
import type { SurveyCamera } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { toValues } from './cameraApi'
import type { SurveyCameraValues, SurveySpec } from './spec'

interface Props {
  readonly values: SurveyCameraValues
  readonly orientation: SurveySpec['orientation']
  readonly cameras: readonly SurveyCamera[]
  readonly dict: Dict
  readonly onChange: (values: SurveyCameraValues) => void
  readonly onOrientation: (o: SurveySpec['orientation']) => void
  readonly onPick: (values: SurveyCameraValues) => void
  readonly onSaveAs: (name: string) => void
  readonly onUpdate: (id: number) => void
  readonly onDelete: (id: number) => void
}

type NumKey = Exclude<keyof SurveyCameraValues, 'name' | 'shutterS'>

export function CameraFields({ values, orientation, cameras, dict, onChange, onOrientation, onPick, onSaveAs, onUpdate, onDelete }: Props) {
  const [pickedId, setPickedId] = useState<number | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [saveName, setSaveName] = useState('')
  const picked = cameras.find((c) => c.id === pickedId)
  const userCamera = picked && !picked.builtin && picked.id !== null ? picked : undefined

  const pick = (raw: string) => {
    const cam = cameras.find((c) => String(c.id) === raw)
    setPickedId(cam?.id ?? null)
    setConfirming(false)
    if (cam) onPick(toValues(cam))
  }
  const num = (key: NumKey, label: string, step: string) => (
    <>
      <label htmlFor={`sv-${key}`}>{label}</label>
      <input id={`sv-${key}`} className="in" type="number" min={0} step={step} value={values[key]} onChange={(e) => onChange({ ...values, [key]: Number(e.target.value) })} />
    </>
  )
  const shutterDenominator = values.shutterS > 0 ? Math.round(1 / values.shutterS) : 0

  return (
    <div className="lb-form" data-testid="camera-fields">
      <label htmlFor="sv-pick">{dict.svCameraPick}</label>
      <select id="sv-pick" className="in" value={pickedId ?? ''} onChange={(e) => pick(e.target.value)}>
        <option value="">{dict.svCameraCustom}</option>
        {cameras.map((c) => (
          <option key={c.id} value={c.id ?? ''}>
            {c.name}
          </option>
        ))}
      </select>
      {num('sensorWmm', dict.svSensorW, '0.1')}
      {num('sensorHmm', dict.svSensorH, '0.1')}
      {num('imageWpx', dict.svImageW, '1')}
      {num('imageHpx', dict.svImageH, '1')}
      {num('focalMm', dict.svFocal, '0.1')}
      <label htmlFor="sv-shutter">{dict.svShutter}</label>
      <input
        id="sv-shutter"
        className="in"
        type="number"
        min={1}
        step="1"
        value={shutterDenominator}
        onChange={(e) => {
          const x = Number(e.target.value)
          if (x > 0) onChange({ ...values, shutterS: 1 / x })
        }}
      />
      {num('minIntervalS', dict.svMinInterval, '0.1')}
      <span>{dict.svOrientation}</span>
      <div className="seg sm" role="group" aria-label={dict.svOrientation}>
        {(['landscape', 'portrait'] as const).map((o) => (
          <button key={o} type="button" className={orientation === o ? 'on' : ''} aria-pressed={orientation === o} onClick={() => onOrientation(o)}>
            {o === 'landscape' ? dict.svLandscape : dict.svPortrait}
          </button>
        ))}
      </div>
      <label htmlFor="sv-save-name">{dict.svSaveName}</label>
      <div className="row">
        <input id="sv-save-name" className="in" value={saveName} onChange={(e) => setSaveName(e.target.value)} />
        <button type="button" className="btn" disabled={saveName.trim() === ''} onClick={() => onSaveAs(saveName.trim())}>
          {dict.svSaveAs}
        </button>
      </div>
      {userCamera && (
        <>
          <span />
          <div className="row">
            <button type="button" className="btn" onClick={() => onUpdate(userCamera.id!)}>
              {dict.svCamUpdate}
            </button>
            {confirming ? (
              <button type="button" className="btn btn-danger" onClick={() => onDelete(userCamera.id!)}>
                {dict.svCamDeleteConfirm}
              </button>
            ) : (
              <button type="button" className="btn" onClick={() => setConfirming(true)}>
                {dict.svCamDelete}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
