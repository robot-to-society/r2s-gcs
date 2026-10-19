import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Mission, VehicleState } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { MissionProgressRow } from './MissionProgressRow'

const v = (armed: boolean): VehicleState => ({
  sysid: 1, name: 'UAV-01', kind: 'copter', mode: 'AUTO', armed, lat: 36.162, lon: 139.37755, alt_rel: 60, alt_msl: 0, hdg: 0,
  ground_speed: 8, climb: 0, battery: { pct: 70, volt: 23, current: null }, link: 'ok', last_rx_ms: 0, gps: { fix: 3, sats: 12, hdop: 1 }, warn: false, unread: 0,
})
const item = (command: number, lat: number, lon: number, alt: number) => ({ command, frame: 'rel' as const, params: [0, 0, 0, 0] as [number, number, number, number], lat, lon, alt, autocontinue: true })
const mission: Mission = {
  id: 1, name: 'demo', sysid: 1, default_alt: 60, default_frame: 'rel', speed: 8, home: null,
  items: [item(22, 36.162, 139.372, 30), item(16, 36.162, 139.3831, 60), item(16, 36.162, 139.3942, 60), item(20, 0, 0, 0)],
}

describe('MissionProgressRow', () => {
  it('progress_row_shows_current_and_remaining', () => {
    render(<MissionProgressRow progress={{ seq: 2, total: 5 }} mission={mission} vehicle={v(true)} dict={t('ja')} onWrite={() => {}} onStart={() => {}} />)
    expect(screen.getByTestId('mission-progress')).toHaveTextContent('WP 2 / 4')
    expect(screen.getByTestId('mission-progress')).toHaveTextContent(/残り 1\.[45]\d km/)
  })

  it('write_works_in_flight_and_start_needs_a_known_mission', () => {
    const onWrite = vi.fn()
    const onStart = vi.fn()
    const { rerender } = render(<MissionProgressRow progress={null} mission={null} vehicle={v(true)} dict={t('ja')} onWrite={onWrite} onStart={onStart} />)
    expect(screen.getByTestId('mission-progress')).toHaveTextContent('—')
    // ArduPilot takes a new mission while armed
    expect(screen.getByRole('button', { name: 'ミッション書込' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: '開始' })).not.toBeInTheDocument()
    rerender(<MissionProgressRow progress={null} mission={mission} vehicle={v(false)} dict={t('ja')} onWrite={onWrite} onStart={onStart} />)
    fireEvent.click(screen.getByRole('button', { name: 'ミッション書込' }))
    expect(onWrite).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '開始' }))
    expect(onStart).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('mission-progress')).toHaveTextContent('4 項目')
  })

  it('falls_back_to_the_wire_total_when_the_mission_is_unknown', () => {
    render(<MissionProgressRow progress={{ seq: 3, total: 20 }} mission={null} vehicle={v(true)} dict={t('ja')} onWrite={() => {}} onStart={() => {}} />)
    expect(screen.getByTestId('mission-progress')).toHaveTextContent('WP 3 / 20')
  })

  it('shows_the_write_progress_while_a_mission_is_written', () => {
    render(<MissionProgressRow progress={null} mission={mission} vehicle={v(true)} dict={t('ja')} onWrite={() => {}} onStart={() => {}} transfer={{ phase: 'write', done: 3, total: 5 }} />)
    expect(screen.getByRole('progressbar', { name: 'ミッション書込' })).toHaveTextContent('書込中 3 / 5')
  })
})
