import { useEffect, useState } from 'react'
import { authStore } from '../features/auth/store'
import { useVehicles } from '../features/vehicles/store'
import { VehicleList } from '../features/vehicles/VehicleList'
import type { Me } from '../shared/api/types'
import { t, type Lang } from '../shared/i18n'
import { Footer } from './Footer'
import { Header } from './Header'
import type { View } from './view'

function formatClock(d: Date, lang: Lang): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const wd = lang === 'ja' ? ['日', '月', '火', '水', '木', '金', '土'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} (${wd[d.getDay()]}) ${p(d.getHours())}:${p(d.getMinutes())}`
}

function useClock(lang: Lang): string {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return formatClock(now, lang)
}

interface Props {
  readonly me: Me
  readonly lang: Lang
}

/** The signed-in application: header, stage with floating panels, footer. */
export function Shell({ me, lang }: Props) {
  const dict = t(lang)
  const { vehicles, link, results } = useVehicles()
  const [selected, setSelected] = useState<number | null>(null)
  const [view, setView] = useState<View>('ops')
  const clock = useClock(lang)
  const list = [...vehicles.values()].sort((a, b) => a.sysid - b.sysid)
  const current = selected ?? list[0]?.sysid ?? null
  return (
    <div className="shell">
      <div className="frame">
        <Header
          vehicles={list}
          link={link}
          dict={dict}
          clock={clock}
          me={me}
          view={view}
          onView={setView}
          onLogout={() => void authStore.logout()}
        />
        <main className="stage noright" style={{ position: 'absolute', inset: 0 }}>
          <VehicleList vehicles={list} selected={current} dict={dict} onSelect={setSelected} />
        </main>
        <Footer results={results} dict={dict} clock={clock.slice(-5)} />
      </div>
    </div>
  )
}
