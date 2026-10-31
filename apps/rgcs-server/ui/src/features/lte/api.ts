// REST calls for the docomo LTE area overlay (design 2026-10-31-docomo-lte-overlay, API table).
import { apiFetch } from '../../shared/api/client'
import type { LteArea, LteEstimate } from '../../shared/api/types'

/** A rectangle in degrees (south < north, west < east). */
export interface LteRect {
  readonly south: number
  readonly west: number
  readonly north: number
  readonly east: number
}

export const listLteAreas = (): Promise<LteArea[]> => apiFetch('/api/lte/areas')
/** The tiles a fetch of `rect` would take (zoom 8–14). */
export const estimateLteArea = async (rect: LteRect): Promise<number> => (await apiFetch<LteEstimate>('/api/lte/areas/estimate', { method: 'POST', body: rect })).tiles
/** Saves the area and starts its fetch (400 `bad_rect` / `too_many_tiles`). */
export const createLteArea = (area: LteRect & { readonly name: string }): Promise<LteArea> => apiFetch('/api/lte/areas', { method: 'POST', body: area })
/** Fetches the area again (409 `busy` while it is fetching). */
export const refreshLteArea = (id: number): Promise<unknown> => apiFetch(`/api/lte/areas/${id}/refresh`, { method: 'POST' })
export const deleteLteArea = (id: number): Promise<unknown> => apiFetch(`/api/lte/areas/${id}`, { method: 'DELETE' })

export interface LteApi {
  readonly estimate: (rect: LteRect) => Promise<number>
  readonly create: (area: LteRect & { readonly name: string }) => Promise<unknown>
  readonly refresh: (id: number) => Promise<unknown>
  readonly remove: (id: number) => Promise<unknown>
}

export const LTE_API: LteApi = { estimate: estimateLteArea, create: createLteArea, refresh: refreshLteArea, remove: deleteLteArea }
