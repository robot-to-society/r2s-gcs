// Saved briefings as a sheet, newest first (the briefing counterpart of MissionPicker), and the
// discard question shown before one replaces unsaved missions.
import { useEffect, useState } from 'react'
import type { BriefingSummary } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { IconClose } from '../../shared/ui/icons'
import { listBriefings } from './api'
import { ymdHm } from '../../shared/format/time'

interface Props {
  readonly dict: Dict
  readonly onPick: (id: number) => void
  readonly onClose: () => void
  readonly load?: () => Promise<BriefingSummary[]>
}

const newestFirst = (rows: readonly BriefingSummary[]): BriefingSummary[] => [...rows].sort((a, b) => b.updated_at - a.updated_at)

export function BriefingPicker({ dict, onPick, onClose, load = listBriefings }: Props) {
  const [rows, setRows] = useState<BriefingSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    load()
      .then((r) => alive && setRows(newestFirst(r)))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      alive = false
    }
  }, [load])
  return (
    <aside className="g-strong sheet" aria-label={dict.bfOpenTitle} role="dialog">
      <div className="panel-h">
        <span className="h1">{dict.bfOpenTitle}</span>
        <span className="grow" />
        <button type="button" className="btn-icon" aria-label={dict.close} onClick={onClose}>
          <IconClose />
        </button>
      </div>
      {error && <div className="multi-note danger">{error}</div>}
      {rows && rows.length === 0 && <div className="multi-note">{dict.bfNoSaved}</div>}
      {rows && rows.length > 0 && (
        <ul className="mission-picker">
          {rows.map((r) => (
            <li key={r.id} onClick={() => onPick(r.id)} role="button">
              <span className="brief-pick-name">{r.name}</span>
              <span className="meta num">
                {r.mission_count} {dict.bfMissions} · {ymdHm(r.updated_at)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}

/** 未保存の変更を破棄しますか? before a briefing replaces the open missions. */
export function DiscardSheet({ dict, onCancel, onContinue }: { readonly dict: Dict; readonly onCancel: () => void; readonly onContinue: () => void }) {
  return (
    <div className="g-strong discard-sheet" role="alertdialog" aria-label={dict.mDiscard}>
      <span>{dict.mDiscard}</span>
      <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" className="btn" onClick={onCancel}>
          {dict.cancel}
        </button>
        <button type="button" className="btn btn-primary" onClick={onContinue}>
          {dict.mContinue}
        </button>
      </div>
    </div>
  )
}
