import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CommandResult, InspectorRow, VehicleCommand, VehicleState } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { RateControls } from './RateControls'

const dict = t('ja')
const rx: InspectorRow = { dir: 'rx', sysid: 1, compid: 1, msg_id: 30, name: 'ATTITUDE', count: 5, rate_hz: 4, age_ms: 100 }
const veh = (link: string) => ({ sysid: 1, name: 'UAV-01', link }) as unknown as VehicleState
const setup = (row: InspectorRow, vehicle: VehicleState | undefined, results: readonly CommandResult[] = []) => {
  const send = vi.fn(async (_sysid: number, _command: VehicleCommand) => ({ id: 7 }))
  render(<RateControls row={row} vehicle={vehicle} results={results} dict={dict} send={send} />)
  return send
}
const params = (send: ReturnType<typeof setup>) => (send.mock.calls[0] as unknown as [number, { args: { mav_cmd: number; params: number[] } }])[1].args

describe('RateControls', () => {
  it('sends 511 with the message id and the interval in microseconds', async () => {
    const send = setup(rx, veh('ok'))
    fireEvent.change(screen.getByLabelText('レート'), { target: { value: '10' } })
    fireEvent.click(screen.getByRole('button', { name: '設定' }))
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send.mock.calls[0]?.[0]).toBe(1)
    expect(params(send)).toEqual({ mav_cmd: 511, params: [30, 100000, 0, 0, 0, 0, 0] })
  })
  it('default sends 0 and stop sends -1', async () => {
    const send = setup(rx, veh('ok'))
    fireEvent.click(screen.getByRole('button', { name: '既定に戻す' }))
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(params(send).params[1]).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: '停止' }))
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2))
    expect((send.mock.calls[1] as unknown as [number, { args: { params: number[] } }])[1].args.params[1]).toBe(-1)
  })
  it('does not send an invalid rate and flags the field', () => {
    const send = setup(rx, veh('ok'))
    const input = screen.getByLabelText('レート')
    fireEvent.change(input, { target: { value: '0' } })
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('button', { name: '設定' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '設定' }))
    fireEvent.change(input, { target: { value: '51' } })
    expect(send).not.toHaveBeenCalled()
  })
  it('shows the command result when it arrives', async () => {
    const result: CommandResult = { id: 7, sysid: 1, cmd: 'other', ok: false, reason: 'DENIED', ts: 1 }
    setup(rx, veh('ok'), [result])
    fireEvent.click(screen.getByRole('button', { name: '停止' }))
    expect(await screen.findByText(/失敗.*DENIED/)).toBeInTheDocument()
  })
  it('hides the controls for tx rows, other components and unknown / lost vehicles', () => {
    for (const [row, v] of [
      [{ ...rx, dir: 'tx' as const, sysid: 255, compid: 190 }, veh('ok')],
      [{ ...rx, compid: 100 }, veh('ok')],
      [rx, undefined],
      [rx, veh('lost')],
    ] as const) {
      const { unmount } = render(<RateControls row={row} vehicle={v} results={[]} dict={dict} send={vi.fn()} />)
      expect(screen.queryByRole('button', { name: '設定' })).toBeNull()
      expect(screen.getByTestId('insp-rate-note')).toBeInTheDocument()
      unmount()
    }
  })
})
