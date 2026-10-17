import { useEffect, useState, type FormEvent } from 'react'
import { apiFetch } from '../../shared/api/client'
import type { Health } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { useLang } from '../../shared/i18n/lang'
import { authStore, useAuth, type AuthStore } from './store'

interface Props {
  readonly store?: AuthStore
}

/** Login screen (spec 10 §2): full-bleed base + aurora, one `.g-strong.login` card. */
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
      <form className="g-strong login" aria-label={dict.login} onSubmit={onSubmit}>
        <div className="row login-brand">
          <span className="brand">RGCS</span>
          {dev && <span className="badge dev">{dict.devBadge}</span>}
        </div>
        <div className="t3 login-host">
          {dict.connectedTo}: {health?.hostname ?? '…'}
        </div>
        <label className="login-field">
          <span>{dict.username}</span>
          <input className="in lg" autoComplete="username" value={username} onChange={(e) => onChange(setUsername)(e.target.value)} />
        </label>
        <label className="login-field">
          <span>{dict.password}</span>
          <input
            className="in lg"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => onChange(setPassword)(e.target.value)}
          />
        </label>
        {errorText && (
          <div className="login-error danger" role="alert">
            {errorText}
          </div>
        )}
        <button className="btn btn-primary btn-lg" type="submit" disabled={busy}>
          {dict.login}
        </button>
        <div className="seg sm login-lang" role="group" aria-label="language">
          <span className="lens" style={{ transform: `translateX(${lang === 'ja' ? 0 : 100}%)` }} />
          <button type="button" className={lang === 'ja' ? 'on' : ''} onClick={() => setLang('ja')}>
            日本語
          </button>
          <button type="button" className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>
            EN
          </button>
        </div>
        {dev && <div className="t3 login-note">{dict.devNote}</div>}
      </form>
    </div>
  )
}
