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

/** Numbered waypoint badge; MapLibre positions it, we only toggle `sel`. */
export function badgeEl(seq: number, selected: boolean, cmdKey: string): HTMLDivElement {
  const el = document.createElement('div')
  return updateBadgeEl(el, seq, selected, cmdKey)
}

export function updateBadgeEl(el: HTMLDivElement, seq: number, selected: boolean, cmdKey: string): HTMLDivElement {
  el.classList.add('wp-mk')
  el.classList.toggle('sel', selected)
  el.textContent = String(seq)
  el.title = title(cmdKey)
  return el
}

/** The "+" between two waypoints that inserts a new one. */
export function handleEl(): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'wp-mid'
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
