import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Basemap } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { BasemapPicker } from './BasemapPicker'

const list: Basemap[] = [
  { id: 'map', label: '地図', tiles: ['a'], attribution: '', max_zoom: 19, overlay: null },
  { id: 'satellite', label: '衛星写真', tiles: ['b'], attribution: '', max_zoom: 19, overlay: null },
]

describe('BasemapPicker', () => {
  it('picker_switches_the_base_tiles', () => {
    const onPick = vi.fn()
    render(<BasemapPicker basemaps={list} current="map" dict={t('ja')} onPick={onPick} />)
    fireEvent.click(screen.getByRole('button', { name: 'マップタイプ' }))
    expect(screen.getByRole('menuitemradio', { name: '地図' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('menuitemradio', { name: '衛星写真' }))
    expect(onPick).toHaveBeenCalledWith('satellite')
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
