import { useEffect } from 'react'
import { Login } from '../features/auth/Login'
import { authStore, useAuth, type AuthStore } from '../features/auth/store'
import { vehicleStore } from '../features/vehicles/store'
import { useLang } from '../shared/i18n/lang'
import { defaultWsUrl } from '../shared/ws/client'
import { Shell } from './Shell'

/** Close codes after which the session is re-checked: our own 4401, or an abnormal close
 *  (1006) which is what the browser reports when the `/ws` upgrade was refused with 401. */
const RECHECK_SESSION_CODES: ReadonlySet<number> = new Set([4401, 1006])

interface Props {
  /** Injected by tests; the app uses the singleton. */
  readonly store?: AuthStore
}

export function App({ store = authStore }: Props) {
  const auth = useAuth(store)
  const [lang] = useLang()

  useEffect(() => {
    void store.load()
  }, [store])

  useEffect(() => {
    if (auth.status !== 'authed') return
    vehicleStore.connect(defaultWsUrl(), (code) => {
      if (RECHECK_SESSION_CODES.has(code)) void store.recheck()
    })
    return () => vehicleStore.disconnect()
  }, [auth.status, store])

  if (auth.status === 'unknown') return null
  if (auth.status === 'anon' || auth.me === null) return <Login store={store} />
  return <Shell me={auth.me} lang={lang} />
}
