import { useEffect, useState, type FormEvent } from 'react'
import { apiFetch } from '../../shared/api/client'
import type { Health } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { useLang } from '../../shared/i18n/lang'
import { authStore, useAuth, type AuthStore } from './store'

interface Props {
  readonly store?: AuthStore
}

/** Login screen (spec 10 §2, prototype `.login .card`): aurora base, one glass card. */
export function Login({ store = authStore }: Props) {
  const [lang, setLang] = useLang()
  const dict = t(lang)
  const auth = useAuth(store)
  const [health, setHealth] = useState<Health | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    apiFetch<Health>('/api/health')
      .then((h) => alive && setHealth(h))
      .catch(() => alive && setHealth(null))
    return () => {
      alive = false
    }
  }, [])

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    await store.login(username, password)
    setBusy(false)
  }
  const onChange = (set: (v: string) => void) => (v: string) => {
    set(v)
    store.clearError()
  }
  const errorText =
    auth.error === 'invalid' ? dict.loginFailed : auth.error === 'locked' ? dict.loginLocked : auth.error ? dict.loginNetwork : null
  const dev = health?.dev_mode === true

  return (
    <div className="login-screen">
      <div className="aurora" />
      <section className="login">
        <form className="g-strong card" aria-label={dict.login} onSubmit={onSubmit}>
          <div className="row login-brand">
            <span className="brand">RGCS</span>
            {dev && <span className="dev">{dict.devBadge}</span>}
          </div>
          <div className="t3 login-host">
            {dict.connectedTo} <span className="mono">{health?.hostname ?? '…'}</span>
          </div>
          <label className="login-field">
            {dict.username}
            <input className="in lg" autoComplete="username" value={username} onChange={(e) => onChange(setUsername)(e.target.value)} />
          </label>
          <label>
            {dict.password}
            <input className="in lg" type="password" autoComplete="current-password" value={password} onChange={(e) => onChange(setPassword)(e.target.value)} />
          </label>
          <div className={`err${errorText ? ' danger' : ''}`} role={errorText ? 'alert' : undefined}>
            {errorText}
          </div>
          <button className="btn btn-lg btn-primary" type="submit" disabled={busy}>
            {dict.login}
          </button>
          <div className="row login-foot">
            <span className="t4 login-note">{dev ? dict.devNote : ''}</span>
            <div className="seg sm login-lang" role="group" aria-label="language">
              <span className="lens" style={{ transform: `translateX(${lang === 'ja' ? 0 : 100}%)` }} />
              <button type="button" className={lang === 'ja' ? 'on' : ''} onClick={() => setLang('ja')}>
                日本語
              </button>
              <button type="button" className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>
                English
              </button>
            </div>
          </div>
        </form>
      </section>
    </div>
  )
}
