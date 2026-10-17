import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthStore } from '../features/auth/store'
import { App } from './App'

vi.mock('../features/map/MapView', () => ({ MapView: () => <div data-testid="map" /> }))

class FakeSocket {
  static instances: FakeSocket[] = []
  static get last(): FakeSocket | null {
    return FakeSocket.instances.at(-1) ?? null
  }
  readyState = 0
  onopen: (() => void) | null = null
  onmessage: ((ev: MessageEvent<string>) => void) | null = null
  onclose: ((ev: CloseEvent) => void) | null = null
  onerror: (() => void) | null = null
  constructor() {
    FakeSocket.instances.push(this)
  }
  send() {}
  close() {}
}

const me = { username: 'admin', role: 'admin', dev_mode: true, hostname: 'rgcs' }

function envelope(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** `/api/auth/me` answers from the queue in order; the last answer repeats. */
function stubMe(answers: number[]) {
  const queue = [...answers]
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const url = String(input)
    if (url === '/api/auth/me') {
      const status = queue.length > 1 ? queue.shift()! : queue[0]!
      return status === 200
        ? envelope(200, { success: true, data: me })
        : envelope(401, { success: false, error: { code: 'unauthorized', message: 'sign in first' } })
    }
    if (url === '/api/health') {
      return envelope(200, { success: true, data: { status: 'ok', hostname: 'rgcs', version: '0', dev_mode: true } })
    }
    return envelope(404, { success: false, error: { code: 'not_found', message: url } })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('App auth gate', () => {
  beforeEach(() => {
    FakeSocket.instances = []
    vi.stubGlobal('WebSocket', FakeSocket)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('renders nothing until the session is resolved', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
    const { container } = render(<App store={new AuthStore()} />)
    expect(container).toBeEmptyDOMElement()
    expect(FakeSocket.instances).toHaveLength(0)
  })

  it('renders the login screen when there is no session', async () => {
    stubMe([401])
    render(<App store={new AuthStore()} />)
    expect(await screen.findByRole('button', { name: 'ログイン' })).toBeInTheDocument()
    expect(FakeSocket.instances).toHaveLength(0)
  })

  it('renders the shell and connects the WebSocket when signed in', async () => {
    stubMe([200])
    render(<App store={new AuthStore()} />)
    expect(await screen.findByText('RGCS')).toBeInTheDocument()
    expect(FakeSocket.instances).toHaveLength(1)
    const s = FakeSocket.last!
    await act(async () => {
      s.readyState = 1
      s.onopen?.()
      s.onmessage?.({ data: JSON.stringify({ t: 'snapshot', vehicles: [], cameras: [] }) } as MessageEvent<string>)
    })
    expect(screen.getByTestId('link')).toHaveTextContent('サーバー接続')
  })

  it('keeps the shell and reconnects when the socket drops but the server is merely unreachable', async () => {
    const fetchMock = stubMe([200])
    render(<App store={new AuthStore()} />)
    await screen.findByText('RGCS')
    fetchMock.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')))
    await act(async () => {
      FakeSocket.last!.onclose?.({ code: 1006 } as CloseEvent)
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 600)) // first reconnect backoff is 500 ms
    })
    expect(screen.getByText('RGCS')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'ログイン' })).not.toBeInTheDocument()
    expect(FakeSocket.instances.length).toBeGreaterThanOrEqual(2)
  })

  it('drops to the login screen when the socket closes because the session expired', async () => {
    stubMe([200, 401])
    render(<App store={new AuthStore()} />)
    await screen.findByText('RGCS')
    const s = FakeSocket.last!
    await act(async () => {
      s.onclose?.({ code: 4401 } as CloseEvent)
    })
    expect(await screen.findByRole('button', { name: 'ログイン' })).toBeInTheDocument()
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1))
  })
})
