// Copy for P9: the 3D map and the operator improvements of 2026-10-19.

export const p9Ja = {
  map3dUnavailable: '標高タイルが設定されていないため 3D は使えません (config.toml terrain_tiles)',
} as const

export const p9En: Record<keyof typeof p9Ja, string> = {
  map3dUnavailable: '3D needs terrain tiles (config.toml terrain_tiles)',
}
