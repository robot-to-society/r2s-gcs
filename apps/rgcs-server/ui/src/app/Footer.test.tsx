import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { t } from '../shared/i18n'
import { Footer } from './Footer'

const at = (h: number, m: number) => new Date(2026, 9, 17, h, m).getTime()

describe('Footer', () => {
  it('shows the "all" pill, the two newest results with time and outcome, and the clock', () => {
    const results = [
      { id: 3, sysid: 1, cmd: 'rtl', ok: false, reason: 'timeout', ts: at(14, 7) },
      { id: 2, sysid: 1, cmd: 'arm', ok: true, reason: null, ts: at(14, 5) },
      { id: 1, sysid: 1, cmd: 'pause', ok: true, reason: null, ts: at(14, 1) },
    ]
    render(<Footer results={results} dict={t('ja')} clock="14:08" />)
    const pills = screen.getAllByTestId('pill')
    expect(pills.map((p) => p.textContent)).toEqual(['全体', '14:07 RTL 失敗', '14:05 ARM 成功'])
    expect(pills[1]).toHaveClass('danger')
    expect(pills[2]).not.toHaveClass('danger')
    expect(screen.getByText('14:08')).toBeInTheDocument()
  })

  it('renders only the "all" pill when there are no results', () => {
    render(<Footer results={[]} dict={t('ja')} clock="" />)
    expect(screen.getAllByTestId('pill')).toHaveLength(1)
  })
})
