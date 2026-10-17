import { describe, expect, it } from 'vitest'
import { t } from '../../shared/i18n'
import { messageText, severityClass } from './format'

describe('message formatting', () => {
  it('maps MAV_SEVERITY to a class', () => {
    expect([0, 1, 2, 3].map(severityClass)).toEqual(['danger', 'danger', 'danger', 'danger'])
    expect(severityClass(4)).toBe('caution')
    expect([5, 6, 7].map(severityClass)).toEqual(['info', 'info', 'info'])
  })

  it('translates link codes and keeps vehicle text verbatim', () => {
    const d = t('ja')
    expect(messageText('comms_delay', d)).toBe('通信遅延')
    expect(messageText('link_lost', d)).toBe('通信喪失')
    expect(messageText('link_restored', d)).toBe('通信復帰')
    expect(messageText('PreArm: Compass not calibrated', d)).toBe('PreArm: Compass not calibrated')
  })
})
