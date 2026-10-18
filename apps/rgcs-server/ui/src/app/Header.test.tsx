import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { t } from '../shared/i18n'
import type { VehicleState } from '../shared/api/types'
import { Header } from './Header'

const mk = (sysid: number, kind: VehicleState['kind'], link: VehicleState['link']): VehicleState => ({
  sysid,
  name: `UAV-0${sysid}`,
  kind,
  mode: 'AUTO',
  armed: true,
  lat: 0,
  lon: 0,
  alt_rel: 0,
  alt_msl: 0,
  hdg: null,
  ground_speed: 0,
  climb: 0,
  battery: { pct: 50, volt: 22, current: null },
  link,
  last_rx_ms: 0,
  gps: { fix: 3, sats: 9, hdop: 1 },
  warn: false,
  unread: 0,
})

describe('Header', () => {
  it('counts copters, rovers and vehicles with link trouble', () => {
    render(
      <Header
        vehicles={[mk(1, 'copter', 'ok'), mk(2, 'copter', 'lost'), mk(3, 'rover', 'ok')]}
        link="open"
        dict={t('en')}
        clock="2026/10/16 (Thu) 12:00"
        me={{ username: 'op', role: 'operator', dev_mode: false, hostname: 'rgcs' }}
        view="ops"
        onView={() => {}}
        onLogout={() => {}}
      />,
    )
    expect(screen.getByTitle('Copters')).toHaveTextContent('2')
    expect(screen.getByTitle('Rovers')).toHaveTextContent('1')
    expect(screen.getByTestId('link')).toHaveAttribute('title', 'Server connected')
    expect(screen.getByText('2026/10/16 (Thu) 12:00')).toBeInTheDocument()
  })

  it('shows the disconnected state', () => {
    render(
      <Header
        vehicles={[]}
        link="closed"
        dict={t('ja')}
        clock=""
        me={{ username: 'op', role: 'operator', dev_mode: false, hostname: 'rgcs' }}
        view="ops"
        onView={() => {}}
        onLogout={() => {}}
      />,
    )
    expect(screen.getByTestId('link')).toHaveAttribute('title', 'サーバー未接続')
  })
})

describe('Header user menu', () => {
  const me = { username: 'admin', role: 'admin' as const, dev_mode: true, hostname: 'rgcs' }

  it('toggles the popover from the username and logs out through it', () => {
    const onLogout = vi.fn()
    render(
      <Header vehicles={[]} link="open" dict={t('ja')} clock="" me={me} view="ops" onView={() => {}} onLogout={onLogout} />,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'admin' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'ログアウト' }))
    expect(onLogout).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'admin' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it('maintenance_shows_its_label_and_a_close_button_back_to_the_map', () => {
    const onView = vi.fn()
    const me = { username: 'op', role: 'operator' as const, dev_mode: false, hostname: 'rgcs' }
    const { rerender } = render(<Header vehicles={[]} link="open" dict={t('ja')} clock="" me={me} view="maint" onView={onView} onLogout={() => {}} />)
    expect(screen.getByText('メンテナンス')).toHaveClass('t2')
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
    expect(onView).toHaveBeenCalledWith('ops')
    rerender(<Header vehicles={[]} link="open" dict={t('ja')} clock="" me={me} view="ops" onView={onView} onLogout={() => {}} />)
    expect(screen.queryByText('メンテナンス')).toBeNull()
    expect(screen.queryByRole('button', { name: '閉じる' })).toBeNull()
  })
})
