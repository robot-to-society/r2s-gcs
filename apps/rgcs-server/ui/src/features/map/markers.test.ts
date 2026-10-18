import { describe, expect, it } from 'vitest'
import type { VehicleState } from '../../shared/api/types'
import { hasPosition, homeEl, markerEl, updateMarkerEl } from './markers'

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

  it('copter_marker_has_disc_heading_caret_and_label', () => {
    const el = markerEl(base, false)
    expect([...el.classList]).toEqual(['rg-mk'])
    const vmk = el.querySelector('.vmk')!
    expect([...vmk.classList]).toEqual(['vmk', 'copter'])
    expect(vmk.querySelector('.arrow > i.hd')).not.toBeNull()
    expect(vmk.querySelector('.disc > svg.ic')).not.toBeNull()
    expect(vmk.querySelector('.disc circle')).not.toBeNull()
    expect(el.querySelector('.lbl')?.textContent).toBe('UAV-01')
    expect(el.querySelector('.alt')?.textContent).toBe('80 m')
    expect(el.title).toBe('UAV-01')
  })

  it('rover_marker_uses_car_and_light_disc', () => {
    const el = markerEl({ ...base, kind: 'rover' }, false)
    expect([...el.querySelector('.vmk')!.classList]).toEqual(['vmk', 'rover'])
    expect(el.querySelector('.arrow > .hd')).not.toBeNull()
    expect([...el.querySelectorAll('.disc path')].map((p) => p.getAttribute('d'))).toContain('M9 17h6')
  })

  it('selected_marker_gets_sel and warnings mark the label, without replacing the element', () => {
    const el = markerEl(base, false)
    el.classList.add('maplibregl-marker') // MapLibre adds its positioning class after construction
    const same = updateMarkerEl(el, { ...base, warn: true, alt_rel: 12.4 }, true)
    expect(same).toBe(el)
    expect([...el.classList].sort()).toEqual(['maplibregl-marker', 'rg-mk', 'sel', 'warn'])
    expect(el.querySelector('.alt')?.textContent).toBe('12 m')
    updateMarkerEl(el, base, false)
    expect([...el.classList].sort()).toEqual(['maplibregl-marker', 'rg-mk'])
  })

  it('heading_rotates_only_the_arrow', () => {
    const el = markerEl(base, false)
    const arrow = el.querySelector('.arrow') as HTMLElement
    expect(arrow.style.transform).toBe('rotate(90deg)')
    expect((el.querySelector('.disc') as HTMLElement).style.transform).toBe('')
    expect((el.querySelector('.vmk') as HTMLElement).style.transform).toBe('')
    updateMarkerEl(el, { ...base, hdg: null }, false)
    // inline style: jsdom's computed style is cached on detached elements
    expect(arrow.style.transform).toBe('rotate(0deg)')
  })

  it('home_marker_is_a_white_tile_with_a_house', () => {
    const el = homeEl()
    expect(el.className).toBe('rg-home')
    expect(el.title).toBe('Home')
    expect(el.querySelector('svg.ic path')).not.toBeNull()
  })
})
