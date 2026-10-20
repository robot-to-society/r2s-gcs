import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Mission, VehicleState } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { emptyDraft } from '../mission/model'
import { INITIAL_MISSION_UI, loaded } from '../mission/store'
import { BriefingList } from './BriefingList'
import { PALETTE, addRow, assign, emptyWorkspace, type Workspace } from './model'

const dict = t('ja')
const vehicle = (sysid: number, name: string): VehicleState =>
  ({
    sysid, name, kind: 'copter', mode: 'STABILIZE', armed: false, lat: 0, lon: 0, alt_rel: 0, alt_msl: 0, hdg: 0, ground_speed: 0, climb: 0,
    battery: { pct: 90, volt: 24, current: null }, link: 'ok', last_rx_ms: 0, gps: { fix: 3, sats: 12, hdop: 1 }, warn: false, unread: 0,
  }) as VehicleState
const vehicles = [vehicle(1, 'UAV-01'), vehicle(2, 'UAV-02')]
const mission = (name: string): Mission => ({ ...emptyDraft().mission, name, items: [] }) as unknown as Mission

/** Alpha (active, first) and Beta (dirty, on UAV-02). */
function twoRows(): Workspace {
  const base = emptyWorkspace()
  const alpha: Workspace = { ...base, rows: base.rows.map((r) => ({ ...r, ui: loaded(INITIAL_MISSION_UI, mission('Alpha'), 1) })) }
  const withBeta = addRow(alpha, { ...loaded(INITIAL_MISSION_UI, mission('Beta'), 2), dirty: true })
  return { ...assign(withBeta, withBeta.rows[1]!.key, 2), active: alpha.rows[0]!.key }
}

function setup(ws: Workspace = twoRows(), liveDirty = false) {
  const on = { onSwitch: vi.fn(), onAssign: vi.fn(), onRemove: vi.fn(), onMove: vi.fn(), onColor: vi.fn(), onHidden: vi.fn() }
  render(<BriefingList workspace={ws} liveDirty={liveDirty} vehicles={vehicles} dict={dict} {...on} />)
  const rows = () => [...document.querySelectorAll<HTMLElement>('.brief-row')]
  return { ws, on, rows }
}

describe('BriefingList', () => {
  it('rows_show_colour_name_assignment_and_unsaved_mark', () => {
    const { ws, rows } = setup(twoRows(), true)
    expect(rows()).toHaveLength(2)
    expect(rows()[0]!.getAttribute('aria-current')).toBe('true')
    expect(rows()[1]!.hasAttribute('aria-current')).toBe(false)
    expect(rows().map((r) => r.querySelector('.brief-name')?.textContent)).toEqual(['Alpha', 'Beta'])
    const chips = rows().map((r) => r.querySelector<HTMLElement>('.brief-chip')!.style.background)
    expect(chips[0]).not.toBe(chips[1])
    expect(ws.rows.map((r) => r.color)).toEqual([PALETTE[0], PALETTE[1]])
    const selects = rows().map((r) => within(r).getByLabelText('割当機体') as HTMLSelectElement)
    expect(selects.map((s) => s.value)).toEqual(['', '2'])
    expect(within(selects[0]!).getByRole('option', { name: '未割当' })).toBeInTheDocument()
    // the active row follows the live editor's flag, a parked one its own
    expect(rows().map((r) => r.querySelector('.brief-dirty') !== null)).toEqual([true, true])
  })

  it('the_active_row_has_no_mark_when_the_live_editor_is_clean', () => {
    const { rows } = setup(twoRows(), false)
    expect(rows().map((r) => r.querySelector('.brief-dirty') !== null)).toEqual([false, true])
  })

  it('clicking_a_row_switches', () => {
    const { ws, on } = setup()
    fireEvent.click(screen.getByText('Beta'))
    expect(on.onSwitch).toHaveBeenCalledWith(ws.rows[1]!.key)
    // controls inside a row do not switch
    fireEvent.change(screen.getAllByLabelText('割当機体')[1]!, { target: { value: '1' } })
    expect(on.onSwitch).toHaveBeenCalledTimes(1)
  })

  it('choosing_a_vehicle_assigns', () => {
    const { ws, on } = setup()
    const [first, second] = screen.getAllByLabelText('割当機体')
    fireEvent.change(first!, { target: { value: '1' } })
    expect(on.onAssign).toHaveBeenCalledWith(ws.rows[0]!.key, 1)
    fireEvent.change(second!, { target: { value: '' } })
    expect(on.onAssign).toHaveBeenLastCalledWith(ws.rows[1]!.key, null)
  })

  it('missing_rows_say_so_and_can_be_removed', () => {
    const base = twoRows()
    const ws = { ...base, rows: base.rows.map((r, i) => (i === 1 ? { ...r, missing: true } : r)) }
    const { on, rows } = setup(ws)
    expect(within(rows()[1]!).getByText('見つかりません')).toBeInTheDocument()
    expect(within(rows()[0]!).queryByText('見つかりません')).not.toBeInTheDocument()
    fireEvent.click(within(rows()[1]!).getByRole('button', { name: '一覧から外す' }))
    expect(on.onRemove).toHaveBeenCalledWith(ws.rows[1]!.key)
    expect(on.onSwitch).not.toHaveBeenCalled()
  })

  it('the_chip_opens_the_palette_and_the_arrows_move', () => {
    const { ws, on, rows } = setup()
    fireEvent.click(within(rows()[1]!).getByRole('button', { name: '色' }))
    const pop = screen.getByRole('dialog', { name: '色' })
    expect(within(pop).getAllByRole('button')).toHaveLength(8)
    fireEvent.click(within(pop).getByRole('button', { name: PALETTE[4] }))
    expect(on.onColor).toHaveBeenCalledWith(ws.rows[1]!.key, PALETTE[4])
    expect(screen.queryByRole('dialog', { name: '色' })).not.toBeInTheDocument()
    // clicking outside closes it
    fireEvent.click(within(rows()[0]!).getByRole('button', { name: '色' }))
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('dialog', { name: '色' })).not.toBeInTheDocument()
    fireEvent.click(within(rows()[1]!).getByRole('button', { name: '上へ' }))
    expect(on.onMove).toHaveBeenCalledWith(ws.rows[1]!.key, -1)
    expect(within(rows()[0]!).getByRole('button', { name: '上へ' })).toBeDisabled()
    expect(within(rows()[1]!).getByRole('button', { name: '下へ' })).toBeDisabled()
    expect(on.onSwitch).not.toHaveBeenCalled()
  })

  it('the_edited_rows_remove_is_disabled_while_busy', () => {
    const on = { onSwitch: vi.fn(), onAssign: vi.fn(), onRemove: vi.fn(), onMove: vi.fn(), onColor: vi.fn(), onHidden: vi.fn() }
    render(<BriefingList workspace={twoRows()} liveDirty={false} busy vehicles={vehicles} dict={dict} {...on} />)
    const remove = screen.getAllByRole('button', { name: '一覧から外す' })
    expect(remove.map((b) => (b as HTMLButtonElement).disabled)).toEqual([true, false])
  })

  it('the_eye_toggle_hides_a_parked_row_and_is_disabled_on_the_active_one', () => {
    const base = twoRows()
    const { on, rows } = setup(base)
    const eye = (i: number) => within(rows()[i]!).getByRole('button', { name: '表示' })
    const beta = base.rows[1]!.key
    expect(eye(0)).toBeDisabled()
    expect(eye(1).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(eye(1))
    expect(on.onHidden).toHaveBeenCalledWith(beta, true)
    expect(on.onSwitch).not.toHaveBeenCalled()
  })

  it('a_hidden_row_is_unpressed_and_the_toggle_shows_it_again', () => {
    const base = twoRows()
    const ws = { ...base, rows: base.rows.map((r, i) => (i === 1 ? { ...r, hidden: true } : r)) }
    const { on, rows } = setup(ws)
    const eye = within(rows()[1]!).getByRole('button', { name: '表示' })
    expect(eye.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(eye)
    expect(on.onHidden).toHaveBeenCalledWith(ws.rows[1]!.key, false)
  })
})
