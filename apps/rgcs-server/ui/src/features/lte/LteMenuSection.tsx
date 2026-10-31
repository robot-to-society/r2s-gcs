import type { Dict } from '../../shared/i18n'
import { IconCheck } from '../../shared/ui/icons'
import { MAX_OPACITY, MIN_OPACITY, lteOverlayStore, useLteOverlayPrefs, type LteOverlayStore } from './prefs'

interface Props {
  readonly dict: Dict
  readonly onManage: () => void
  readonly store?: LteOverlayStore
}

/** The base-map menu's 「オーバーレイ」 section: the docomo LTE layer switch, its opacity and the area sheet. */
export function LteMenuSection({ dict, onManage, store = lteOverlayStore() }: Props) {
  const prefs = useLteOverlayPrefs(store)
  return (
    <div className="lte-menu" role="group" aria-label={dict.lteOverlays}>
      <div className="lte-menu-head">{dict.lteOverlays}</div>
      <button type="button" role="menuitemcheckbox" aria-checked={prefs.on} className={prefs.on ? 'on' : ''} onClick={() => store.toggle()}>
        <span className="grow">{dict.lteLayer}</span>
        {prefs.on && <IconCheck size={16} />}
      </button>
      <label className="lte-opacity">
        <span>{dict.lteOpacity}</span>
        <input type="range" min={MIN_OPACITY} max={MAX_OPACITY} step={5} value={prefs.opacity} aria-label={dict.lteOpacity} onChange={(e) => store.setOpacity(Number(e.target.value))} />
        <span className="num">{prefs.opacity}%</span>
      </label>
      <button type="button" role="menuitem" onClick={onManage}>
        <span className="grow">{dict.lteManage}</span>
      </button>
    </div>
  )
}
