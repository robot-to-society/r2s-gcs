// The vehicle list row (UX review 2026-10-26): state readable without colour.
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { VehicleState } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { VehicleRow } from './VehicleRow'

const v: VehicleState = {
  sysid: 4, name: 'UAV-04', kind: 'rover', mode: 'AUTO', armed: true, lat: 0, lon: 0, alt_rel: 0, alt_msl: 0, hdg: 90,
  ground_speed: 1.2, climb: 0, battery: { pct: 80, volt: 12, current: null }, link: 'ok', last_rx_ms: 0,
  gps: { fix: 3, sats: 10, hdop: 1 }, warn: false, unread: 0,
}
const row = (over: Partial<VehicleState> = {}) => {
  render(<VehicleRow vehicle={{ ...v, ...over }} selected={false} dict={t('ja')} onSelect={() => {}} />)
  return screen.getByRole('option')
}

describe('VehicleRow', () => {
  it('an_armed_vehicle_shows_a_power_mark_and_a_filled_badge (UX-12)', () => {
    const r = row()
    expect(within(r).getByRole('img', { name: 'アーム中' })).toBeInTheDocument()
    expect(within(r).getByText('AUTO').className).toContain('armed')
  })

  it('a_disarmed_vehicle_has_no_power_mark (UX-12)', () => {
    const r = row({ armed: false, mode: 'HOLD' })
    expect(within(r).queryByRole('img', { name: 'アーム中' })).not.toBeInTheDocument()
    expect(within(r).getByText('HOLD').className).not.toContain('armed')
    expect(within(r).getByText('HOLD').getAttribute('title')).toBe('HOLD · ディスアーム')
  })
})
