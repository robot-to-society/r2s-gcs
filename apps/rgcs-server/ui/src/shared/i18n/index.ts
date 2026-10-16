export type Lang = 'ja' | 'en'

const ja = {
  vehicles: '機体',
  filterVehicles: '機体を絞り込み (名前・モード)',
  ground: '地表',
  noVehicles: '機体が接続されるとここに表示されます',
  connecting: '接続中',
  linkOpen: 'サーバー接続',
  linkClosed: 'サーバー未接続',
  navMap: '運用マップ',
  navVideo: '全機体映像',
  navMission: 'ミッション',
  navAi: 'AIチャット',
  navSettings: 'メンテナンス・設定',
} as const

const en: Record<keyof typeof ja, string> = {
  vehicles: 'Vehicles',
  filterVehicles: 'Filter vehicles (name, mode)',
  ground: 'GROUND',
  noVehicles: 'Vehicles appear here once they connect',
  connecting: 'Connecting',
  linkOpen: 'Server connected',
  linkClosed: 'Server disconnected',
  navMap: 'Operations map',
  navVideo: 'All vehicle video',
  navMission: 'Mission',
  navAi: 'AI chat',
  navSettings: 'Maintenance & settings',
}

export type Dict = Record<keyof typeof ja, string>

export const dictionaries: Record<Lang, Dict> = { ja, en }

export function t(lang: Lang): Dict {
  return dictionaries[lang]
}
