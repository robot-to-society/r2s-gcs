import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { t } from '../shared/i18n'
import { Nav } from './Nav'

describe('Nav', () => {
  it('renders_the_six_views_in_spec_order', () => {
    const { container } = render(<Nav view="ops" onView={() => {}} dict={t('ja')} />)
    expect(container.querySelector('nav.seg.n6')).not.toBeNull()
    const buttons = screen.getAllByRole('button')
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['運用マップ', '全機体映像', 'ミッション', 'ネットワーク', 'AIチャット', 'メンテナンス・設定'])
    expect(screen.getByRole('button', { name: 'AIチャット' })).toHaveAttribute('aria-disabled', 'true')
    for (const b of buttons) expect(b.querySelector('svg.lucide, svg.ic')).not.toBeNull()
    expect(buttons[0]).toHaveAttribute('aria-current', 'page')
    expect(screen.getByTestId('lens')).toHaveStyle({ transform: 'translateX(0%)' })
  })

  it('does not switch to a view that is not implemented yet', () => {
    const onView = vi.fn()
    render(<Nav view="ops" onView={onView} dict={t('ja')} />)
    const ai = screen.getByRole('button', { name: 'AIチャット' })
    expect(ai).toHaveAttribute('aria-disabled', 'true')
    expect(ai).toHaveAttribute('title', 'AIチャット (準備中)')
    fireEvent.click(ai)
    expect(onView).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '運用マップ' }))
    expect(onView).toHaveBeenCalledWith('ops')
  })

  it('mission and video tabs are enabled', () => {
    const onView = vi.fn()
    render(<Nav view="ops" onView={onView} dict={t('ja')} />)
    for (const [name, view] of [['ミッション', 'mission'], ['全機体映像', 'video']] as const) {
      const b = screen.getByRole('button', { name })
      expect(b).not.toHaveAttribute('aria-disabled')
      fireEvent.click(b)
      expect(onView).toHaveBeenCalledWith(view)
    }
  })

  it('network_is_enabled', () => {
    const onView = vi.fn()
    render(<Nav view="ops" onView={onView} dict={t('ja')} />)
    const net = screen.getByRole('button', { name: 'ネットワーク' })
    expect(net).not.toHaveAttribute('aria-disabled')
    fireEvent.click(net)
    expect(onView).toHaveBeenCalledWith('network')
  })
})
