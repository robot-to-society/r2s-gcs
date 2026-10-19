import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { VehicleState } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { FleetConfirm } from './FleetConfirm'

const v = (sysid: number) => ({ sysid, name: `UAV-0${sysid}`, link: 'ok' }) as VehicleState

describe('FleetConfirm', () => {
  it('lists the targets, runs on all of them and reports each result', async () => {
    const send = vi.fn(async (sysid: number) => {
      if (sysid === 2) throw new Error('busy')
      return { id: sysid }
    })
    const onResult = vi.fn()
    render(<FleetConfirm command={{ cmd: 'pause' }} targets={[v(1), v(2)]} dict={t('ja')} onClose={() => {}} onResult={onResult} deps={{ confirm: vi.fn(), send }} />)
    const dialog = screen.getByRole('dialog', { name: '全機 一時停止' })
    expect(within(dialog).getByText('UAV-01')).toBeInTheDocument()
    expect(within(dialog).getByText('UAV-02')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: '実行' }))
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(2))
    expect(onResult).toHaveBeenCalledWith(2, false, 'busy')
    expect(within(dialog).getByTestId('fleet-1').className).toContain('ok')
    expect(within(dialog).getByTestId('fleet-2').className).toContain('fail')
    expect(within(dialog).getByRole('button', { name: '閉じる' })).toBeInTheDocument()
  })
  it('escape closes before running', () => {
    const onClose = vi.fn()
    render(<FleetConfirm command={{ cmd: 'rtl' }} targets={[v(1)]} dict={t('ja')} onClose={onClose} onResult={() => {}} deps={{ confirm: vi.fn(), send: vi.fn() }} />)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
  it('a vehicle whose request hangs does not hold the others or the screen', async () => {
    const send = vi.fn((sysid: number) => (sysid === 2 ? new Promise<never>(() => {}) : Promise.resolve({ id: sysid })))
    const onClose = vi.fn()
    const onResult = vi.fn()
    render(<FleetConfirm command={{ cmd: 'pause' }} targets={[v(1), v(2)]} dict={t('ja')} onClose={onClose} onResult={onResult} deps={{ confirm: vi.fn(), send }} />)
    fireEvent.click(screen.getByRole('button', { name: '実行' }))
    await waitFor(() => expect(screen.getByTestId('fleet-1').className).toContain('ok'))
    expect(onResult).toHaveBeenCalledWith(1, true, undefined)
    expect(screen.getByTestId('fleet-2').className).toContain('sending')
    const close = screen.getByRole('button', { name: '閉じる' })
    expect(close).toBeEnabled()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
