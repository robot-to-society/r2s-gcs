// The docomo LTE overlay on one map (operations or planner). Any failure is swallowed: the
// overlay just does not show, the map keeps working (design: UI).
import { useEffect, useRef, useState, type RefObject } from 'react'
import { lteAreasStore, useLteAreas, type LteAreasStore } from './areasStore'
import { addLte, lteBounds, lteVersion, removeLte, setLteOpacity, type LteBounds, type LteHost } from './layer'
import { registerLteMap, type BoundsLike, type LteMapKey } from './mapRegistry'
import { lteOverlayStore, useLteOverlayPrefs, type LteOverlayStore } from './prefs'

/** The parts of a MapLibre map the overlay uses. */
export interface LteMap extends LteHost {
  once(ev: 'load', fn: () => void): unknown
  getBounds(): BoundsLike
}

interface Stores {
  readonly prefs: LteOverlayStore
  readonly areas: LteAreasStore
}

function guard(fn: () => void): void {
  try {
    fn()
  } catch {
    // the overlay is optional: a style not ready or a removed map leaves it off
  }
}

/** The map once its style has loaded (null before). */
function useLoadedMap<M extends LteMap>(map: RefObject<M | null>, loaded: RefObject<boolean>): M | null {
  const [ready, setReady] = useState<M | null>(null)
  useEffect(() => {
    const m = map.current
    if (!m) return
    let live = true
    const mark = () => live && setReady(m)
    if (loaded.current) mark()
    else guard(() => m.once('load', mark))
    return () => {
      live = false
      setReady(null)
    }
  }, [map, loaded])
  return ready
}

/** `key` null: no overlay (the audience mini-map). */
export function useLteOverlay<M extends LteMap>(map: RefObject<M | null>, loaded: RefObject<boolean>, key: LteMapKey | null, stores?: Stores): void {
  const prefs = useLteOverlayPrefs(stores?.prefs ?? lteOverlayStore())
  const on = key !== null && prefs.on
  const { areas } = useLteAreas(on, stores?.areas ?? lteAreasStore())
  const m = useLoadedMap(map, loaded)
  const bounds = on ? lteBounds(areas) : null
  // a string, so the layer is rebuilt only when the bounds or a fetch completion change
  const spec = bounds ? JSON.stringify({ bounds, version: lteVersion(areas) }) : null
  const opacity = useRef(prefs.opacity)

  useEffect(() => {
    const mm = map.current
    if (!key || !mm) return
    return registerLteMap(key, () => mm.getBounds())
  }, [map, key])

  useEffect(() => {
    opacity.current = prefs.opacity
    if (m) guard(() => setLteOpacity(m, prefs.opacity))
  }, [m, prefs.opacity])

  useEffect(() => {
    if (!m) return
    guard(() => removeLte(m))
    if (!spec) return
    const { bounds: b, version } = JSON.parse(spec) as { bounds: LteBounds; version: string }
    guard(() => addLte(m, b, version, opacity.current))
  }, [m, spec])
}
