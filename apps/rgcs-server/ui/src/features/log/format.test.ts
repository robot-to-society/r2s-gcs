import { describe, expect, it } from 'vitest'
import type { LogEntry } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { entryText } from './format'

const cmd = (text: string, severity: LogEntry['severity'] = 'error'): LogEntry => ({ id: 1, ts: 0, sysid: 1, source: 'command', severity, text, ackable: false, acked_by: null, acked_at: null })

describe('log entry text', () => {
  it('a bare failure code is not repeated after 失敗', () => {
    expect(entryText(cmd('arm failed'), t('ja'))).toBe('アーム 失敗')
  })

  it('known refusal codes are translated, anything else stays verbatim', () => {
    expect(entryText(cmd('arm denied'), t('ja'))).toBe('アーム 失敗 拒否')
    expect(entryText(cmd('rtl timeout'), t('ja'))).toBe('帰還 失敗 タイムアウト')
    expect(entryText(cmd('rtl temporarily_rejected'), t('ja'))).toBe('帰還 失敗 一時的に拒否')
    expect(entryText(cmd('rtl link_closed'), t('en'))).toBe('Return to launch failed link closed')
    expect(entryText(cmd('mission_upload 20 項目, 読込一致', 'ok'), t('ja'))).toBe('ミッション書込 成功 20 項目, 読込一致')
  })
})
