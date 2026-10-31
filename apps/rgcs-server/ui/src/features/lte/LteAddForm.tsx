import { useState } from 'react'
import type { Dict } from '../../shared/i18n'
import { IconPlus } from '../../shared/ui/icons'
import type { LteApi, LteRect } from './api'
import { LTE_MAX_TILES, lteErrorText } from './errors'

interface Props {
  readonly dict: Dict
  readonly api: LteApi
  /** The map's view right now (null: no map). */
  readonly viewRect: () => LteRect | null
  /** After a successful add: the list is read again. */
  readonly onAdded: () => void
}

interface Draft {
  readonly rect: LteRect
  readonly name: string
  /** null while counting (or when the count failed). */
  readonly tiles: number | null
}

const MAX_NAME = 60

/** 「いま表示している範囲を追加」: takes the view, shows its tile count, then a name and 取得. */
export function LteAddForm({ dict, api, viewRect, onAdded }: Props) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const start = () => {
    const rect = viewRect()
    setError(rect ? null : dict.lteErrNoView)
    setDraft(rect ? { rect, name: '', tiles: null } : null)
    if (!rect) return
    api.estimate(rect).then(
      (tiles) => setDraft((d) => (d && d.rect === rect ? { ...d, tiles } : d)),
      (e: unknown) => setError(lteErrorText(e, dict)),
    )
  }

  const submit = async (d: Draft) => {
    setSending(true)
    setError(null)
    try {
      await api.create({ name: d.name.trim(), ...d.rect })
      setDraft(null)
      onAdded()
    } catch (e) {
      setError(lteErrorText(e, dict))
    } finally {
      setSending(false)
    }
  }

  const name = draft?.name.trim() ?? ''
  const tooMany = draft?.tiles != null && draft.tiles > LTE_MAX_TILES
  const ready = draft !== null && draft.tiles !== null && !tooMany && name.length > 0 && name.length <= MAX_NAME && !sending
  return (
    <div className="lte-add">
      <button type="button" className="btn btn-sm" onClick={start}>
        <IconPlus size={14} />
        {dict.lteAddView}
      </button>
      {draft && (
        <div className="lte-add-form">
          <input type="text" aria-label={dict.lteName} placeholder={dict.lteName} maxLength={MAX_NAME} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <span className="num lte-add-tiles">{draft.tiles === null ? dict.lteEstimating : dict.lteTiles.replace('{n}', String(draft.tiles))}</span>
          <button type="button" className="btn btn-sm btn-primary" disabled={!ready} onClick={() => void submit(draft)}>
            {dict.lteFetch}
          </button>
        </div>
      )}
      {tooMany && <div className="multi-note danger">{dict.lteErrTooMany.replace('{max}', String(LTE_MAX_TILES))}</div>}
      {error && <div className="multi-note danger">{error}</div>}
    </div>
  )
}
