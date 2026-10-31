// The docomo LTE raster layer: the lowest app layer, above the base map and its labels and below the
// mission path, rally, tracks and vehicles. Every call is guarded by the caller (useLteOverlay).
import type { RasterSourceSpecification } from 'maplibre-gl'
import type { LteArea } from '../../shared/api/types'

export const LTE_LAYER = 'lte-area'
export const LTE_SOURCE = 'lte'
export const LTE_MIN_ZOOM = 8
/** Tiles exist up to 14; MapLibre overzooms above. */
export const LTE_MAX_ZOOM = 14
/** The base map's own layers (features/map/basemaps.ts). */
const BASE_LAYERS = ['base', 'labels']

/** [west, south, east, north] */
export type LteBounds = readonly [number, number, number, number]

/** Tiles are on disk: a completed fetch with some tiles, or a refetch of one. */
const hasTiles = (a: LteArea): boolean => a.status === 'ready' || a.status === 'partial' || (a.status === 'fetching' && a.fetched_at !== null)

/** The union of the areas with fetched tiles; null when there is none. */
export function lteBounds(areas: readonly LteArea[]): LteBounds | null {
  const shown = areas.filter(hasTiles)
  if (shown.length === 0) return null
  return [Math.min(...shown.map((a) => a.west)), Math.min(...shown.map((a) => a.south)), Math.max(...shown.map((a) => a.east)), Math.max(...shown.map((a) => a.north))]
}

/** Changes when a fetch completes, so the tile URLs (and the browser cache) are renewed. */
export function lteVersion(areas: readonly LteArea[]): string {
  return String(Math.max(0, ...areas.filter(hasTiles).map((a) => a.fetched_at ?? 0)))
}

/** `YYYY-MM-DD` in local time. */
export function ymd(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** The notice's dates: the newest fetch and the newest data date; null with no fetched area. */
export function lteNoticeDates(areas: readonly LteArea[]): { readonly fetched: string; readonly data: string | null } | null {
  const shown = areas.filter(hasTiles)
  const fetched = Math.max(...shown.map((a) => a.fetched_at ?? 0))
  if (shown.length === 0 || fetched <= 0) return null
  const data = Math.max(0, ...shown.map((a) => a.data_modified ?? 0))
  return { fetched: ymd(fetched), data: data > 0 ? ymd(data) : null }
}

/** The parts of a MapLibre map the overlay uses (a fake in tests). */
export interface LteHost {
  getStyle(): { layers?: readonly { id: string }[] } | undefined
  getLayer(id: string): unknown
  getSource(id: string): unknown
  addSource(id: string, source: RasterSourceSpecification): unknown
  addLayer(layer: { id: string; type: 'raster'; source: string; minzoom: number; paint: { 'raster-opacity': number } }, before?: string): unknown
  removeLayer(id: string): unknown
  removeSource(id: string): unknown
  setPaintProperty(layer: string, name: string, value: unknown): unknown
}

export function lteSource(bounds: LteBounds, version: string): RasterSourceSpecification {
  return { type: 'raster', tiles: [`/api/lte/tiles/{z}/{x}/{y}.gif?v=${version}`], tileSize: 256, minzoom: LTE_MIN_ZOOM, maxzoom: LTE_MAX_ZOOM, bounds: [...bounds] }
}

/** Adds the source and the layer right above the base map (below the first other layer). */
export function addLte(map: LteHost, bounds: LteBounds, version: string, opacity: number): void {
  const before = map.getStyle()?.layers?.find((l) => !BASE_LAYERS.includes(l.id) && l.id !== LTE_LAYER)?.id
  map.addSource(LTE_SOURCE, lteSource(bounds, version))
  map.addLayer({ id: LTE_LAYER, type: 'raster', source: LTE_SOURCE, minzoom: LTE_MIN_ZOOM, paint: { 'raster-opacity': opacity / 100 } }, before)
}

export function removeLte(map: LteHost): void {
  if (map.getLayer(LTE_LAYER)) map.removeLayer(LTE_LAYER)
  if (map.getSource(LTE_SOURCE)) map.removeSource(LTE_SOURCE)
}

export function setLteOpacity(map: LteHost, opacity: number): void {
  if (map.getLayer(LTE_LAYER)) map.setPaintProperty(LTE_LAYER, 'raster-opacity', opacity / 100)
}
