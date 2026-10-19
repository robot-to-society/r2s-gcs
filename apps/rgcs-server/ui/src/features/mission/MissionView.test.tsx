import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VehicleState } from '../../shared/api/types'
import { t } from '../../shared/i18n'

let adds = 0
vi.mock('./MissionMap', () => ({
  MissionMap: (p: { onAdd: (lat: number, lon: number) => void }) => (
    <div data-testid="mission-map">
      <button type="button" onClick={() => p.onAdd(36.1 + 0.001 * adds++, 139.1)}>
        map-add
      </button>
    </div>
  ),
}))

const { MissionView } = await import('./MissionView')
const { MissionStore } = await import('./store')
const { rasterStyle } = await import('../map/style')

const copter: VehicleState = {
  sysid: 1, name: 'UAV-01', kind: 'copter', mode: 'STABILIZE', armed: false, lat: 36.16, lon: 139.37, alt_rel: 0, alt_msl: 0, hdg: 0,
  ground_speed: 0, climb: 0, battery: { pct: 90, volt: 24, current: null }, link: 'ok', last_rx_ms: 0, gps: { fix: 3, sats: 12, hdop: 1 }, warn: false, unread: 0,
}
const style = rasterStyle('https://t/{z}/{x}/{y}.png', 'x')
const envelope = (data: unknown, status = 200) => new Response(JSON.stringify({ success: true, data }), { status, headers: { 'content-type': 'application/json' } })

function setup(fetchImpl?: (url: string, init?: RequestInit) => Response) {
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => (fetchImpl ? fetchImpl(String(input), init) : envelope([])))
  vi.stubGlobal('fetch', fetchMock)
  const store = new MissionStore()
  const utils = render(<MissionView vehicles={new Map([[1, copter]])} dict={t('ja')} style={style} store={store} />)
  return { ...utils, fetchMock, store }
}

const addPoints = (n: number) => {
  for (let i = 0; i < n; i++) fireEvent.click(screen.getByText('map-add'))
}
const wpRows = () => [...document.querySelectorAll<HTMLElement>('.wrow')]
const rows = () => wpRows().map((li) => li.querySelector('.cmd-label')?.textContent)

describe('MissionView', () => {
  beforeEach(() => {
    adds = 0
  })
  afterEach(() => vi.unstubAllGlobals())

  it('help_lists_the_3d_altitude_and_position_drags_and_the_path_colours', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'マップ操作ガイド' }))
    const panel = screen.getByRole('dialog', { name: 'マップ操作ガイド' })
    expect(panel.textContent).toContain('高度だけを変更')
    expect(panel.textContent).toContain('位置だけを変更')
    expect(panel.textContent).toContain('急上昇ほど赤')
  })

  it('the_first_click_puts_the_takeoff_at_the_target_vehicle_and_a_waypoint_at_the_click', () => {
    const { store } = setup()
    addPoints(1)
    expect(rows()).toEqual(['離陸', 'ウェイポイント'])
    const [t0, w] = store.getState().history.present.items
    expect([t0!.lat, t0!.lon]).toEqual([36.16, 139.37])
    expect([w!.lat, w!.lon]).toEqual([36.1, 139.1])
  })

  it('adding_three_points_lists_takeoff_then_three_waypoints', () => {
    setup()
    addPoints(3)
    expect(rows()).toEqual(['離陸', 'ウェイポイント', 'ウェイポイント', 'ウェイポイント'])
    expect(within(screen.getByTestId('mission-summary')).getByText('最大高度').nextSibling?.textContent).toContain('50')
  })

  it('delete_key_removes_the_selection_and_undo_brings_it_back', () => {
    const { container } = setup()
    addPoints(2) // takeoff + 2 waypoints
    fireEvent.click(wpRows()[1]!)
    expect(wpRows()[1]!.className).toContain('sel')
    fireEvent.keyDown(container.firstChild as Element, { key: 'Delete' })
    expect(rows()).toEqual(['離陸', 'ウェイポイント'])
    fireEvent.keyDown(container.firstChild as Element, { key: 'z', metaKey: true })
    expect(rows()).toEqual(['離陸', 'ウェイポイント', 'ウェイポイント'])
    fireEvent.keyDown(container.firstChild as Element, { key: 'z', metaKey: true, shiftKey: true })
    expect(rows()).toEqual(['離陸', 'ウェイポイント'])
  })

  it('editor_shows_the_selected_item_and_bulk_note_for_many', () => {
    setup()
    addPoints(3)
    expect(screen.queryByTestId('item-editor')).not.toBeInTheDocument()
    fireEvent.click(wpRows()[1]!)
    expect((screen.getByLabelText('コマンド') as HTMLSelectElement).value).toBe('WAYPOINT')
    fireEvent.click(wpRows()[2]!, { ctrlKey: true })
    expect(screen.getByTestId('bulk-edit')).toHaveTextContent('2')
    expect(screen.getByText('件を選択中')).toBeInTheDocument()
  })

  it('list_shift_selects_a_range_ctrl_toggles_and_both_combine', () => {
    setup()
    addPoints(5) // T + 5 WP = 6 rows
    const sel = () => wpRows().map((r) => r.className.includes('sel'))
    fireEvent.click(wpRows()[1]!)
    fireEvent.click(wpRows()[3]!, { shiftKey: true })
    expect(sel()).toEqual([false, true, true, true, false, false])
    fireEvent.click(wpRows()[5]!, { ctrlKey: true })
    expect(sel()).toEqual([false, true, true, true, false, true])
    fireEvent.click(wpRows()[2]!, { metaKey: true })
    expect(sel()).toEqual([false, true, false, true, false, true])
    // Shift extends from the last Ctrl-clicked row and keeps the rest
    fireEvent.click(wpRows()[0]!, { shiftKey: true })
    expect(sel()).toEqual([true, true, true, true, false, true])
  })

  it('cmd_c_then_cmd_v_duplicates_the_selection_after_it', () => {
    const { container } = setup()
    addPoints(2) // T, 2, 3
    fireEvent.click(wpRows()[1]!)
    fireEvent.keyDown(container.firstChild as Element, { key: 'c', metaKey: true })
    fireEvent.keyDown(container.firstChild as Element, { key: 'v', ctrlKey: true })
    expect(rows()).toEqual(['離陸', 'ウェイポイント', 'ウェイポイント', 'ウェイポイント'])
    expect(wpRows()[2]!.className).toContain('sel')
  })

  it('save_calls_create_then_update', async () => {
    const { fetchMock } = setup((url, init) => {
      if (url === '/api/missions' && init?.method === 'POST') return envelope({ ...JSON.parse(String(init.body)), id: 5 })
      if (url === '/api/missions/5' && init?.method === 'PUT') return envelope({ ...JSON.parse(String(init.body)), id: 5 })
      return envelope([])
    })
    addPoints(2)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存' }))
    })
    await act(async () => {
      fireEvent.click(screen.getByText('map-add'))
      fireEvent.click(screen.getByRole('button', { name: '保存' }))
    })
    const calls = fetchMock.mock.calls.map(([u, i]) => `${i?.method ?? 'GET'} ${String(u)}`)
    expect(calls).toEqual(['POST /api/missions', 'PUT /api/missions/5'])
    expect(screen.queryByText('未保存')).not.toBeInTheDocument()
  })

  it('upload_with_fatal_findings_shows_them_and_does_not_upload', async () => {
    const { fetchMock } = setup((url) => {
      if (url.startsWith('/api/missions/validate')) {
        return envelope({ findings: [{ level: 'fatal', code: 'first_not_takeoff', seq: 1, message: 'x' }], stats: { distance_m: 0, duration_s: 0, max_alt: 0 } })
      }
      return envelope([])
    })
    addPoints(2)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '機体に書き込む' }))
    })
    expect(screen.getByText('先頭が TAKEOFF ではありません')).toBeInTheDocument()
    const calls = fetchMock.mock.calls.map(([u, i]) => `${i?.method ?? 'GET'} ${String(u)}`)
    expect(calls).toEqual(['POST /api/missions/validate?sysid=1'])
  })

  it('export_saves_a_dirty_mission_first', async () => {
    const { fetchMock } = setup((url, init) => {
      if (url === '/api/missions' && init?.method === 'POST') return envelope({ ...JSON.parse(String(init.body)), id: 5 })
      if (url === '/api/missions/5' && init?.method === 'PUT') return envelope({ ...JSON.parse(String(init.body)), id: 5 })
      if (url.startsWith('/api/missions/5/export')) return new Response('QGC WPL 110\n', { status: 200, headers: { 'content-type': 'text/plain' } })
      return envelope([])
    })
    vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:x', revokeObjectURL: () => {} })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    addPoints(2)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存' }))
    })
    await act(async () => {
      fireEvent.click(screen.getByText('map-add'))
    })
    expect(screen.getByText('未保存')).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'ファイルに保存' }))
    })
    const calls = fetchMock.mock.calls.map(([u, i]) => `${i?.method ?? 'GET'} ${String(u)}`)
    expect(calls).toEqual(['POST /api/missions', 'PUT /api/missions/5', 'GET /api/missions/5/export?format=waypoints'])
    expect(screen.queryByText('未保存')).not.toBeInTheDocument()
    expect(click).toHaveBeenCalledTimes(1)
    click.mockRestore()
  })
})
