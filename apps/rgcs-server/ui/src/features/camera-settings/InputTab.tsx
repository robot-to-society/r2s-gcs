import type { GimbalInputProfile } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { AXIS_FUNCTIONS, BUTTON_FUNCTIONS } from '../gimbal-joystick'
import type { Issue } from './schema'

interface Props {
  readonly draft: GimbalInputProfile
  readonly issue: Issue | null
  readonly gamepadIds: readonly string[]
  readonly onChange: (next: GimbalInputProfile) => void
  readonly onCenter: () => void
  readonly dict: Dict
}

const AXES = [0, 1, 2, 3]
const BUTTONS = [0, 1, 2, 3, 4, 5, 6, 7]

export function InputTab({ draft, issue, gamepadIds, onChange, onCenter, dict }: Props) {
  const axis = (i: number) => draft.axes.find((a) => a.axis === i) ?? { axis: i, fn: 'none' as const, deadzone: 0.08, invert: false, scale: 1 }
  const setAxis = (i: number, patch: Partial<GimbalInputProfile['axes'][number]>) => {
    const next = { ...axis(i), ...patch }
    onChange({ ...draft, axes: [...draft.axes.filter((a) => a.axis !== i), next].sort((a, b) => a.axis - b.axis) })
  }
  const button = (i: number) => draft.buttons.find((b) => b.button === i)?.fn ?? 'none'
  const setButton = (i: number, fn: GimbalInputProfile['buttons'][number]['fn']) =>
    onChange({ ...draft, buttons: [...draft.buttons.filter((b) => b.button !== i), { button: i, fn }].sort((a, b) => a.button - b.button) })
  const bad = (field: string) => (issue?.path === field ? 'rg-num invalid' : 'rg-num')
  return (
    <div className="settings-form">
      <div className="form wide">
        <label htmlFor="js-device">{dict.gamepadDevice}</label>
        <select id="js-device" className="rg-sel" value={draft.device_id ?? ''} onChange={(e) => onChange({ ...draft, device_id: e.target.value || null })}>
          <option value="">{dict.auto}</option>
          {gamepadIds.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
        <label htmlFor="js-pan">{dict.maxPanSpeed}</label>
        <input id="js-pan" type="number" className={bad('max_pan_speed')} value={draft.max_pan_speed} onChange={(e) => onChange({ ...draft, max_pan_speed: Number(e.target.value) })} />
        <label htmlFor="js-tilt">{dict.maxTiltSpeed}</label>
        <input id="js-tilt" type="number" className={bad('max_tilt_speed')} value={draft.max_tilt_speed} onChange={(e) => onChange({ ...draft, max_tilt_speed: Number(e.target.value) })} />
      </div>
      <table className="tbl compact">
        <thead>
          <tr>
            <th>{dict.axis}</th>
            <th>{dict.function}</th>
            <th>{dict.deadzone}</th>
            <th>{dict.invert}</th>
          </tr>
        </thead>
        <tbody>
          {AXES.map((i) => (
            <tr key={i}>
              <td className="mono">{i}</td>
              <td>
                <select className="rg-sel" aria-label={dict.axisFunction.replace('{n}', String(i))} value={axis(i).fn} onChange={(e) => setAxis(i, { fn: e.target.value as (typeof AXIS_FUNCTIONS)[number] })}>
                  {AXIS_FUNCTIONS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input type="number" step="0.01" className={bad(`axes.${i}.deadzone`)} aria-label={`${dict.deadzone} ${i}`} value={axis(i).deadzone} onChange={(e) => setAxis(i, { deadzone: Number(e.target.value) })} />
              </td>
              <td>
                <input type="checkbox" aria-label={`${dict.invert} ${i}`} checked={axis(i).invert} onChange={(e) => setAxis(i, { invert: e.target.checked })} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <table className="tbl compact">
        <thead>
          <tr>
            <th>{dict.button}</th>
            <th>{dict.function}</th>
          </tr>
        </thead>
        <tbody>
          {BUTTONS.map((i) => (
            <tr key={i}>
              <td className="mono">{i}</td>
              <td>
                <select className="rg-sel" aria-label={dict.buttonFunction.replace('{n}', String(i))} value={button(i)} onChange={(e) => setButton(i, e.target.value as (typeof BUTTON_FUNCTIONS)[number])}>
                  {BUTTON_FUNCTIONS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="btn" onClick={onCenter}>
        {dict.centerGimbal}
      </button>
      {issue && <span className="danger settings-issue">{issue.path}: {issue.message}</span>}
    </div>
  )
}
