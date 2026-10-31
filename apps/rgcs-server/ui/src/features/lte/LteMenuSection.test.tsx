import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { t } from '../../shared/i18n'
import { LteMenuSection } from './LteMenuSection'
import { LteOverlayStore } from './prefs'

const memory = () => {
  const items: Record<string, string> = {}
  return { getItem: (k: string) => items[k] ?? null, setItem: (k: string, v: string) => void (items[k] = v) }
}

describe('LteMenuSection', () => {
  it('switches_the_overlay_and_sets_its_opacity', () => {
    const store = new LteOverlayStore(memory())
    render(<LteMenuSection dict={t('ja')} store={store} onManage={() => {}} />)
    expect(screen.getByRole('group', { name: 'オーバーレイ' })).toBeInTheDocument()
    const item = screen.getByRole('menuitemcheckbox', { name: 'ドコモ LTE エリア' })
    expect(item).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(item)
    expect(store.getState().on).toBe(true)
    expect(screen.getByRole('menuitemcheckbox', { name: 'ドコモ LTE エリア' })).toHaveAttribute('aria-checked', 'true')
    const slider = screen.getByRole('slider', { name: '透明度' })
    expect(slider).toHaveAttribute('min', '10')
    expect(slider).toHaveAttribute('max', '100')
    expect(slider).toHaveValue('60')
    fireEvent.change(slider, { target: { value: '25' } })
    expect(store.getState().opacity).toBe(25)
    expect(screen.getByText('25%')).toBeInTheDocument()
  })

  it('opens_the_area_sheet', () => {
    const onManage = vi.fn()
    render(<LteMenuSection dict={t('ja')} store={new LteOverlayStore(memory())} onManage={onManage} />)
    fireEvent.click(screen.getByRole('menuitem', { name: '範囲を管理…' }))
    expect(onManage).toHaveBeenCalled()
  })
})
