// Shared 3D plumbing for the operations and mission maps: the DEM source and sampler, one
// AirPathLayer, the 2D / 3D switch and the marker floating driven by the layer's frames.
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { Map as MlMap } from 'maplibre-gl'
import { AirPathLayer } from './airLayer'
import { floatMarkers, type Floating } from './float'
import { applyMapMode, DEM_SOURCE, type MapMode, type ModeLayers } from './mapMode'
import { TerrainSampler, terrainSource } from './terrain'

interface Args {
  readonly map: RefObject<MlMap | null>
  readonly loaded: RefObject<boolean>
  readonly mode: MapMode
  readonly terrainTiles: string | null
  readonly layerId: string
  /** Adds the map's own 3D layers (called once, after the DEM source; the air layer comes last). */
  readonly setup: (m: MlMap) => void
  readonly modeLayers: ModeLayers
  /** Re-stacks the map's layers once the air layer exists. */
  readonly order?: (m: MlMap) => void
}

export interface Air3d {
  readonly sampler: TerrainSampler | null
  /** True once the layers exist. */
  readonly ready: boolean
  readonly is3d: boolean
  /** Bumps when a DEM tile arrives (recompute altitudes). */
  readonly tick: number
  readonly layer: AirPathLayer
  /** The markers to float; set by the caller whenever its data changes. */
  readonly floats: { current: readonly Floating[] }
}

export function useAir3d({ map, loaded, mode, terrainTiles, layerId, setup, modeLayers, order }: Args): Air3d {
  const [tick, setTick] = useState(0)
  const [ready, setReady] = useState(false)
  const sampler = useMemo(() => (terrainTiles ? new TerrainSampler(terrainTiles, () => setTick((n) => n + 1)) : null), [terrainTiles])
  const layer = useRef(new AirPathLayer(layerId)).current
  const floats = useRef<readonly Floating[]>([])
  const setupRef = useRef({ setup, order })
  setupRef.current = { setup, order }
  const modeRef = useRef(modeLayers)
  modeRef.current = modeLayers
  const is3d = mode === '3d' && sampler !== null

  useEffect(() => {
    const m = map.current
    if (!m || !terrainTiles) return
    const go = () => {
      m.addSource(DEM_SOURCE, terrainSource(terrainTiles))
      setupRef.current.setup(m)
      m.addLayer(layer)
      setupRef.current.order?.(m)
      layer.onFrame = (matrix) => floatMarkers(m, matrix, floats.current)
      setReady(true)
    }
    if (loaded.current) go()
    else m.once('load', go)
  }, [map, loaded, terrainTiles, layer])

  useEffect(() => {
    const m = map.current
    if (!m || !ready) return
    layer.visible = is3d
    applyMapMode(m, is3d ? '3d' : '2d', modeRef.current)
    if (!is3d) floatMarkers(m, null, floats.current)
  }, [map, ready, is3d, layer])

  return { sampler, ready, is3d, tick, layer, floats }
}
