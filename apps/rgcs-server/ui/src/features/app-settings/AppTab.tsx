// アプリ設定 tab (spec 10 §7, addendum §5.7): 表示言語, 表示 (theme), 地図表示, 機体台帳, 操縦者, 点検テンプレート and the
// link to the ロゴ・提示用トークン sheet. Card grid after the prototype's app tab.
import type { Operator, VehicleState } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { useLang } from '../../shared/i18n/lang'
import { DisplayCard } from './DisplayCard'
import { MapDisplayCard } from './MapDisplayCard'
import { MavlinkCard } from './MavlinkCard'
import { PilotForm } from './PilotForm'
import { RegistryForm } from './RegistryForm'
import { TemplateEditor } from './TemplateEditor'

interface Props {
  readonly sysid: number | null
  readonly vehicle: VehicleState | undefined
  readonly me: Operator
  readonly dict: Dict
  readonly onOpenPresent: () => void
}

export function AppTab({ sysid, vehicle, me, dict, onOpenPresent }: Props) {
  const [lang, setLang] = useLang()
  const isAdmin = me.role === 'admin'
  return (
    <div className="maint-body lb-cards">
      <div className="surface">
        <div className="h1">{dict.lbLanguage}</div>
        <div className="seg lang">
          <span className="lens" style={{ transform: `translateX(${lang === 'ja' ? 0 : 100}%)` }} />
          <button type="button" className={lang === 'ja' ? 'on' : ''} onClick={() => setLang('ja')}>
            日本語
          </button>
          <button type="button" className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>
            English
          </button>
        </div>
        <button type="button" className="btn" style={{ alignSelf: 'flex-start' }} onClick={onOpenPresent}>
          {dict.lbPresentSettings}
        </button>
      </div>
      <DisplayCard dict={dict} />
      <MapDisplayCard dict={dict} />
      <MavlinkCard dict={dict} isAdmin={isAdmin} />
      {sysid !== null && <RegistryForm key={sysid} sysid={sysid} vehicle={vehicle} isAdmin={isAdmin} dict={dict} />}
      <PilotForm dict={dict} />
      <TemplateEditor dict={dict} isAdmin={isAdmin} />
    </div>
  )
}
