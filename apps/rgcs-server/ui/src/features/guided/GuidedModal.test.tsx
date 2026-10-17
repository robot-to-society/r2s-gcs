import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { VehicleState } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { GuidedModal } from './GuidedModal'

const v: VehicleState = {
  sysid: 1, name: 'UAV-01', kind: 'copter', mode: 'GUIDED', armed: true, lat: 36, lon: 139, alt_rel: 30, alt_msl: 0, hdg: 0,
  ground_speed: 0, climb: 0, battery: { pct: 50, volt: 22, current: null }, link: 'ok', last_rx_ms: 0,
  gps: { fix: 3, sats: 10, hdop: 1 }, warn: false, unread: 0,
}
const base = { vehicle: v, onPickTarget: () => {}, onClose: () => {}, onDone: () => {}, onSwitchToGuided: () => {}, dict: t('ja') }

describe('GuidedModal', () => {
  it('disables start without a target and shows the altitude input only for "set"', () => {
    render(<GuidedModal {...base} target={null} />)
    expect(screen.getByRole('button', { name: '移動開始' })).toBeDisabled()
    expect(screen.queryByLabelText('高度 (m)')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '指定(ホーム相対)' }))
    expect(screen.getByLabelText('高度 (m)')).toBeInTheDocument()
  })

  it('sends the target with keep/set altitude and reports the result', async () => {
    const send = vi.fn().mockResolvedValue({ id: 7, warning: 'fence_unknown' })
    const onDone = vi.fn()
    render(<GuidedModal {...base} target={{ lat: 36.1, lon: 139.2 }} onDone={onDone} deps={{ send, confirm: vi.fn() }} />)
    expect(screen.getByText(/36\.1/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '移動開始' }))
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ kind: 'sent', id: 7, warning: 'fence_unknown' }))
    expect(send).toHaveBeenCalledWith(1, { lat: 36.1, lon: 139.2, alt_mode: 'keep', confirm_token: undefined })
  })

  it('offers the GUIDED switch on mode_required and a confirm step on confirm_required', async () => {
    const { ApiError } = await import('../../shared/api/client')
    const send = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(409, 'mode_required', 'switch'))
      .mockRejectedValueOnce(new ApiError(409, 'confirm_required', 'confirm token required'))
      .mockResolvedValueOnce({ id: 9, warning: null })
    const confirm = vi.fn().mockResolvedValue({ confirm_token: 'tok', expires_in: 30 })
    const onSwitch = vi.fn()
    const onDone = vi.fn()
    render(<GuidedModal {...base} target={{ lat: 36.1, lon: 139.2 }} onSwitchToGuided={onSwitch} onDone={onDone} deps={{ send, confirm }} />)
    fireEvent.click(screen.getByRole('button', { name: '移動開始' }))
    const sw = await screen.findByRole('button', { name: 'GUIDED に切替' })
    fireEvent.click(sw)
    expect(onSwitch).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '移動開始' }))
    const confirmBtn = await screen.findByRole('button', { name: '確認して移動開始' })
    fireEvent.click(confirmBtn)
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ kind: 'sent', id: 9, warning: null }))
    expect(confirm).toHaveBeenCalledWith(1, 'guided')
    expect(send).toHaveBeenLastCalledWith(1, { lat: 36.1, lon: 139.2, alt_mode: 'keep', confirm_token: 'tok' })
  })
})
