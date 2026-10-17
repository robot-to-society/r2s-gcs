import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthStore } from './store'
import { Login } from './Login'

function envelope(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function stubServer(opts: { devMode: boolean; login: { status: number; code: string } }) {
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input)
    if (url === '/api/health') {
      return envelope(200, { success: true, data: { status: 'ok', hostname: 'pi-01', version: '0.1.0', dev_mode: opts.devMode } })
    }
    if (url === '/api/auth/login' && init?.method === 'POST') {
      if (opts.login.status === 200) {
        return envelope(200, { success: true, data: { username: 'admin', role: 'admin', dev_mode: opts.devMode, hostname: 'pi-01' } })
      }
      return envelope(opts.login.status, { success: false, error: { code: opts.login.code, message: 'x' } })
    }
    return envelope(404, { success: false, error: { code: 'not_found', message: url } })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('Login', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.unstubAllGlobals())

  it('shows the dev badge and note only when dev_mode is true', async () => {
    stubServer({ devMode: true, login: { status: 200, code: '' } })
    const { unmount } = render(<Login store={new AuthStore()} />)
    expect(await screen.findByText('開発用')).toBeInTheDocument()
    expect(screen.getByText('開発用アカウント admin / admin')).toBeInTheDocument()
    expect(screen.getByText(/pi-01/)).toBeInTheDocument()
    unmount()
    stubServer({ devMode: false, login: { status: 200, code: '' } })
    render(<Login store={new AuthStore()} />)
    await screen.findByText(/pi-01/)
    expect(screen.queryByText('開発用')).not.toBeInTheDocument()
  })

  it('submits on Enter and shows the invalid-credentials error', async () => {
    const fetchMock = stubServer({ devMode: true, login: { status: 401, code: 'unauthorized' } })
    render(<Login store={new AuthStore()} />)
    fireEvent.change(screen.getByLabelText('ユーザー名'), { target: { value: 'admin' } })
    fireEvent.change(screen.getByLabelText('パスワード'), { target: { value: 'nope' } })
    fireEvent.submit(screen.getByRole('form'))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('ユーザー名またはパスワードが違います')
    expect(alert).toHaveClass('danger')
    const loginCall = fetchMock.mock.calls.find(([u]) => String(u) === '/api/auth/login')!
    expect(loginCall[1]?.body).toBe(JSON.stringify({ username: 'admin', password: 'nope' }))
  })

  it('clears the error when the input changes', async () => {
    stubServer({ devMode: true, login: { status: 401, code: 'unauthorized' } })
    render(<Login store={new AuthStore()} />)
    fireEvent.submit(screen.getByRole('form'))
    await screen.findByRole('alert')
    fireEvent.change(screen.getByLabelText('パスワード'), { target: { value: 'a' } })
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })

  it('shows the locked message on 429', async () => {
    stubServer({ devMode: true, login: { status: 429, code: 'locked' } })
    render(<Login store={new AuthStore()} />)
    fireEvent.submit(screen.getByRole('form'))
    expect(await screen.findByRole('alert')).toHaveTextContent('しばらく待ってから再試行してください')
  })

  it('switches language with the segment and persists it', async () => {
    stubServer({ devMode: false, login: { status: 200, code: '' } })
    render(<Login store={new AuthStore()} />)
    fireEvent.click(screen.getByRole('button', { name: 'EN' }))
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(localStorage.getItem('rgcs.lang')).toBe('en')
  })
})
