import { useState } from 'react'
import type { VehicleState } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { requestConfirm } from '../commands/api'
import type { LatLon } from '../map/store'
import { sendGuided, type AltMode } from './api'
import { runGuided, type GuidedOutcome, type SendGuidedFn } from './run'

interface Deps {
  readonly send: SendGuidedFn
  readonly confirm: typeof requestConfirm
}

interface Props {
  readonly vehicle: VehicleState
  readonly target: LatLon | null
  readonly onPickTarget: () => void
  readonly onClose: () => void
  readonly onDone: (outcome: GuidedOutcome) => void
  readonly onSwitchToGuided: () => void
  readonly dict: Dict
  readonly deps?: Deps
}

type Step = 'idle' | 'mode_required' | 'confirm' | 'busy'

/** Guided move (spec 10 §3.5): pick a target on the map, keep or set altitude, start. */
export function GuidedModal({ vehicle, target, onPickTarget, onClose, onDone, onSwitchToGuided, dict, deps }: Props) {
  const [altMode, setAltMode] = useState<AltMode>('keep')
  const [altRel, setAltRel] = useState('')
  const [step, setStep] = useState<Step>('idle')
  const [note, setNote] = useState<string | null>(null)
  const send = deps?.send ?? sendGuided
  const confirm = deps?.confirm ?? requestConfirm
  const altValue = Number(altRel)
  const canStart = target !== null && (altMode === 'keep' || (altRel !== '' && Number.isFinite(altValue)))

  const settle = (outcome: GuidedOutcome) => {
    if (outcome.kind === 'mode_required') return setStep('mode_required')
    if (outcome.kind === 'needs_confirm') {
      setNote(outcome.message ?? null)
      return setStep('confirm')
    }
    setStep('idle')
    onDone(outcome)
  }

  const body = () => ({ lat: target!.lat, lon: target!.lon, alt_mode: altMode, ...(altMode === 'set' ? { alt_rel: altValue } : {}) })

  const start = async () => {
    if (!canStart) return
    setStep('busy')
    settle(await runGuided(vehicle.sysid, body(), undefined, send))
  }

  const confirmAndStart = async () => {
    setStep('busy')
    try {
      const { confirm_token } = await confirm(vehicle.sysid, 'guided')
      settle(await runGuided(vehicle.sysid, body(), confirm_token, send))
    } catch (e) {
      setStep('idle')
      onDone({ kind: 'error', code: 'unknown', message: e instanceof Error ? e.message : String(e) })
    }
  }

  return (
    <div className="g-strong sheet guided" role="dialog" aria-label={dict.guided}>
      <div className="panel-h">
        <span className="h1">{dict.guided}</span>
        <span className="t2">{vehicle.name}</span>
        <span className="grow" />
        <button type="button" className="btn-icon" aria-label={dict.close} onClick={onClose}>
          ×
        </button>
      </div>
      <div className="sec">
        <div className="sec-title">{dict.targetLabel}</div>
        {target ? (
          <div className="num guided-target">
            {target.lat.toFixed(6)}, {target.lon.toFixed(6)}
          </div>
        ) : (
          <div className="t3">{dict.pickTarget}</div>
        )}
        <button type="button" className="btn btn-sm" onClick={onPickTarget}>
          {dict.pickOnMap}
        </button>
      </div>
      <div className="sec">
        <div className="sec-title">{dict.altitude}</div>
        <div className="seg sm guided-alt" role="group" aria-label={dict.altitude}>
          <span className="lens" style={{ transform: `translateX(${altMode === 'keep' ? 0 : 100}%)` }} />
          <button type="button" className={altMode === 'keep' ? 'on' : ''} onClick={() => setAltMode('keep')}>
            {dict.altKeep}
          </button>
          <button type="button" className={altMode === 'set' ? 'on' : ''} onClick={() => setAltMode('set')}>
            {dict.altSet}
          </button>
        </div>
        {altMode === 'set' && (
          <input className="rg-num" aria-label={dict.altInput} placeholder={dict.altInput} value={altRel} onChange={(e) => setAltRel(e.target.value)} />
        )}
      </div>
      <div className="sec guided-actions">
        {step === 'mode_required' && (
          <>
            <div className="warnbox">{dict.modeRequired}</div>
            <button type="button" className="btn btn-primary" onClick={onSwitchToGuided}>
              {dict.switchToGuided}
            </button>
          </>
        )}
        {step === 'confirm' && (
          <>
            {note && <div className="warnbox">{note}</div>}
            <button type="button" className="btn btn-danger" onClick={confirmAndStart}>
              {dict.confirmGuided}
            </button>
          </>
        )}
        <button type="button" className="btn btn-primary" disabled={!canStart || step === 'busy'} onClick={start}>
          {dict.startMove}
        </button>
      </div>
    </div>
  )
}
