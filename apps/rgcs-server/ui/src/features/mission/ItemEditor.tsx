import type { MissionFrame, MissionItem, VehicleKind } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { CMDS, FRAMES, PALETTE, fieldsOf, type FieldSpec } from './cmds'
import { cmdKey } from './model'

interface Props {
  readonly item: MissionItem
  readonly seq: number
  readonly kind: VehicleKind | null
  readonly dict: Dict
  readonly onChange: (uid: number, patch: Partial<MissionItem>) => void
  readonly onCommand: (uid: number, cmdKey: string) => void
  readonly uid?: number
}

const GROUPS: readonly { readonly key: 'pos' | 'do' | 'cond'; readonly label: string }[] = [
  { key: 'pos', label: 'NAV' },
  { key: 'do', label: 'DO' },
  { key: 'cond', label: 'CONDITION' },
]

function readField(it: MissionItem, f: FieldSpec): number {
  if (f.p <= 4) return it.params[f.p - 1] ?? 0
  return f.p === 5 ? it.lat : f.p === 6 ? it.lon : it.alt
}

function patchField(it: MissionItem, f: FieldSpec, value: number): Partial<MissionItem> {
  if (f.p <= 4) {
    const params = [...it.params] as [number, number, number, number]
    params[f.p - 1] = value
    return { params }
  }
  return f.p === 5 ? { lat: value } : f.p === 6 ? { lon: value } : { alt: value }
}

/** Right panel: the selected item's MAV_CMD, its parameters and (when positional) its coordinates (spec 10 §6). */
export function ItemEditor({ item, seq, kind, dict, onChange, onCommand, uid }: Props) {
  const id = uid ?? seq
  const key = cmdKey(item)
  const spec = CMDS[key]
  const fields = fieldsOf(key, kind)
  const num = (v: string) => (v === '' || Number.isNaN(Number(v)) ? 0 : Number(v))
  return (
    <div className="item-editor" data-testid="item-editor">
      <div className="h2">{dict.mSeq.replace('{n}', String(seq))}</div>
      <label className="field">
        {dict.mCommand}
        <select className="mav" aria-label={dict.mCommand} value={spec ? key : ''} onChange={(e) => onCommand(id, e.target.value)}>
          {!spec && <option value="">{key}</option>}
          {GROUPS.map((g) => (
            <optgroup key={g.key} label={g.label}>
              {PALETTE[g.key].map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <span className="mono t3">{spec?.mav ?? `MAV_CMD #${item.command}`}</span>
      </label>
      {fields.map((f) => (
        <label key={f.key} className={`field${f.unused ? ' unused' : ''}`}>
          <span>
            {f.key}
            {f.unused && <span className="tag">{dict.mUnused}</span>}
          </span>
          {f.type === 'sel' && (
            <select aria-label={f.key} disabled={f.unused} value={String(readField(item, f))} onChange={(e) => onChange(id, patchField(item, f, Number(e.target.value)))}>
              {(f.opts ?? []).map((o) => (
                <option key={o} value={String(o)}>
                  {o}
                </option>
              ))}
            </select>
          )}
          {f.type === 'tog' && (
            <input type="checkbox" aria-label={f.key} disabled={f.unused} checked={readField(item, f) !== 0} onChange={(e) => onChange(id, patchField(item, f, e.target.checked ? 1 : 0))} />
          )}
          {f.type === 'num' && (
            <input type="number" aria-label={f.key} disabled={f.unused} min={f.min} max={f.max} step={f.step ?? 'any'} value={readField(item, f)} onChange={(e) => onChange(id, patchField(item, f, num(e.target.value)))} />
          )}
        </label>
      ))}
      {spec?.pos && (
        <div className="coords">
          <label className="field">
            {dict.mLat}
            <input type="number" aria-label={dict.mLat} step={0.000001} value={item.lat} onChange={(e) => onChange(id, { lat: num(e.target.value) })} />
          </label>
          <label className="field">
            {dict.mLon}
            <input type="number" aria-label={dict.mLon} step={0.000001} value={item.lon} onChange={(e) => onChange(id, { lon: num(e.target.value) })} />
          </label>
        </div>
      )}
      {spec?.alt && (
        <div className="coords">
          <label className="field">
            {dict.mFrame}
            <select aria-label={dict.mFrame} value={item.frame} onChange={(e) => onChange(id, { frame: e.target.value as MissionFrame })}>
              {(Object.keys(FRAMES) as MissionFrame[]).map((fr) => (
                <option key={fr} value={fr}>
                  {FRAMES[fr].short}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            {dict.altitude}
            <input type="number" aria-label={dict.altitude} step={1} value={item.alt} onChange={(e) => onChange(id, { alt: num(e.target.value) })} />
          </label>
        </div>
      )}
    </div>
  )
}
