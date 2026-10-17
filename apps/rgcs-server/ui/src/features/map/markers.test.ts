import { describe, expect, it } from 'vitest'
import type { VehicleState } from '../../shared/api/types'
import { hasPosition, markerEl, updateMarkerEl } from './markers'

const base: VehicleState = {
  sysid: 1, name: 'UAV-01', kind: 'copter', mode: 'AUTO', armed: true, lat: 36.162, lon: 139.372, alt_rel: 80, alt_msl: 480,
  hdg: 90, ground_speed: 5, climb: 0, battery: { pct: 70, volt: 23, current: null }, link: 'ok', last_rx_ms: 0,
  gps: { fix: 3, sats: 12, hdop: 1 }, warn: false, unread: 0,
}

describe('vehicle markers', () => {
  it('hasPosition needs a 2D+ fix and a non-null-island position', () => {
    expect(hasPosition(base)).toBe(true)
    expect(hasPosition({ ...base, gps: { ...base.gps, fix: 1 } })).toBe(false)
    expect(hasPosition({ ...base, lat: 0, lon: 0 })).toBe(false)
  })

  it('builds a .rg-mk element with heading rotation, name and altitude', () => {
    const el = markerEl(base, false)
    expect([...el.classList]).toEqual(['rg-mk'])
    expect(el.querySelector('.arrow')).toHaveStyle({ transform: 'rotate(90deg)' })
    expect(el.querySelector('.lbl')?.textContent).toBe('UAV-01')
    expect(el.querySelector('.alt')?.textContent).toBe('80 m')
    expect(el.title).toBe('UAV-01')
  })

  it('reflects selection, warnings and unknown heading on update without replacing the element', () => {
    const el = markerEl(base, false)
    el.classList.add('maplibregl-marker') // MapLibre adds its positioning class after construction
    const same = updateMarkerEl(el, { ...base, hdg: null, warn: true, alt_rel: 12.4 }, true)
    expect(same).toBe(el)
    expect([...el.classList].sort()).toEqual(['maplibregl-marker', 'rg-mk', 'sel', 'warn'])
    expect(el.querySelector('.arrow')).toHaveStyle({ transform: 'rotate(0deg)' })
    expect(el.querySelector('.alt')?.textContent).toBe('12 m')
    updateMarkerEl(el, base, false)
    expect([...el.classList].sort()).toEqual(['maplibregl-marker', 'rg-mk'])
  })

  it('draws rovers with the round .rov badge instead of an arrow', () => {
    const el = markerEl({ ...base, kind: 'rover' }, false)
    expect(el.querySelector('.rov')).not.toBeNull()
    expect(el.querySelector('.arrow')).toBeNull()
  })
})
