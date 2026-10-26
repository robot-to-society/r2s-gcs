import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MissionTransfer, VehicleState } from '../../shared/api/types'
import { t } from '../../shared/i18n'

let adds = 0
vi.mock('./MissionMap', () => ({
  MissionMap: (p: { onAdd: (lat: number, lon: number) => void; tab?: string; onPlanClick: (tab: string, lat: number, lon: number) => void; fitTo?: { points: unknown[] } | null }) => (
    <div data-testid="mission-map" data-tab={p.tab} data-fit={p.fitTo?.points.length ?? 0}>
      <button type="button" onClick={() => p.onAdd(36.1 + 0.001 * adds++, 139.1)}>
        map-add
      </button>
      <button type="button" onClick={() => p.tab && p.tab !== 'mission' && p.onPlanClick(p.tab, 36.2 + 0.001 * adds, 139.2 + 0.001 * adds++)}>
        map-plan
      </button>
    </div>
  ),
}))

const { MissionView } = await import('./MissionView')
const { MissionStore } = await import('./store')
const { BriefingStore } = await import('../briefing/store')
const { appendWaypoint, emptyDraft, toMission } = await import('./model')
const { serializeRgcsMission } = await import('./files')
const { rasterStyle } = await import('../map/style')

const copter: VehicleState = {
  sysid: 1, name: 'UAV-01', kind: 'copter', mode: 'STABILIZE', armed: false, lat: 36.16, lon: 139.37, alt_rel: 0, alt_msl: 0, hdg: 0,
  ground_speed: 0, climb: 0, battery: { pct: 90, volt: 24, current: null }, link: 'ok', last_rx_ms: 0, gps: { fix: 3, sats: 12, hdop: 1 }, warn: false, unread: 0,
}
const style = rasterStyle('https://t/{z}/{x}/{y}.png', 'x')
const envelope = (data: unknown, status = 200) => new Response(JSON.stringify({ success: true, data }), { status, headers: { 'content-type': 'application/json' } })

function setup(fetchImpl?: (url: string, init?: RequestInit) => Response, transfers: ReadonlyMap<number, MissionTransfer> = new Map(), vehicles: ReadonlyMap<number, VehicleState> = new Map([[1, copter]])) {
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => (fetchImpl ? fetchImpl(String(input), init) : envelope([])))
  vi.stubGlobal('fetch', fetchMock)
  const store = new MissionStore()
  const briefing = new BriefingStore()
  const utils = render(<MissionView vehicles={vehicles} transfers={transfers} dict={t('ja')} style={style} store={store} briefing={briefing} />)
  return { ...utils, fetchMock, store, briefing }
}

/** The write target is never implied (UX-32): the operator picks it in the right panel. */
const target = (sysid = '1') => {
  fireEvent.change(within(screen.getByRole('complementary', { name: 'editor' })).getByLabelText('対象機体'), { target: { value: sysid } })
}
const addPoints = (n: number) => {
  for (let i = 0; i < n; i++) fireEvent.click(screen.getByText('map-add'))
}
const wpRows = () => [...document.querySelectorAll<HTMLElement>('.wrow')]
const rows = () => wpRows().map((li) => li.querySelector('.cmd-label')?.textContent)
const briefRows = () => [...document.querySelectorAll<HTMLElement>('.brief-row')]
const missionFile = (name: string, points: number): File => {
  const draft = Array.from({ length: points }).reduce<ReturnType<typeof emptyDraft>>((d, _, i) => appendWaypoint(d, 36 + i * 0.001, 139), emptyDraft())
  return new File([serializeRgcsMission({ ...toMission(draft), name })], `${name}.rgcsmission`)
}
const loadFile = async (f: File) => {
  await act(async () => {
    fireEvent.change(screen.getByTestId('mission-file'), { target: { files: [f] } })
  })
}

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

  it('the_first_click_adds_a_takeoff_without_coordinates_and_a_waypoint_at_the_click', () => {
    const { store } = setup()
    addPoints(1)
    expect(rows()).toEqual(['離陸', 'ウェイポイント'])
    const [t0, w] = store.getState().history.present.items
    expect([t0!.lat, t0!.lon]).toEqual([0, 0])
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

  it('shows_the_write_progress_of_the_target_vehicle', () => {
    setup(undefined, new Map([[1, { phase: 'verify', done: 5, total: 21 } as MissionTransfer]]))
    target()
    expect(screen.getByRole('progressbar', { name: 'ミッション書込' })).toHaveTextContent('読み戻して照合中 5 / 21')
  })

  it('the_elevation_profile_opens_from_the_map', () => {
    setup()
    target()
    addPoints(2)
    fireEvent.click(screen.getByRole('button', { name: '標高プロファイル' }))
    expect(screen.getByRole('region', { name: '標高プロファイル' }).querySelectorAll('.rg-elev-pt')).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: '標高プロファイル' }))
  })

  it('cmd_c_with_nothing_selected_leaves_the_browser_copy_alone', () => {
    const { container } = setup()
    expect(fireEvent.keyDown(container.firstChild as Element, { key: 'c', metaKey: true })).toBe(true)
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

  it('the fence and rally tabs get their own right panel and load their files', async () => {
    localStorage.removeItem('rgcs.planTab')
    setup()
    const tabs = within(screen.getByRole('group', { name: '計画の種類' }))
    fireEvent.click(tabs.getByRole('button', { name: 'Fence' }))
    expect(screen.queryByRole('complementary', { name: 'editor' })).not.toBeInTheDocument()
    const right = screen.getByRole('complementary', { name: 'フェンス設定' })
    const wpl = 'QGC WPL 110\n0\t0\t0\t5003\t150\t0\t0\t0\t36.25\t137.63\t0\t1\n'
    await act(async () => {
      fireEvent.change(within(right).getByLabelText('ファイルから読込'), { target: { files: [new File([wpl], 'f.waypoints')] } })
    })
    expect(screen.getByTestId('fence-row').querySelector('.fence-title')?.textContent).toBe('包含円')
    expect(within(right).getByText('1 件を読み込みました')).toBeInTheDocument()
    // the map frames what was loaded (a circle: its north / south extent)
    expect(screen.getByTestId('mission-map').dataset.fit).toBe('2')
    fireEvent.click(tabs.getByRole('button', { name: 'Rally' }))
    const rally = screen.getByRole('complementary', { name: 'ラリーポイント設定' })
    await act(async () => {
      fireEvent.change(within(rally).getByLabelText('ファイルから読込'), { target: { files: [new File(['nonsense'], 'r.txt')] } })
    })
    expect(within(rally).getByText('読み込めませんでした')).toBeInTheDocument()
    fireEvent.click(tabs.getByRole('button', { name: 'Mission' }))
    expect(screen.getByRole('complementary', { name: 'editor' })).toBeInTheDocument()
  })

  it('fence_tab_draws_a_polygon_by_clicks_and_writes_it_to_the_vehicle', async () => {
    localStorage.removeItem('rgcs.planTab')
    const { fetchMock, container } = setup((url, init) => (url.endsWith('/fence') && init?.method === 'PUT' ? envelope({ items: 3, verified: true, mismatched: [], findings: [] }) : envelope([])))
    target()
    fireEvent.click(within(screen.getByRole('group', { name: '計画の種類' })).getByRole('button', { name: 'Fence' }))
    expect(screen.getByTestId('mission-map').dataset.tab).toBe('fence')
    fireEvent.click(screen.getByRole('button', { name: '包含ポリゴン' }))
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByText('map-plan'))
    fireEvent.keyDown(container.firstChild as Element, { key: 'Enter' })
    expect(screen.getByTestId('fence-row').querySelector('.fence-title')?.textContent).toBe('包含ポリゴン · 3 点')
    expect(screen.queryByRole('button', { name: '完了' })).not.toBeInTheDocument()
    // the fence panel names the vehicle it writes to
    expect(within(screen.getByRole('complementary', { name: 'フェンス設定' })).getByText('対象機体: UAV-01')).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'フェンスを機体に書込' }))
    })
    const put = fetchMock.mock.calls.find(([u, i]) => String(u).endsWith('/fence') && i?.method === 'PUT')!
    expect(JSON.parse(String(put[1]!.body)).zones[0].vertices).toHaveLength(3)
    expect(screen.getByText('書き込みました (読み戻して一致)')).toBeInTheDocument()
    // the waypoints still count in the plan; a click on the map does not add one here
    expect(rows()).toEqual([])
    localStorage.removeItem('rgcs.planTab')
  })

  it('deleting_or_reading_the_fence_while_drawing_stops_the_drawing_instead_of_growing_another_zone', async () => {
    localStorage.removeItem('rgcs.planTab')
    const fromVehicle = [
      { kind: 'polygon', inclusion: false, vertices: [{ lat: 36, lon: 137 }, { lat: 36, lon: 137.01 }, { lat: 36.01, lon: 137.01 }] },
      { kind: 'polygon', inclusion: false, vertices: [{ lat: 36, lon: 137 }, { lat: 36, lon: 137.02 }, { lat: 36.02, lon: 137.02 }] },
    ]
    setup((url) => (url.endsWith('/fence') ? envelope({ zones: fromVehicle }) : envelope([])))
    target()
    fireEvent.click(within(screen.getByRole('group', { name: '計画の種類' })).getByRole('button', { name: 'Fence' }))
    fireEvent.click(screen.getByRole('button', { name: '包含ポリゴン' }))
    fireEvent.click(screen.getByText('map-plan'))
    fireEvent.click(screen.getByText('map-plan'))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'フェンスを機体から読込' }))
    })
    expect(screen.queryByRole('button', { name: '完了' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('map-plan'))
    const titles = () => screen.getAllByTestId('fence-row').map((r) => r.querySelector('.fence-title')?.textContent)
    expect(titles()).toEqual(['除外ポリゴン · 3 点', '除外ポリゴン · 3 点'])
    // deleting the zone being drawn stops the drawing too
    fireEvent.click(screen.getByRole('button', { name: '包含ポリゴン' }))
    fireEvent.click(screen.getByText('map-plan'))
    fireEvent.click(within(screen.getAllByTestId('fence-row')[2]!).getByRole('button', { name: '削除' }))
    fireEvent.click(screen.getByText('map-plan'))
    expect(titles()).toEqual(['除外ポリゴン · 3 点', '除外ポリゴン · 3 点'])
    localStorage.removeItem('rgcs.planTab')
  })

  it('a_failed_rally_write_warns_that_the_vehicle_may_hold_part_of_the_list', async () => {
    localStorage.removeItem('rgcs.planTab')
    setup((url, init) =>
      url.endsWith('/rally') && init?.method === 'PUT'
        ? new Response(JSON.stringify({ success: false, error: { code: 'mission_timeout', message: 'the vehicle did not answer in time' } }), { status: 504, headers: { 'content-type': 'application/json' } })
        : envelope([]),
    )
    target()
    fireEvent.click(within(screen.getByRole('group', { name: '計画の種類' })).getByRole('button', { name: 'Rally' }))
    fireEvent.click(screen.getByText('map-plan'))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'ラリーを機体に書込' }))
    })
    expect(screen.getByText(/途中までの可能性/)).toBeInTheDocument()
    localStorage.removeItem('rgcs.planTab')
  })

  it('rally_tab_adds_points_at_the_default_altitude_and_undo_removes_them', () => {
    localStorage.removeItem('rgcs.planTab')
    const { container } = setup()
    fireEvent.click(within(screen.getByRole('group', { name: '計画の種類' })).getByRole('button', { name: 'Rally' }))
    fireEvent.click(screen.getByText('map-plan'))
    fireEvent.click(screen.getByText('map-plan'))
    expect(screen.getAllByTestId('rally-row')).toHaveLength(2)
    expect((within(screen.getAllByTestId('rally-row')[0]!).getByLabelText('高度') as HTMLInputElement).value).toBe('50')
    fireEvent.keyDown(container.firstChild as Element, { key: 'z', metaKey: true })
    expect(screen.getAllByTestId('rally-row')).toHaveLength(1)
    localStorage.removeItem('rgcs.planTab')
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
    // the planner reads the target vehicle's FENCE_* and path parameters on its own: not part of this flow
    const calls = fetchMock.mock.calls.map(([u, i]) => `${i?.method ?? 'GET'} ${String(u)}`).filter((c) => !c.endsWith('/fence/params') && !c.includes('/params/pick'))
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
    target()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '機体に書き込む' }))
    })
    expect(screen.getByText('先頭が TAKEOFF ではありません')).toBeInTheDocument()
    // the planner reads the target vehicle's FENCE_* and path parameters on its own: not part of this flow
    const calls = fetchMock.mock.calls.map(([u, i]) => `${i?.method ?? 'GET'} ${String(u)}`).filter((c) => !c.endsWith('/fence/params') && !c.includes('/params/pick') && !c.endsWith('/registry'))
    expect(calls).toEqual(['POST /api/missions/validate?sysid=1'])
  })

  it('with several vehicles connected the write asks which ones, then writes each in turn', async () => {
    const two = new Map([[1, copter], [2, { ...copter, sysid: 2, name: 'UAV-02' }], [3, { ...copter, sysid: 3, name: 'UAV-03', link: 'lost' as const }]])
    const ok = { findings: [], stats: { distance_m: 0, duration_s: 0, max_alt: 0 } }
    const { fetchMock } = setup((url) => {
      if (url.startsWith('/api/missions/validate')) return envelope(ok)
      if (/\/api\/vehicles\/\d\/mission$/.test(url)) return envelope({ verified: true, items: 3, mismatched: [], findings: [] })
      return envelope([])
    }, new Map(), two)
    addPoints(2)
    target()
    fireEvent.click(screen.getByRole('button', { name: '機体に書き込む' }))
    const sheet = screen.getByRole('dialog', { name: '書き込む機体を選択' })
    // the lost vehicle is not offered
    expect(within(sheet).queryByText('UAV-03')).not.toBeInTheDocument()
    fireEvent.click(within(sheet).getByRole('button', { name: 'すべて選択' }))
    await act(async () => {
      fireEvent.click(within(sheet).getByRole('button', { name: '2 機に書き込む' }))
    })
    expect(screen.queryByRole('dialog', { name: '書き込む機体を選択' })).not.toBeInTheDocument()
    const calls = fetchMock.mock.calls.map(([u, i]) => `${i?.method ?? 'GET'} ${String(u)}`).filter((c) => c.includes('/mission'))
    expect(calls).toEqual(['POST /api/missions/validate?sysid=1', 'PUT /api/vehicles/1/mission', 'POST /api/missions/validate?sysid=2', 'PUT /api/vehicles/2/mission'])
  })

  it('a vehicle stopped by a fatal finding keeps the finding on screen while the others are written', async () => {
    const two = new Map([[1, copter], [2, { ...copter, sysid: 2, name: 'UAV-02' }]])
    const fatal = { findings: [{ level: 'fatal', code: 'first_not_takeoff', seq: 1, message: 'x' }], stats: { distance_m: 0, duration_s: 0, max_alt: 0 } }
    const ok = { findings: [], stats: { distance_m: 0, duration_s: 0, max_alt: 0 } }
    const { fetchMock } = setup((url) => {
      if (url.startsWith('/api/missions/validate')) return envelope(url.endsWith('sysid=1') ? fatal : ok)
      if (/\/api\/vehicles\/\d\/mission$/.test(url)) return envelope({ verified: true, items: 3, mismatched: [], findings: [] })
      return envelope([])
    }, new Map(), two)
    addPoints(2)
    target()
    fireEvent.click(screen.getByRole('button', { name: '機体に書き込む' }))
    fireEvent.click(screen.getByRole('button', { name: 'すべて選択' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '2 機に書き込む' }))
    })
    expect(screen.getByText('先頭が TAKEOFF ではありません')).toBeInTheDocument()
    const puts = fetchMock.mock.calls.map(([u, i]) => `${i?.method ?? 'GET'} ${String(u)}`).filter((c) => c.startsWith('PUT /api/vehicles'))
    expect(puts).toEqual(['PUT /api/vehicles/2/mission'])
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
    // the planner reads the target vehicle's FENCE_* and path parameters on its own: not part of this flow
    const calls = fetchMock.mock.calls.map(([u, i]) => `${i?.method ?? 'GET'} ${String(u)}`).filter((c) => !c.endsWith('/fence/params') && !c.includes('/params/pick'))
    expect(calls).toEqual(['POST /api/missions', 'PUT /api/missions/5', 'GET /api/missions/5/export?format=waypoints'])
    expect(screen.queryByText('未保存')).not.toBeInTheDocument()
    expect(click).toHaveBeenCalledTimes(1)
    click.mockRestore()
  })

  it('loading_a_file_adds_a_row_instead_of_replacing', async () => {
    const { store, briefing } = setup()
    expect(briefRows()).toHaveLength(1)
    // the untouched starting row takes the first file
    await loadFile(missionFile('Alpha', 2))
    expect(briefRows()).toHaveLength(1)
    const alphaItems = store.getState().history.present.items.length
    expect(alphaItems).toBeGreaterThan(0)
    await loadFile(missionFile('Beta', 1))
    expect(briefRows().map((r) => r.querySelector('.brief-name')?.textContent)).toEqual(['Alpha', 'Beta'])
    expect(briefRows()[1]!.getAttribute('aria-current')).toBe('true')
    expect(store.getState().history.present.mission.name).toBe('Beta')
    fireEvent.click(within(briefRows()[0]!).getByText('Alpha'))
    expect(store.getState().history.present.mission.name).toBe('Alpha')
    expect(store.getState().history.present.items).toHaveLength(alphaItems)
    expect(briefing.getState().rows).toHaveLength(2)
    // no discard question any more: nothing is lost
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('the_write_button_defaults_to_the_rows_vehicle', async () => {
    const two = new Map([[1, copter], [2, { ...copter, sysid: 2, name: 'UAV-02', link: 'lost' as const }]])
    const ok = { findings: [], stats: { distance_m: 0, duration_s: 0, max_alt: 0 } }
    const { fetchMock } = setup((url) => {
      if (url.startsWith('/api/missions/validate')) return envelope(ok)
      if (/\/api\/vehicles\/\d\/mission$/.test(url)) return envelope({ verified: true, items: 3, mismatched: [], findings: [] })
      return envelope([])
    }, new Map(), two)
    addPoints(2)
    fireEvent.change(within(briefRows()[0]!).getByLabelText('割当機体'), { target: { value: '2' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '機体に書き込む' }))
    })
    const calls = fetchMock.mock.calls.map(([u, i]) => `${i?.method ?? 'GET'} ${String(u)}`).filter((c) => c.includes('/mission'))
    expect(calls).toEqual(['POST /api/missions/validate?sysid=2', 'PUT /api/vehicles/2/mission'])
  })

  it('the_clipboard_follows_into_an_opened_file_and_a_switched_row', async () => {
    const { container, store } = setup()
    const root = container.firstChild as Element
    addPoints(2) // A: T, 36.1, 36.101
    fireEvent.click(wpRows()[2]!)
    fireEvent.keyDown(root, { key: 'c', metaKey: true })
    await loadFile(missionFile('Beta', 2)) // B: 36 (takeoff), 36.001
    const lats = () => store.getState().history.present.items.map((it) => it.lat)
    const before = lats().length
    fireEvent.keyDown(root, { key: 'v', metaKey: true })
    expect(lats()).toHaveLength(before + 1)
    expect(lats()).toContain(36.101)
    // copy in B, switch back to A: B's copy is pasted there
    fireEvent.click(wpRows()[1]!)
    fireEvent.keyDown(root, { key: 'c', metaKey: true })
    fireEvent.click(briefRows()[0]!.querySelector('.brief-name')!)
    expect(store.getState().history.present.mission.name).not.toBe('Beta')
    fireEvent.keyDown(root, { key: 'v', metaKey: true })
    expect(lats()).toContain(36.001)
  })

  it('a rover target hides the altitude settings and the maximum altitude (UX-35)', () => {
    setup(undefined, new Map(), new Map([[4, { ...copter, sysid: 4, name: 'UAV-04', kind: 'rover' as const }]]))
    target('4')
    const right = within(screen.getByRole('complementary', { name: 'editor' }))
    expect(right.queryByLabelText('既定高度')).toBeNull()
    expect(right.queryByText('最大高度')).toBeNull()
    expect(screen.getByTestId('mission-view').querySelector('.mission-pill')?.textContent).not.toContain('最大高度')
  })

  it('the_right_panel_vehicle_assigns_the_row_and_frees_it_elsewhere', async () => {
    const two = new Map([[1, copter], [2, { ...copter, sysid: 2, name: 'UAV-02' }]])
    setup(undefined, new Map(), two)
    await loadFile(missionFile('Alpha', 1))
    fireEvent.change(within(briefRows()[0]!).getByLabelText('割当機体'), { target: { value: '2' } })
    await loadFile(missionFile('Beta', 1))
    const assigned = () => briefRows().map((r) => (within(r).getByLabelText('割当機体') as HTMLSelectElement).value)
    expect(assigned()).toEqual(['2', ''])
    const right = screen.getByRole('complementary', { name: 'editor' })
    fireEvent.change(within(right).getByLabelText('対象機体'), { target: { value: '2' } })
    expect(assigned()).toEqual(['', '2'])
  })
})
