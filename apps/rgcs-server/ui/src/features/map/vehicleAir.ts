// 3D vehicles on the operations map (prototype updateVehicleAir): a thin post from the ground
// to the vehicle, a ground disc, and the DOM marker floated to its altitude.
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { FeatureCollection, Point } from 'geojson'
import type { Map as MlMap, Marker } from 'maplibre-gl'
import type { VehicleState } from '../../shared/api/types'
import { mercatorLine, vehicleAmsl, type AirVertex, type ElevAt, type Rgb } from './air'
import { AirPathLayer } from './airLayer'
import { floatMarkers, type Floating } from './float'
import { orderLayers } from './layers'
import { applyMapMode, DEM_SOURCE, type MapMode } from './mapMode'
import type { LatLon } from './store'
import { TerrainSampler, terrainSource } from './terrain'
import type { Tracks } from './tracks'

const CYAN: Rgb = [0x9c / 255, 0xc9 / 255, 1]
const AMBER: Rgb = [0xf2 / 255, 0xb5 / 255, 0x44 / 255]
const GROUND = 'veh-ground'
const AIR = 'veh-air3d'
/** Layers shown only in 3D on the operations map. */
export const OPS_3D_LAYERS = { only3d: [GROUND], only2d: [] as string[] }

export interface VehicleAir {
  readonly posts: AirVertex[][]
  readonly discs: FeatureCollection<Point, { sel: number }>
  /** Altitude AMSL per vehicle; `null` while its ground is unknown (the marker stays on the ground). */
  readonly alts: ReadonlyMap<number, number | null>
}

function homeOf(sysid: number, homes: ReadonlyMap<number, LatLon>, tracks: Tracks): LatLon | null {
  const h = homes.get(sysid)
  if (h) return h
  const first = tracks.get(sysid)?.[0]
  return first ? { lon: first[0], lat: first[1] } : null
}

export function vehicleAirData(vehicles: ReadonlyMap<number, VehicleState>, selected: number | null, homes: ReadonlyMap<number, LatLon>, tracks: Tracks, elevAt: ElevAt): VehicleAir {
  const posts: AirVertex[][] = []
  const discs: FeatureCollection<Point, { sel: number }> = { type: 'FeatureCollection', features: [] }
  const alts = new Map<number, number | null>()
  vehicles.forEach((v) => {
    const a = vehicleAmsl(v, homeOf(v.sysid, homes, tracks), elevAt)
    alts.set(v.sysid, a ? a.amsl : null)
    if (!a || v.alt_rel < 1) return
    const c = v.sysid === selected ? AMBER : CYAN
    posts.push(mercatorLine([{ lon: v.lon, lat: v.lat, amsl: Math.min(a.ground, a.amsl), color: c }, { lon: v.lon, lat: v.lat, amsl: Math.max(a.ground, a.amsl), color: c }]))
    discs.features.push({ type: 'Feature', properties: { sel: v.sysid === selected ? 1 : 0 }, geometry: { type: 'Point', coordinates: [v.lon, v.lat] } })
  })
  return { posts, discs, alts }
}

interface Args {
  readonly map: RefObject<MlMap | null>
  readonly loaded: RefObject<boolean>
  readonly mode: MapMode
  readonly terrainTiles: string | null
  readonly vehicles: ReadonlyMap<number, VehicleState>
  readonly selected: number | null
  readonly homes: ReadonlyMap<number, LatLon>
  readonly tracks: Tracks
  readonly markers: RefObject<ReadonlyMap<number, { marker: Marker }>>
  /** The markers' 2D offset (the `.vmk` disc correction). */
  readonly base: readonly [number, number]
}

function setup(m: MlMap, url: string, layer: AirPathLayer): void {
  m.addSource(DEM_SOURCE, terrainSource(url))
  m.addSource(GROUND, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  m.addLayer({
    id: GROUND,
    type: 'circle',
    source: GROUND,
    layout: { visibility: 'none' },
    paint: { 'circle-radius': 6, 'circle-color': ['case', ['==', ['get', 'sel'], 1], '#f2b544', '#9cc9ff'], 'circle-stroke-color': '#0f1824', 'circle-stroke-width': 2, 'circle-opacity': 0.9, 'circle-pitch-alignment': 'map' },
  })
  m.addLayer(layer)
  orderLayers(m)
}

/** Terrain, posts and floated markers; a no-op without terrain tiles. */
export function useVehicleAir({ map, loaded, mode, terrainTiles, vehicles, selected, homes, tracks, markers, base }: Args): void {
  const [tick, setTick] = useState(0)
  const [ready, setReady] = useState(false)
  const sampler = useMemo(() => (terrainTiles ? new TerrainSampler(terrainTiles, () => setTick((n) => n + 1)) : null), [terrainTiles])
  const layer = useRef<AirPathLayer>(new AirPathLayer(AIR))
  const floats = useRef<readonly Floating[]>([])
  const is3d = mode === '3d' && sampler !== null

  useEffect(() => {
    const m = map.current
    if (!m || !terrainTiles) return
    const go = () => {
      setup(m, terrainTiles, layer.current)
      layer.current.onFrame = (matrix) => floatMarkers(m, matrix, floats.current)
      setReady(true)
    }
    if (loaded.current) go()
    else m.once('load', go)
  }, [map, loaded, terrainTiles])

  useEffect(() => {
    const m = map.current
    if (!m || !ready) return
    layer.current.visible = is3d
    applyMapMode(m, is3d ? '3d' : '2d', OPS_3D_LAYERS)
    if (!is3d) floatMarkers(m, null, floats.current)
  }, [map, ready, is3d])

  useEffect(() => {
    const m = map.current
    if (!m || !ready || !sampler) return
    const d = vehicleAirData(vehicles, selected, homes, tracks, sampler.elevAt)
    floats.current = [...markers.current.entries()].flatMap(([sysid, { marker }]) => {
      const v = vehicles.get(sysid)
      return v ? [{ marker, lon: v.lon, lat: v.lat, amsl: d.alts.get(sysid) ?? null, base }] : []
    })
    layer.current.setLines([], d.posts)
    const src = m.getSource(GROUND) as { setData: (x: unknown) => void } | undefined
    src?.setData(d.discs)
  }, [map, ready, sampler, vehicles, selected, homes, tracks, markers, base, tick])
}
