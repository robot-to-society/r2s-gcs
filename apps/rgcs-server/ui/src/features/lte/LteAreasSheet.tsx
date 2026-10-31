import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Dict } from '../../shared/i18n'
import { IconClose } from '../../shared/ui/icons'
import { LTE_API, type LteApi, type LteRect } from './api'
import { lteAreasStore, useLteAreas, type LteAreasStore } from './areasStore'
import { lteErrorText } from './errors'
import { LteAddForm } from './LteAddForm'
import { LteAreaRow } from './LteAreaRow'
import { lteViewRect, type LteMapKey } from './mapRegistry'

interface Props {
  readonly dict: Dict
  /** The map whose view 「いま表示している範囲を追加」 takes. */
  readonly mapKey: LteMapKey
  readonly onClose: () => void
  readonly api?: LteApi
  readonly store?: LteAreasStore
  readonly viewRect?: () => LteRect | null
}

/** 「範囲を管理…」: the saved LTE areas (progress, dates, 更新 / 削除) and adding the area in view. */
export function LteAreasSheet({ dict, mapKey, onClose, api = LTE_API, store = lteAreasStore(), viewRect }: Props) {
  const state = useLteAreas(true, store)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => void store.reload(), [store])

  const act = async (call: () => Promise<unknown>) => {
    setError(null)
    try {
      await call()
    } catch (e) {
      setError(lteErrorText(e, dict))
    }
    await store.reload()
  }

  return createPortal(
    <aside className="g-strong sheet lte-sheet" role="dialog" aria-label={dict.lteLayer}>
      <div className="row lte-sheet-head">
        <h3 className="grow">{dict.lteLayer}</h3>
        <button type="button" className="btn-icon" aria-label={dict.close} onClick={onClose}>
          <IconClose />
        </button>
      </div>
      <div className="sheet-body">
        {state.error && <div className="multi-note danger">{dict.lteErrLoad}</div>}
        {error && <div className="multi-note danger">{error}</div>}
        {state.loaded && state.areas.length === 0 && <div className="multi-note">{dict.lteNoAreas}</div>}
        {state.areas.length > 0 && (
          <ul className="lte-areas">
            {state.areas.map((a) => (
              <LteAreaRow key={a.id} area={a} dict={dict} onRefresh={(id) => void act(() => api.refresh(id))} onDelete={(id) => void act(() => api.remove(id))} />
            ))}
          </ul>
        )}
        <LteAddForm dict={dict} api={api} viewRect={viewRect ?? (() => lteViewRect(mapKey))} onAdded={() => void store.reload()} />
      </div>
    </aside>,
    document.body,
  )
}
