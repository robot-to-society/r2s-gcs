import type { Dict } from '../../shared/i18n'

export type MaintTab = 'params' | 'calib' | 'daily' | 'logbook' | 'history' | 'app'
/** Addendum §5.7: six tabs; 点検・校正 stays disabled (calibration is deferred past the demo, addendum §9). */
export const MAINT_TABS: readonly MaintTab[] = ['params', 'calib', 'daily', 'logbook', 'history', 'app']
export const ENABLED_TABS: ReadonlySet<MaintTab> = new Set<MaintTab>(['params', 'daily', 'logbook', 'history', 'app'])

export const TAB_LABEL: Record<MaintTab, keyof Dict> = {
  params: 'tabParams',
  calib: 'tabCalib',
  daily: 'tabDaily',
  logbook: 'tabLogbook',
  history: 'tabHistory',
  app: 'tabApp',
}
