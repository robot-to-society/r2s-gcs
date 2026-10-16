import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
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
      />,
    )
    expect(screen.getByTitle('Copters')).toHaveTextContent('2')
    expect(screen.getByTitle('Rovers')).toHaveTextContent('1')
    expect(screen.getByTestId('link')).toHaveTextContent('Server connected')
    expect(screen.getByText('2026/10/16 (Thu) 12:00')).toBeInTheDocument()
  })

  it('shows the disconnected state', () => {
    render(<Header vehicles={[]} link="closed" dict={t('ja')} clock="" />)
    expect(screen.getByTestId('link')).toHaveTextContent('サーバー未接続')
  })
})
