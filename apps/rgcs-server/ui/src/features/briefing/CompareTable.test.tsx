import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { t } from '../../shared/i18n'
import { CompareTable, type CompareLine } from './CompareTable'

const dict = t('ja')
const line = (key: string, over: Partial<CompareLine>): CompareLine => ({ key, color: '#9cc9ff', name: key, vehicle: null, distanceM: 1000, durationS: 600, batteryPct: null, batteryWarn: false, ...over })

describe('CompareTable', () => {
  it('distance_is_prominent_and_battery_is_marked_as_an_estimate_and_warns_over_70', () => {
    const onWriteAll = vi.fn()
    const lines = [
      line('Alpha', { vehicle: 'UAV-01', distanceM: 2400, durationS: 754, batteryPct: 42, batteryWarn: false }),
      line('Beta', { vehicle: 'UAV-02', distanceM: 800, batteryPct: 85, batteryWarn: true }),
      line('Gamma', {}),
    ]
    render(<CompareTable lines={lines} canWrite={true} dict={dict} onWriteAll={onWriteAll} />)
    const heads = screen.getAllByRole('columnheader').map((h) => h.textContent)
    expect(heads).toEqual(['プラン', '機体', '距離', '時間 (目安)', 'バッテリー (目安)'])
    const rows = screen.getAllByRole('row').slice(1)
    const cells = (i: number) => within(rows[i]!).getAllByRole('cell')
    expect(cells(0).map((c) => c.textContent)).toEqual(['Alpha', 'UAV-01', '2.40 km', '12:34', '42%'])
    expect(cells(0)[2]!.querySelector('.big')?.textContent).toBe('2.40 km')
    expect(cells(0)[4]!.classList.contains('warn')).toBe(false)
    expect(cells(1)[4]!.classList.contains('warn')).toBe(true)
    expect(cells(2).map((c) => c.textContent)).toEqual(['Gamma', '未割当', '1.00 km', '10:00', '—'])
    expect(rows[0]!.querySelector<HTMLElement>('.brief-dot')?.style.background).toBe('rgb(156, 201, 255)')
    fireEvent.click(screen.getByRole('button', { name: '割当どおり書き込む' }))
    expect(onWriteAll).toHaveBeenCalledTimes(1)
  })

  it('the_write_button_is_disabled_without_an_assigned_row', () => {
    render(<CompareTable lines={[line('A', {}), line('B', {})]} canWrite={false} dict={dict} onWriteAll={vi.fn()} />)
    expect(screen.getByRole('button', { name: '割当どおり書き込む' })).toBeDisabled()
  })
})
