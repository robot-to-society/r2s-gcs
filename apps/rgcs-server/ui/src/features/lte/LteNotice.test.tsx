import { act, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { t } from '../../shared/i18n'
import { LteAreasStore } from './areasStore'
import { LteNotice } from './LteNotice'
import { LteOverlayStore } from './prefs'
import { area } from './testArea'

const memory = () => {
  const items: Record<string, string> = {}
  return { getItem: (k: string) => items[k] ?? null, setItem: (k: string, v: string) => void (items[k] = v) }
}

describe('LteNotice', () => {
  it('shows_nothing_while_the_layer_is_off', () => {
    const { container } = render(<LteNotice dict={t('ja')} prefs={new LteOverlayStore(memory())} areas={new LteAreasStore(async () => [area()])} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('carries_the_no_guarantee_notice_with_the_newest_dates', async () => {
    const prefs = new LteOverlayStore(memory())
    act(() => prefs.toggle())
    render(<LteNotice dict={t('ja')} prefs={prefs} areas={new LteAreasStore(async () => [area()])} />)
    await waitFor(() => expect(screen.getByRole('note')).toHaveTextContent('ドコモ公開LTEエリア・上空通信の保証なし(取得 2026-10-31・データ 2026-10-01)'))
  })

  it('says_no_area_is_fetched_yet', async () => {
    const prefs = new LteOverlayStore(memory())
    act(() => prefs.toggle())
    render(<LteNotice dict={t('ja')} prefs={prefs} areas={new LteAreasStore(async () => [])} />)
    await waitFor(() => expect(screen.getByRole('note')).toHaveTextContent('LTE エリア未取得'))
  })

  it('an_unknown_data_date_reads_unknown', async () => {
    const prefs = new LteOverlayStore(memory())
    act(() => prefs.toggle())
    render(<LteNotice dict={t('ja')} prefs={prefs} areas={new LteAreasStore(async () => [area({ data_modified: null })])} />)
    await waitFor(() => expect(screen.getByRole('note')).toHaveTextContent('データ 不明'))
  })
})
