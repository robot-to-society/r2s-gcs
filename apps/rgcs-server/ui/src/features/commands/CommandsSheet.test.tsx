import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { VehicleState } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { CommandsSheet } from './CommandsSheet'

const v = (armed: boolean): VehicleState => ({
  sysid: 1, name: 'UAV-01', kind: 'copter', mode: 'LOITER', armed, lat: 0, lon: 0, alt_rel: 0, alt_msl: 0, hdg: null,
  ground_speed: 0, climb: 0, battery: { pct: 50, volt: 22, current: null }, link: 'ok', last_rx_ms: 0,
  gps: { fix: 3, sats: 9, hdop: 1 }, warn: false, unread: 0,
})

describe('CommandsSheet', () => {
  it('disables ARM when armed and filters by label', () => {
    render(<CommandsSheet vehicle={v(true)} onPick={() => {}} onOpen={() => {}} onClose={() => {}} dict={t('ja')} />)
    expect(screen.getByRole('button', { name: 'ARM' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'DISARM' })).toBeEnabled()
    fireEvent.change(screen.getByPlaceholderText('コマンドを検索'), { target: { value: 'rtl' } })
    expect(screen.getByRole('button', { name: 'RTL' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'ARM' })).not.toBeInTheDocument()
  })

  it('picks simple and parameterised commands in the serde shape, and opens guided', () => {
    const onPick = vi.fn()
    const onOpen = vi.fn()
    render(<CommandsSheet vehicle={v(false)} onPick={onPick} onOpen={onOpen} onClose={() => {}} dict={t('ja')} />)
    fireEvent.click(screen.getByRole('button', { name: 'ARM' }))
    expect(onPick).toHaveBeenLastCalledWith({ cmd: 'arm' })
    fireEvent.change(screen.getByLabelText('モード変更'), { target: { value: 'AUTO' } })
    fireEvent.click(screen.getByRole('button', { name: 'モード変更' }))
    expect(onPick).toHaveBeenLastCalledWith({ cmd: 'set_mode', args: { mode: 'AUTO' } })
    fireEvent.change(screen.getByLabelText('高度変更'), { target: { value: '55' } })
    fireEvent.click(screen.getByRole('button', { name: '高度変更' }))
    expect(onPick).toHaveBeenLastCalledWith({ cmd: 'change_alt', args: { alt_rel: 55 } })
    fireEvent.click(screen.getByRole('button', { name: 'Guided 移動' }))
    expect(onOpen).toHaveBeenCalledWith('guided')
  })
})
