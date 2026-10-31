import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { t } from '../../shared/i18n'
import { LabelToggle } from './LabelToggle'

const dict = t('ja')

describe('LabelToggle', () => {
  it('the_menu_lists_both_labels_with_their_state_and_toggles_one', () => {
    const onToggle = vi.fn()
    render(<LabelToggle prefs={{ wpNumbers: true, altitudes: false }} dict={dict} onToggle={onToggle} />)
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: dict.mLabels }))
    const wp = screen.getByRole('menuitemcheckbox', { name: dict.mLabelWp })
    const alt = screen.getByRole('menuitemcheckbox', { name: dict.mLabelAlt })
    expect(wp).toHaveAttribute('aria-checked', 'true')
    expect(alt).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(wp)
    expect(onToggle).toHaveBeenCalledWith('wpNumbers')
    // the menu stays open so both can be switched in one go
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
