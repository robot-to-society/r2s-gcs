// Pure helpers behind MissionMap: DOM elements for the badges / mid-leg handles, the handle
// positions and the drag arithmetic. Kept out of the component so they are testable without MapLibre.
import { CMDS } from './cmds'
import { hasPosition, midpoint, type LatLon } from './geo'
import type { Draft } from './model'

export interface MidHandle {
  readonly afterUid: number
  readonly lat: number
  readonly lon: number
}

export interface ContextMenu {
  readonly uid: number
  readonly x: number
  readonly y: number
}

const title = (cmdKey: string): string => CMDS[cmdKey]?.mav ?? cmdKey

/** Prototype badge letter: T takeoff, L land, R RTL, ◎ ROI, else the 1-based sequence. */
export function badgeText(seq: number, cmdKey: string): string {
  return cmdKey === 'TAKEOFF' ? 'T' : cmdKey === 'LAND' ? 'L' : cmdKey === 'RTL' ? 'R' : cmdKey === 'DO_SET_ROI' ? '◎' : String(seq)
}

/** Prototype `.rg-wp > .dot` marker; MapLibre positions it, we only toggle `sel`. */
export function badgeEl(seq: number, selected: boolean, cmdKey: string): HTMLDivElement {
  const el = document.createElement('div')
  const dot = document.createElement('span')
  dot.className = 'dot'
  el.append(dot)
  return updateBadgeEl(el, seq, selected, cmdKey)
}

/** `chip`: the 3D altitude chip ("▲ 80 m Rel"), `null` in 2D. */
export function updateBadgeEl(el: HTMLDivElement, seq: number, selected: boolean, cmdKey: string, chip: string | null = null): HTMLDivElement {
  el.classList.add('rg-wp')
  el.classList.toggle('sel', selected)
  const dot = el.querySelector('.dot')
  if (dot) {
    dot.textContent = badgeText(seq, cmdKey)
    dot.classList.toggle('roi', cmdKey === 'DO_SET_ROI')
  }
  el.title = title(cmdKey)
  setChip(el, chip)
  return el
}

function setChip(el: HTMLDivElement, chip: string | null): void {
  const box = el.querySelector('.chips')
  if (chip === null) {
    box?.remove()
    return
  }
  const chips = box ?? el.appendChild(Object.assign(document.createElement('div'), { className: 'chips' }))
  const c = chips.querySelector('.altc') ?? chips.appendChild(Object.assign(document.createElement('span'), { className: 'chip altc' }))
  c.textContent = chip
}

/** The "+" between two waypoints that inserts a new one (prototype `.rg-mid`). */
export function handleEl(): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'rg-mid'
  el.textContent = '+'
  return el
}

/**
 * One handle per leg between consecutive positioned items. A handle inserts after the item that
 * precedes the leg's end in list order (so DO_ items between two waypoints stay before the new one).
 */
export function midHandles(d: Draft): readonly MidHandle[] {
  const out: MidHandle[] = []
  let prev: { uid: number; lat: number; lon: number } | null = null
  let lastUid: number | null = null
  for (const it of d.items) {
    if (hasPosition(it)) {
      if (prev && lastUid !== null) {
        const m = midpoint(prev, it)
        out.push({ afterUid: lastUid, lat: m.lat, lon: m.lon })
      }
      prev = { uid: it.uid, lat: it.lat, lon: it.lon }
    }
    lastUid = it.uid
  }
  return out
}

export const dragDelta = (start: LatLon, now: LatLon): { dLat: number; dLon: number } => ({ dLat: now.lat - start.lat, dLon: now.lon - start.lon })

/** The altitude after dragging `dyPx` down the screen (negative = up), in whole metres. */
export function altFromDrag(startAlt: number, dyPx: number, pxPerMetre: number | null): number {
  if (pxPerMetre === null || !(Math.abs(pxPerMetre) > 1e-6)) return startAlt
  return Math.round(startAlt - dyPx / pxPerMetre)
}
