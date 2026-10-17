import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { t } from '../shared/i18n'
import { Nav } from './Nav'

describe('Nav', () => {
  it('renders the five views in spec order with the lens on the current one', () => {
    render(<Nav view="ops" onView={() => {}} dict={t('ja')} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual(['運用マップ', '全機体映像', 'ミッション', 'AIチャット', 'メンテナンス・設定'])
    expect(buttons[0]).toHaveAttribute('aria-current', 'page')
    expect(screen.getByTestId('lens')).toHaveStyle({ transform: 'translateX(0%)' })
  })

  it('does not switch to a view that is not implemented yet', () => {
    const onView = vi.fn()
    render(<Nav view="ops" onView={onView} dict={t('ja')} />)
    const video = screen.getByRole('button', { name: '全機体映像' })
    expect(video).toHaveAttribute('aria-disabled', 'true')
    expect(video).toHaveAttribute('title', '準備中')
    fireEvent.click(video)
    expect(onView).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '運用マップ' }))
    expect(onView).toHaveBeenCalledWith('ops')
  })
})
