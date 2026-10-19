// 3D altitude editing: a badge floats at its altitude, so dragging it up or down changes only the
// altitude (the ground foot changes only the position, see missionFeet). Window listeners, not
// pointer capture, so the drag survives the pointer leaving the badge; preventDefault on
// pointerdown keeps MapLibre from panning (it listens to the compatibility mouse events).
import { altFromDrag } from './mapEdit'

/** Pixels the pointer must travel before a press becomes a drag (below it, a click). */
const DRAG_PX = 3

export interface AltDragDeps {
  /** True in 3D. */
  readonly active: () => boolean
  /** The items the drag moves: the selection when the badge is part of a multi-selection. */
  readonly targets: () => ReadonlySet<number>
  readonly alt: () => number
  readonly pxPerMetre: () => number | null
  readonly onPreview: (targets: ReadonlySet<number>, dAlt: number) => void
  readonly onCommit: (targets: ReadonlySet<number>, dAlt: number) => void
}

export function attachAltDrag(el: HTMLElement, deps: AltDragDeps): void {
  let swallowClick = false
  // preventDefault on pointerdown does not stop touchstart: MapLibre would pan under the finger
  el.addEventListener(
    'touchstart',
    (e) => {
      if (deps.active()) e.preventDefault()
    },
    { passive: false },
  )
  el.addEventListener(
    'click',
    (e) => {
      if (!swallowClick) return
      swallowClick = false
      e.stopImmediatePropagation()
    },
    true,
  )
  el.addEventListener('pointerdown', (e) => {
    // a drag released off the badge gets no click: never let its flag eat a later one
    swallowClick = false
    if (e.button !== 0 || !deps.active()) return
    e.preventDefault()
    e.stopPropagation()
    const id = e.pointerId
    const mine = (ev: Event) => (ev as PointerEvent).pointerId === id
    const y0 = e.clientY
    const alt0 = deps.alt()
    const scale = deps.pxPerMetre()
    const targets = deps.targets()
    let dragging = false
    let dAlt = 0
    const move = (ev: MouseEvent) => {
      if (!mine(ev)) return
      const dy = ev.clientY - y0
      if (!dragging && Math.abs(dy) < DRAG_PX) return
      dragging = true
      dAlt = altFromDrag(alt0, dy, scale) - alt0
      deps.onPreview(targets, dAlt)
    }
    const finish = (ev: Event) => {
      if (!mine(ev)) return
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      if (!dragging) return
      swallowClick = true
      // a cancelled gesture (e.g. the browser took the touch) reverts instead of committing
      deps.onCommit(targets, ev.type === 'pointercancel' ? 0 : dAlt)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  })
}
