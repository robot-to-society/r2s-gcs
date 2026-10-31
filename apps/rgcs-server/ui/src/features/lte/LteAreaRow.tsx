import { useState } from 'react'
import type { LteArea } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { IconRefresh, IconTrash } from '../../shared/ui/icons'
import { ymd } from './layer'

interface Props {
  readonly area: LteArea
  readonly dict: Dict
  readonly onRefresh: (id: number) => void
  readonly onDelete: (id: number) => void
}

function statusText(a: LteArea, dict: Dict): string {
  switch (a.status) {
    case 'fetching':
      return dict.lteStatusFetching.replace('{done}', String(a.tiles_ok + a.tiles_failed)).replace('{total}', String(a.tiles_total))
    case 'ready':
      return dict.lteStatusReady
    case 'partial':
      return dict.lteStatusPartial
    case 'failed':
      return dict.lteStatusFailed
    default:
      return dict.lteStatusIdle
  }
}

const rectText = (a: LteArea): string => `${a.south.toFixed(4)}, ${a.west.toFixed(4)} / ${a.north.toFixed(4)}, ${a.east.toFixed(4)}`

/** One saved area: what was fetched and when, 更新 and 削除 (asked in place, never `window.confirm`). */
export function LteAreaRow({ area: a, dict, onRefresh, onDelete }: Props) {
  const [asking, setAsking] = useState(false)
  const busy = a.status === 'fetching'
  return (
    <li className={`lte-area st-${a.status}`}>
      <div className="lte-area-head">
        <span className="grow lte-area-name">{a.name}</span>
        <span className="lte-area-status">{statusText(a, dict)}</span>
      </div>
      <div className="lte-area-meta num">{rectText(a)}</div>
      <div className="lte-area-meta">
        <span>{`${dict.lteFetchedAt} ${a.fetched_at === null ? dict.lteNever : ymd(a.fetched_at)}`}</span>
        <span>{`${dict.lteDataDate} ${a.data_modified === null ? dict.lteUnknown : ymd(a.data_modified)}`}</span>
        <span>{dict.lteCounts.replace('{ok}', String(a.tiles_ok)).replace('{failed}', String(a.tiles_failed))}</span>
      </div>
      <div className="lte-area-actions">
        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => onRefresh(a.id)}>
          <IconRefresh />
          {dict.lteRefresh}
        </button>
        <button type="button" className="btn-icon" disabled={busy} aria-label={dict.lteDeleteNamed.replace('{name}', a.name)} title={dict.lteDelete} onClick={() => setAsking(true)}>
          <IconTrash size={14} />
        </button>
      </div>
      {asking && (
        <div className="multi-note picker-ask" role="alertdialog" aria-label={dict.lteDelete}>
          <span>{dict.lteDeleteAsk.replace('{name}', a.name)}</span>
          <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-sm" onClick={() => setAsking(false)}>
              {dict.cancel}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-danger"
              onClick={() => {
                setAsking(false)
                onDelete(a.id)
              }}
            >
              {dict.lteDelete}
            </button>
          </div>
        </div>
      )}
    </li>
  )
}
