import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { BriefingSummary } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { BriefingPicker } from './BriefingPicker'

const dict = t('ja')
const rows: BriefingSummary[] = [
  { id: 1, name: 'Old', mission_count: 2, updated_at: 1_000 },
  { id: 2, name: 'Newest', mission_count: 3, updated_at: 3_000 },
  { id: 3, name: 'Middle', mission_count: 1, updated_at: 2_000 },
]

describe('BriefingPicker', () => {
  it('lists_briefings_newest_first_and_opens_one', async () => {
    const onPick = vi.fn()
    render(<BriefingPicker dict={dict} load={() => Promise.resolve(rows)} onPick={onPick} onClose={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: dict.bfOpenTitle })).toBeInTheDocument()
    await screen.findByText('Newest')
    const names = [...document.querySelectorAll('.mission-picker li .brief-pick-name')].map((n) => n.textContent)
    expect(names).toEqual(['Newest', 'Middle', 'Old'])
    expect(screen.getByText('Newest').closest('li')!.textContent).toContain(`3 ${dict.bfMissions}`)
    fireEvent.click(screen.getByText('Middle'))
    expect(onPick).toHaveBeenCalledWith(3)
  })
})
