import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { LogEntry, VehicleState } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { CommandDock } from './CommandDock'

const v = (sysid: number, armed = false): VehicleState => ({
  sysid, name: `UAV-0${sysid}`, kind: 'copter', mode: 'LOITER', armed, lat: 0, lon: 0, alt_rel: 0, alt_msl: 0, hdg: null,
  ground_speed: 0, climb: 0, battery: { pct: 50, volt: 22, current: null }, link: 'ok', last_rx_ms: 0,
  gps: { fix: 3, sats: 10, hdop: 1 }, warn: false, unread: 0,
})

function setup(vehicle: VehicleState, entries: LogEntry[] = []) {
  const send = vi.fn(async () => ({ id: 7 }))
  const confirm = vi.fn(async () => ({ confirm_token: 'tok', expires_in: 30 }))
  const onClose = vi.fn()
  const onOpenGuided = vi.fn()
  const props = { dict: t('ja'), entries, onClose, onOpenGuided, deps: { send, confirm }, onError: vi.fn() }
  const view = render(<CommandDock vehicle={vehicle} {...props} />)
  return { send, confirm, onClose, onOpenGuided, rerender: (next: VehicleState) => view.rerender(<CommandDock vehicle={next} {...props} />) }
}

const panel = () => screen.getByRole('complementary', { name: '全コマンド' })

describe('CommandDock', () => {
  it('the_panel_stays_open_after_a_command', async () => {
    const { send, onClose } = setup(v(1, true))
    fireEvent.click(within(panel()).getByRole('button', { name: /一時停止/ }))
    await waitFor(() => expect(send).toHaveBeenCalledWith(1, { cmd: 'pause' }, undefined))
    expect(panel()).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('a_confirm_command_opens_a_modal_over_the_panel_and_the_panel_stays', async () => {
    const { send, confirm } = setup(v(1))
    fireEvent.click(within(panel()).getByRole('button', { name: 'アーム' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog.closest('.modal-backdrop')).not.toBeNull()
    expect(panel()).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: '実行' }))
    await waitFor(() => expect(send).toHaveBeenCalledWith(1, { cmd: 'arm' }, 'tok'))
    expect(confirm).toHaveBeenCalledWith(1, 'arm')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(panel()).toBeInTheDocument()
  })

  it('cancelling_the_confirm_keeps_the_panel', async () => {
    const { send } = setup(v(1))
    fireEvent.click(within(panel()).getByRole('button', { name: 'アーム' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'キャンセル' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(panel()).toBeInTheDocument()
    expect(send).not.toHaveBeenCalled()
  })

  it('commands_go_to_the_currently_selected_vehicle', async () => {
    const { send, rerender } = setup(v(1, true))
    rerender(v(2, true))
    expect(within(panel()).getByText('UAV-02')).toBeInTheDocument()
    fireEvent.click(within(panel()).getByRole('button', { name: /一時停止/ }))
    await waitFor(() => expect(send).toHaveBeenCalledWith(2, { cmd: 'pause' }, undefined))
  })

  it('shows_the_last_result_for_the_target_vehicle_from_the_persisted_log', () => {
    const e = (id: number, sysid: number, text: string, severity: LogEntry['severity'], source: LogEntry['source'] = 'command'): LogEntry => ({ id, ts: new Date(2026, 9, 19, 10, 0, id).getTime(), sysid, source, severity, text, ackable: false, acked_by: null, acked_at: null })
    setup(v(1, true), [e(9, 1, 'PreArm: GPS', 'error', 'vehicle'), e(8, 2, 'rtl timeout', 'error'), e(5, 1, 'pause', 'ok')])
    expect(within(panel()).getByTestId('cmd-last')).toHaveTextContent('10:00:05 一時停止 成功')
  })
})
