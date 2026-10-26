import { useEffect, useState } from 'react'
import type { MissionSummaryRow } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { ymdHm } from '../../shared/format/time'
import { listMissions } from './api'
import { IconClose } from '../../shared/ui/icons'

type Load = () => Promise<MissionSummaryRow[]>

interface Props {
  readonly dict: Dict
  readonly title: string
  readonly onPick: (row: MissionSummaryRow) => void
  readonly onClose: () => void
  readonly load?: Load
}

/** The saved missions from the server: null while loading. */
export function useSavedMissions(load: Load): { readonly rows: MissionSummaryRow[] | null; readonly error: string | null } {
  const [rows, setRows] = useState<MissionSummaryRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    load()
      .then((r) => alive && setRows(r))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      alive = false
    }
  }, [load])
  return { rows, error }
}

export function PickerHead({ title, dict, onClose }: { readonly title: string; readonly dict: Dict; readonly onClose: () => void }) {
  return (
    <div className="panel-h">
      <span className="h1">{title}</span>
      <span className="grow" />
      <button type="button" className="btn-icon" aria-label={dict.close} onClick={onClose}>
        <IconClose />
      </button>
    </div>
  )
}

export const rowMeta = (r: MissionSummaryRow, dict: Dict): string => `${r.item_count} ${dict.mItems} · ${ymdHm(r.updated_at)}`

/** Saved missions as a sheet; 開く in the editor (a click opens: nothing is sent to a vehicle). */
export function MissionPicker({ dict, title, onPick, onClose, load = listMissions }: Props) {
  const { rows, error } = useSavedMissions(load)
  return (
    <aside className="g-strong sheet" aria-label={title} role="dialog">
      <PickerHead title={title} dict={dict} onClose={onClose} />
      {error && <div className="multi-note danger">{error}</div>}
      {rows && rows.length === 0 && <div className="multi-note">{dict.mNoSaved}</div>}
      {rows && rows.length > 0 && (
        <ul className="mission-picker">
          {rows.map((r) => (
            <li key={r.id} onClick={() => onPick(r)} role="button">
              <span>{r.name}</span>
              <span className="meta num">{rowMeta(r, dict)}</span>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
