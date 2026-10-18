import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { t } from '../../shared/i18n'
import { ConfirmDialog } from './ConfirmDialog'

describe('ConfirmDialog', () => {
  it('requests a token then sends the command with it, reporting the result', async () => {
    const confirm = vi.fn().mockResolvedValue({ confirm_token: 'tok', expires_in: 30 })
    const send = vi.fn().mockResolvedValue({ id: 9 })
    const onDone = vi.fn()
    render(
      <ConfirmDialog sysid={1} command={{ cmd: 'arm' }} vehicleName="UAV-01" onCancel={() => {}} onDone={onDone} dict={t('ja')} deps={{ confirm, send }} />,
    )
    expect(screen.getByRole('dialog')).toHaveTextContent('アーム')
    expect(screen.getByRole('dialog')).toHaveTextContent('UAV-01')
    const run = screen.getByRole('button', { name: '実行' })
    expect(run).toHaveClass('btn-danger')
    fireEvent.click(run)
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ kind: 'queued', id: 9 }))
    expect(confirm).toHaveBeenCalledWith(1, 'arm')
    expect(send).toHaveBeenCalledWith(1, { cmd: 'arm' }, 'tok')
  })

  it('uses the primary button for non-destructive commands and shows the carried message', () => {
    render(
      <ConfirmDialog
        sysid={1}
        command={{ cmd: 'set_mode', args: { mode: 'AUTO' } }}
        vehicleName="UAV-01"
        message="confirm token expired"
        onCancel={() => {}}
        onDone={() => {}}
        dict={t('ja')}
      />,
    )
    expect(screen.getByRole('button', { name: '実行' })).toHaveClass('btn-primary')
    expect(screen.getByText('confirm token expired')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toHaveTextContent('AUTO')
  })

  it('cancel calls onCancel and a failed token request reports an error', async () => {
    const onCancel = vi.fn()
    const onDone = vi.fn()
    const confirm = vi.fn().mockRejectedValue(new Error('offline'))
    render(
      <ConfirmDialog sysid={1} command={{ cmd: 'rtl' }} vehicleName="UAV-01" onCancel={onCancel} onDone={onDone} dict={t('ja')} deps={{ confirm, send: vi.fn() }} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '実行' }))
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ kind: 'error', code: 'unknown', message: 'offline' }))
  })
})
