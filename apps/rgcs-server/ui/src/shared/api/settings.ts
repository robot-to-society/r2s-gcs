import { useEffect, useState } from 'react'
import { apiFetch } from './client'
import type { AppSettings } from './types'

export const DEFAULT_SETTINGS: AppSettings = {
  lang: 'ja',
  map_tile_url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  map_attribution: '© OpenStreetMap contributors',
}

let cached: Promise<AppSettings> | null = null

/** `GET /api/settings/app`, fetched once per page; falls back to defaults when unreachable. */
export function loadAppSettings(): Promise<AppSettings> {
  cached ??= apiFetch<AppSettings>('/api/settings/app').catch(() => DEFAULT_SETTINGS)
  return cached
}

export function useAppSettings(): AppSettings | null {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  useEffect(() => {
    let alive = true
    void loadAppSettings().then((s) => alive && setSettings(s))
    return () => {
      alive = false
    }
  }, [])
  return settings
}
