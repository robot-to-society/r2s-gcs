import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { LogEntry, VehicleState } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { DetailPanel } from './DetailPanel'

const v: VehicleState = {
  sysid: 1, name: 'UAV-01', kind: 'copter', mode: 'LOITER', armed: true, lat: 36, lon: 139, alt_rel: 81.6, alt_msl: 0, hdg: 0,
  ground_speed: 7.25, climb: 0, battery: { pct: 64, volt: 22.1, current: null }, link: 'ok', last_rx_ms: 0,
  gps: { fix: 3, sats: 12, hdop: 1 }, warn: false, unread: 0,
}
const at = (m: number) => new Date(2026, 9, 17, 10, m).getTime()
const entry = (id: number, over: Partial<LogEntry> = {}): LogEntry => ({ id, ts: at(id), sysid: 1, source: 'vehicle', severity: 'info', text: `m${id}`, ackable: false, acked_by: null, acked_at: null, ...over })
const entries: LogEntry[] = [
  entry(5, { severity: 'error', text: 'EKF failure', ackable: true }),
  entry(4, { source: 'link', severity: 'warn', text: 'comms_delay', ackable: true }),
  entry(3, { severity: 'warn', text: 'PreArm', ackable: true, acked_by: 'admin', acked_at: 1 }),
  entry(2, { text: 'older' }),
  entry(9, { sysid: 2, text: 'other vehicle' }),
]
const base = { vehicle: v, entries, onAck: () => {}, onOpenLog: () => {}, onClose: () => {}, onOpenCommands: () => {}, dict: t('ja') }

describe('DetailPanel', () => {
  it('shows the video placeholder, the three big values and the last three messages of the vehicle', () => {
    render(<DetailPanel {...base} />)
    expect(screen.getByText('映像未接続')).toBeInTheDocument()
    expect(screen.getByTestId('alt')).toHaveTextContent('82')
    expect(screen.getByTestId('speed')).toHaveTextContent('7.3')
    expect(screen.getByTestId('batt')).toHaveTextContent('64')
    const rows = screen.getAllByTestId('msg')
    expect(rows).toHaveLength(3)
    expect(rows[1]).toHaveTextContent('通信遅延')
    expect(rows[1]).toHaveTextContent('通信の応答が遅延しています。')
    expect(rows[0]).toHaveTextContent('10:05')
    expect(screen.queryByText('older')).toBeNull()
    expect(screen.queryByText('other vehicle')).toBeNull()
  })

  it('only_alerts_have_an_ack_button', () => {
    render(<DetailPanel {...base} entries={[entry(2, { severity: 'info' }), entry(1, { source: 'command', severity: 'error', text: 'arm' })]} />)
    expect(screen.queryByRole('button', { name: '確認' })).toBeNull()
    expect(screen.queryByText('確認済み')).toBeNull()
  })

  it('ack_calls_the_api_and_marks_the_row', () => {
    const onAck = vi.fn()
    render(<DetailPanel {...base} onAck={onAck} />)
    const buttons = screen.getAllByRole('button', { name: '確認' })
    expect(buttons).toHaveLength(2)
    expect(buttons[0]).toHaveClass('ackbtn', 'err')
    expect(buttons[1]).not.toHaveClass('err')
    fireEvent.click(buttons[0]!)
    expect(onAck).toHaveBeenCalledWith(1, 5)
    const rows = screen.getAllByTestId('msg')
    expect(rows[2]).toHaveClass('msg', 'warn', 'done')
    expect(rows[2]).toHaveTextContent('確認済み')
  })

  it('header_counts_pending_alerts', () => {
    const { rerender } = render(<DetailPanel {...base} />)
    expect(screen.getByTitle('確認待ちの警告')).toHaveTextContent('2')
    rerender(<DetailPanel {...base} entries={[entry(2)]} />)
    expect(screen.queryByTitle('確認待ちの警告')).toBeNull()
  })

  it('chevron_opens_the_filtered_history and the tiles open commands', () => {
    const onOpenLog = vi.fn()
    const onOpenCommands = vi.fn()
    render(<DetailPanel {...base} onOpenLog={onOpenLog} onOpenCommands={onOpenCommands} />)
    fireEvent.click(screen.getByRole('button', { name: 'メッセージ履歴' }))
    expect(onOpenLog).toHaveBeenCalledWith(1)
    fireEvent.click(screen.getByRole('button', { name: '全コマンド' }))
    expect(onOpenCommands).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'メンテナンス' })).toBeDisabled()
  })

  it('empty_state', () => {
    render(<DetailPanel {...base} entries={[]} />)
    expect(screen.getByText('メッセージはありません')).toBeInTheDocument()
  })

  it('detail_panel_renders_the_progress_row_when_a_mission_is_known', () => {
    const mission = { id: 1, name: 'm', sysid: 1, default_alt: 60, default_frame: 'rel' as const, speed: 8, home: null, fence: [], rally: [], items: [] }
    const onWriteMission = vi.fn()
    const { rerender } = render(
      <DetailPanel {...base} entries={[]} onWriteMission={onWriteMission} onStartMission={() => {}} />,
    )
    expect(screen.getByTestId('mission-progress')).toHaveTextContent('—')
    rerender(
      <DetailPanel {...base} entries={[]} vehicleMission={mission} missionProgress={{ seq: 1, total: 1 }} onWriteMission={onWriteMission} onStartMission={() => {}} />,
    )
    expect(screen.getByTestId('mission-progress')).toHaveTextContent('WP 1 / 0')
  })
  it('emergency buttons send pause / RTL / land to the shown vehicle and show their state', () => {
    const onCommand = vi.fn()
    render(<DetailPanel {...base} onCommand={onCommand} feedback={(cmd) => (cmd === 'rtl' ? 'sending' : null)} />)
    const row = screen.getByRole('group', { name: '緊急操作' })
    expect([...row.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['一時停止', '帰還', '着陸'])
    fireEvent.click(screen.getByRole('button', { name: '一時停止' }))
    expect(onCommand).toHaveBeenLastCalledWith({ cmd: 'pause' })
    fireEvent.click(screen.getByRole('button', { name: '着陸' }))
    expect(onCommand).toHaveBeenLastCalledWith({ cmd: 'land' })
    expect(screen.getByRole('button', { name: '帰還' }).className).toContain('sending')
  })
  it('emergency buttons stay usable but marked when the link is lost', () => {
    render(<DetailPanel {...base} vehicle={{ ...v, link: 'lost' }} onCommand={() => {}} />)
    const b = screen.getByRole('button', { name: '一時停止' })
    expect(b).toBeEnabled()
    expect(b.className).toContain('stale')
  })
})
