import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'

class FakeSocket {
  static last: FakeSocket | null = null
  readyState = 0
  onopen: (() => void) | null = null
  onmessage: ((ev: MessageEvent<string>) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor() {
    FakeSocket.last = this
  }
  send() {}
  close() {}
}

describe('App', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', FakeSocket)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('connects on mount and lists vehicles from the snapshot', async () => {
    render(<App />)
    expect(screen.getByText('機体が接続されるとここに表示されます')).toBeInTheDocument()
    const s = FakeSocket.last!
    await act(async () => {
      s.readyState = 1
      s.onopen?.()
      s.onmessage?.({
        data: JSON.stringify({
          t: 'snapshot',
          vehicles: [
            {
              sysid: 1,
              name: 'UAV-01',
              kind: 'copter',
              mode: 'LOITER',
              armed: true,
              lat: 0,
              lon: 0,
              alt_rel: 12,
              alt_msl: 0,
              hdg: 0,
              ground_speed: 1,
              climb: 0,
              battery: { pct: 90, volt: 24, current: null },
              link: 'ok',
              last_rx_ms: 0,
              gps: { fix: 3, sats: 12, hdop: 1 },
              warn: false,
              unread: 0,
            },
          ],
        }),
      } as MessageEvent<string>)
    })
    expect(screen.getByRole('option', { selected: true })).toHaveTextContent('UAV-01')
    expect(screen.getByTestId('link')).toHaveTextContent('サーバー接続')
  })
})
