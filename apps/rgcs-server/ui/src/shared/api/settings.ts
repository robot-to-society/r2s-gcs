import { useEffect, useSyncExternalStore } from 'react'
import { apiFetch } from './client'
import type { AppSettings, MapSettings } from './types'

export const DEFAULT_SETTINGS: AppSettings = {
  lang: 'ja',
  map_tile_url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  map_attribution: '© OpenStreetMap contributors',
  map: { gimbal_ground_projection: false },
  basemaps: [{ id: 'map', label: '地図', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], attribution: '© OpenStreetMap contributors', max_zoom: 19, overlay: null }],
}

let cached: Promise<AppSettings> | null = null
let current: AppSettings | null = null
const listeners = new Set<() => void>()

function publish(s: AppSettings): AppSettings {
  current = s
  listeners.forEach((l) => l())
  return s
}

/** `GET /api/settings/app`, fetched once per page; falls back to defaults when unreachable. */
export function loadAppSettings(): Promise<AppSettings> {
  cached ??= apiFetch<AppSettings>('/api/settings/app')
    .catch(() => DEFAULT_SETTINGS)
    .then((s) => (current ? current : publish(s)))
  return cached
}

/** `PUT /api/settings/app` (spec 50 §2.4): every component using the settings sees the saved value. */
export async function saveMapSettings(map: MapSettings): Promise<AppSettings> {
  const saved = await apiFetch<AppSettings>('/api/settings/app', { method: 'PUT', body: { map } })
  cached = Promise.resolve(saved)
  return publish(saved)
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useAppSettings(): AppSettings | null {
  useEffect(() => {
    void loadAppSettings()
  }, [])
  return useSyncExternalStore(subscribe, () => current)
}
