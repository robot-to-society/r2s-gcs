import { useState } from 'react'
import { saveMapSettings, useAppSettings } from '../../shared/api/settings'
import type { Dict } from '../../shared/i18n'

/** 地図表示 (spec 10 §7, prototype app tab): the ジンバルを地面に投影 switch, saved on the server. */
export function MapDisplayCard({ dict }: { readonly dict: Dict }) {
  const settings = useAppSettings()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const on = settings?.map.gimbal_ground_projection ?? false
  const toggle = () => {
    setBusy(true)
    setFailed(false)
    saveMapSettings({ gimbal_ground_projection: !on })
      .catch(() => setFailed(true))
      .finally(() => setBusy(false))
  }
  return (
    <div className="surface" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="h1">{dict.mapDisplay}</div>
      <div className="setrow">
        <div>
          <div style={{ fontSize: 14, fontWeight: 500 }}>{dict.camProject}</div>
          <div className="t3" style={{ fontSize: 12, marginTop: 3 }}>
            {dict.camProjectNote}
          </div>
          {failed && (
            <div className="hint caution" style={{ marginTop: 6 }}>
              {dict.camProject} {dict.failed}
            </div>
          )}
        </div>
        <button type="button" className="switch" role="switch" aria-checked={on} aria-label={dict.camProject} title={dict.camProject} disabled={busy || settings === null} onClick={toggle}>
          <span className="knob" />
        </button>
      </div>
    </div>
  )
}
