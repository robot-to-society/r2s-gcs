// Camera picker + editable camera values for a survey. Picking copies the values into the spec
// (the spec never holds a camera id); user cameras can be updated or deleted, built-ins cannot.
import { useState } from 'react'
import type { SurveyCamera } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { toValues, validCameraValues } from './cameraApi'
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
type DraftKey = NumKey | 'shutter'

const WHOLE: readonly DraftKey[] = ['imageWpx', 'imageHpx']

/** The number a text draft stands for, or null when it must not reach the spec. */
function parseDraft(key: DraftKey, text: string): number | null {
  const n = text.trim() === '' ? NaN : Number(text)
  if (!Number.isFinite(n)) return null
  if (key === 'minIntervalS') return n >= 0 ? n : null
  if (key === 'shutter') return n >= 1 ? n : null
  if (n <= 0 || (WHOLE.includes(key) && !Number.isInteger(n))) return null
  return n
}

export function CameraFields({ values, orientation, cameras, dict, onChange, onOrientation, onPick, onSaveAs, onUpdate, onDelete }: Props) {
  const [pickedId, setPickedId] = useState<number | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [drafts, setDrafts] = useState<Readonly<Partial<Record<DraftKey, string>>>>({})
  const [saveName, setSaveName] = useState('')
  const picked = cameras.find((c) => c.id === pickedId)
  const userCamera = picked && !picked.builtin && picked.id !== null ? picked : undefined

  const pick = (raw: string) => {
    const cam = cameras.find((c) => String(c.id) === raw)
    setPickedId(cam?.id ?? null)
    setConfirming(false)
    setDrafts({})
    if (cam) onPick(toValues(cam))
  }
  const canonical = (key: DraftKey): number => (key === 'shutter' ? (values.shutterS > 0 ? Math.round(1 / values.shutterS) : 0) : values[key])
  /** What the field shows: the user's text while it is invalid or still matches the value, else the value. */
  const shown = (key: DraftKey): string => {
    const draft = drafts[key]
    if (draft === undefined) return String(canonical(key))
    const parsed = parseDraft(key, draft)
    return parsed === null || parsed === canonical(key) ? draft : String(canonical(key))
  }
  const edit = (key: DraftKey, text: string) => {
    setDrafts((d) => ({ ...d, [key]: text }))
    const n = parseDraft(key, text)
    if (n === null) return
    onChange(key === 'shutter' ? { ...values, shutterS: 1 / n } : { ...values, [key]: n })
  }
  const invalid = (key: DraftKey) => drafts[key] !== undefined && parseDraft(key, drafts[key]) === null
  const field = (key: DraftKey, label: string, step: string) => (
    <>
      <label htmlFor={`sv-${key}`}>{label}</label>
      <input id={`sv-${key}`} className="in" type="number" step={step} value={shown(key)} aria-invalid={invalid(key) || undefined} onChange={(e) => edit(key, e.target.value)} />
    </>
  )
  const valid = validCameraValues(values) && !(Object.keys(drafts) as DraftKey[]).some(invalid)

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
      {field('sensorWmm', dict.svSensorW, '0.1')}
      {field('sensorHmm', dict.svSensorH, '0.1')}
      {field('imageWpx', dict.svImageW, '1')}
      {field('imageHpx', dict.svImageH, '1')}
      {field('focalMm', dict.svFocal, '0.1')}
      {field('shutter', dict.svShutter, '1')}
      {field('minIntervalS', dict.svMinInterval, '0.1')}
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
        <button type="button" className="btn" disabled={!valid || saveName.trim() === ''} onClick={() => onSaveAs(saveName.trim())}>
          {dict.svSaveAs}
        </button>
      </div>
      {userCamera && (
        <>
          <span />
          <div className="row">
            <button type="button" className="btn" disabled={!valid} onClick={() => onUpdate(userCamera.id!)}>
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
