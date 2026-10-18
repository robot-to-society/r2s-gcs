// Dictionary lookups for mission copy: command names (`wp_<KEY>`), field labels (`fld_<key>`),
// option labels (`opt_<key>` = '|'-separated in option order) and frame descriptions.
import type { MissionFrame, MissionItem } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { CMDS, FRAMES, UNITS, fieldsOf, type FieldSpec } from './cmds'
import { cmdKey } from './model'

export const wpLabel = (key: string, dict: Dict): string => dict[`wp_${key}` as keyof Dict] ?? key
export const fieldLabel = (key: string, dict: Dict): string => dict[`fld_${key}` as keyof Dict] ?? key
export const fieldUnit = (key: string): string => UNITS[key] ?? ''

export function optionLabel(f: FieldSpec, value: number, dict: Dict): string {
  const raw = dict[`opt_${f.key}` as keyof Dict]
  if (!raw || !f.opts) return String(value)
  const i = f.opts.indexOf(value)
  return raw.split('|')[i] ?? String(value)
}

export const frameDesc = (frame: MissionFrame, dict: Dict): string => (frame === 'rel' ? dict.mFrameRel : frame === 'abs' ? dict.mFrameAbs : dict.mFrameTer)

export const km = (m: number): string => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`)
export const mmss = (s: number): string => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`

function fieldValue(it: MissionItem, f: FieldSpec): number {
  if (f.p <= 4) return it.params[f.p - 1] ?? 0
  return f.p === 5 ? it.lat : f.p === 6 ? it.lon : it.alt
}

/** Prototype row sub-line: "▲80 m Rel · 待機時間 0s" (fields the vehicle ignores are skipped). */
export function itemSummary(it: MissionItem, kind: Parameters<typeof fieldsOf>[1], dict: Dict): string {
  const key = cmdKey(it)
  const spec = CMDS[key]
  const parts: string[] = []
  if (spec?.alt) parts.push(`▲${Math.round(it.alt)} m ${FRAMES[it.frame].short}`)
  for (const f of fieldsOf(key, kind)) {
    if (f.unused) continue
    const v = fieldValue(it, f)
    const label = fieldLabel(f.key, dict)
    if (f.type === 'num') parts.push(`${label} ${v}${fieldUnit(f.key)}`)
    else if (f.type === 'tog') parts.push(`${label} ${v ? dict.optOn : dict.optOff}`)
    else parts.push(`${label} ${optionLabel(f, v, dict)}`)
  }
  return parts.join(' · ')
}
