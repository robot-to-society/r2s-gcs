import type { VehicleState } from '../../shared/api/types'

/** A 2D+ fix and not the null island: the only positions worth drawing (Review Focus 2). */
export function hasPosition(v: VehicleState): boolean {
  return v.gps.fix >= 2 && !(v.lat === 0 && v.lon === 0)
}

const ARROW_SVG =
  '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 2l7 19-7-4-7 4z"/></svg>'
const ROVER_SVG =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 13l2-5h14l2 5v5H3z"/></svg>'

/** Toggles our classes only; MapLibre owns `maplibregl-marker` on the same element. */
function applyClasses(el: HTMLElement, v: VehicleState, selected: boolean): void {
  el.classList.add('rg-mk')
  el.classList.toggle('sel', selected)
  el.classList.toggle('warn', v.warn || v.link !== 'ok')
}

/** Builds the `.rg-mk` DOM element MapLibre positions; see `updateMarkerEl` for later frames. */
export function markerEl(v: VehicleState, selected: boolean): HTMLDivElement {
  const el = document.createElement('div')
  const glyph = document.createElement('div')
  glyph.className = v.kind === 'rover' ? 'rov' : 'arrow'
  glyph.innerHTML = v.kind === 'rover' ? ROVER_SVG : ARROW_SVG
  const col = document.createElement('div')
  col.className = 'col'
  const lbl = document.createElement('span')
  lbl.className = 'lbl'
  const alt = document.createElement('span')
  alt.className = 'alt'
  col.append(lbl, alt)
  el.append(glyph, col)
  return updateMarkerEl(el, v, selected)
}

/** Updates classes, rotation and texts in place (no element churn at 10 Hz). */
export function updateMarkerEl(el: HTMLDivElement, v: VehicleState, selected: boolean): HTMLDivElement {
  applyClasses(el, v, selected)
  el.title = v.name
  const arrow = el.querySelector<HTMLElement>('.arrow')
  if (arrow) arrow.style.transform = `rotate(${v.hdg ?? 0}deg)`
  const lbl = el.querySelector('.lbl')
  if (lbl) lbl.textContent = v.name
  const alt = el.querySelector('.alt')
  if (alt) alt.textContent = `${Math.round(v.alt_rel)} m`
  return el
}
