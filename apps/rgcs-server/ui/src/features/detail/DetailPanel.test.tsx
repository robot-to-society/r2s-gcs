import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { VehicleState } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { DetailPanel } from './DetailPanel'

const v: VehicleState = {
  sysid: 1, name: 'UAV-01', kind: 'copter', mode: 'LOITER', armed: true, lat: 36, lon: 139, alt_rel: 81.6, alt_msl: 0, hdg: 0,
  ground_speed: 7.25, climb: 0, battery: { pct: 64, volt: 22.1, current: null }, link: 'ok', last_rx_ms: 0,
  gps: { fix: 3, sats: 12, hdop: 1 }, warn: false, unread: 0,
}
const messages = [
  { id: 2, sysid: 1, severity: 4, text: 'link_lost', ts: new Date(2026, 9, 17, 10, 5).getTime() },
  { id: 1, sysid: 1, severity: 6, text: 'Armed', ts: new Date(2026, 9, 17, 10, 4).getTime() },
  { id: 9, sysid: 2, severity: 6, text: 'other vehicle', ts: 0 },
]

describe('DetailPanel', () => {
  it('shows the video placeholder, the three big values and the message list', () => {
    render(<DetailPanel vehicle={v} messages={messages} acked={new Set()} onAck={() => {}} onClose={() => {}} onOpenCommands={() => {}} dict={t('ja')} />)
    expect(screen.getByText('映像未接続')).toBeInTheDocument()
    expect(screen.getByTestId('alt')).toHaveTextContent('82')
    expect(screen.getByTestId('speed')).toHaveTextContent('7.3')
    expect(screen.getByTestId('batt')).toHaveTextContent('64')
    expect(screen.getByText('通信喪失')).toHaveClass('caution')
    expect(screen.getByText('Armed')).toBeInTheDocument()
    expect(screen.queryByText('other vehicle')).not.toBeInTheDocument()
    expect(screen.getByText('10:05')).toBeInTheDocument()
    expect(screen.getByTestId('unread')).toHaveTextContent('2')
  })

  it('ack marks a row and the tiles open commands; maintenance and history are disabled', () => {
    const onAck = vi.fn()
    const onOpenCommands = vi.fn()
    render(<DetailPanel vehicle={v} messages={messages} acked={new Set([1])} onAck={onAck} onClose={() => {}} onOpenCommands={onOpenCommands} dict={t('ja')} />)
    expect(screen.getByTestId('unread')).toHaveTextContent('1')
    fireEvent.click(screen.getAllByRole('button', { name: '確認' })[0]!)
    expect(onAck).toHaveBeenCalledWith(2)
    fireEvent.click(screen.getByRole('button', { name: '全コマンド' }))
    expect(onOpenCommands).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'メンテナンス' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '履歴' })).toBeDisabled()
  })

  it('detail_panel_renders_the_progress_row_when_a_mission_is_known', () => {
    const mission = { id: 1, name: 'm', sysid: 1, default_alt: 60, default_frame: 'rel' as const, speed: 8, home: null, items: [] }
    const onWriteMission = vi.fn()
    const { rerender } = render(
      <DetailPanel vehicle={v} messages={[]} acked={new Set()} onAck={() => {}} onClose={() => {}} onOpenCommands={() => {}} dict={t('ja')} onWriteMission={onWriteMission} onStartMission={() => {}} />,
    )
    expect(screen.getByTestId('mission-progress')).toHaveTextContent('—')
    rerender(
      <DetailPanel vehicle={v} messages={[]} acked={new Set()} onAck={() => {}} onClose={() => {}} onOpenCommands={() => {}} dict={t('ja')} vehicleMission={mission} missionProgress={{ seq: 1, total: 1 }} onWriteMission={onWriteMission} onStartMission={() => {}} />,
    )
    expect(screen.getByTestId('mission-progress')).toHaveTextContent('WP 1 / 0')
  })
})
