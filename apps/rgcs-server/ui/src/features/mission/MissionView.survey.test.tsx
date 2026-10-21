import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VehicleState } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { at } from '../survey/surveyFixture'

// map clicks go where the real map sends them: the survey drawing first, else "add a waypoint"
const POINTS = [at(-300, -300), at(-300, -200), at(-300, -100), at(0, 0), at(600, 0), at(600, 500)]
let clicks = 0
vi.mock('./MissionMap', () => ({
  MissionMap: (p: { onAdd: (lat: number, lon: number) => void; surveyDraw?: { ring: readonly unknown[]; onClick: (lat: number, lon: number) => void } | null }) => (
    <div data-testid="mission-map" data-drawing={p.surveyDraw ? p.surveyDraw.ring.length : -1}>
      <button
        type="button"
        onClick={() => {
          const pt = POINTS[clicks++ % POINTS.length]!
          if (p.surveyDraw) p.surveyDraw.onClick(pt.lat, pt.lon)
          else p.onAdd(pt.lat, pt.lon)
        }}
      >
        map-click
      </button>
    </div>
  ),
}))

const { MissionView } = await import('./MissionView')
const { MissionStore } = await import('./store')
const { BriefingStore } = await import('../briefing/store')
const { rasterStyle } = await import('../map/style')

const dict = t('ja')
const copter: VehicleState = {
  sysid: 1, name: 'UAV-01', kind: 'copter', mode: 'STABILIZE', armed: false, lat: 36.16, lon: 139.37, alt_rel: 0, alt_msl: 0, hdg: 0,
  ground_speed: 0, climb: 0, battery: { pct: 90, volt: 24, current: null }, link: 'ok', last_rx_ms: 0, gps: { fix: 3, sats: 12, hdop: 1 }, warn: false, unread: 0,
}
const envelope = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { 'content-type': 'application/json' } })

function setup() {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => envelope([])))
  const store = new MissionStore()
  render(<MissionView vehicles={new Map([[1, copter]])} dict={dict} style={rasterStyle('https://t/{z}/{x}/{y}.png', 'x')} store={store} briefing={new BriefingStore()} />)
  return store
}
const mapClick = (n: number) => {
  for (let i = 0; i < n; i++) fireEvent.click(screen.getByText('map-click'))
}
const view = () => screen.getByTestId('mission-view')
const openPalette = () => fireEvent.click(screen.getByRole('button', { name: new RegExp(dict.mInsertCmd) }))
const palette = () => screen.getByRole('dialog', { name: dict.mInsertCmd })
/** Takeoff + three waypoints, the first waypoint selected. */
function planWithSelection(store: InstanceType<typeof MissionStore>) {
  mapClick(3)
  const wp1 = store.getState().history.present.items[1]!
  fireEvent.click(document.querySelectorAll<HTMLElement>('.wrow')[1]!)
  return wp1.uid
}

describe('MissionView survey drawing', () => {
  beforeEach(() => {
    clicks = 0
  })
  afterEach(() => vi.unstubAllGlobals())

  it('palette サーベイ enters drawing; three clicks + Enter create a survey after the selected item', async () => {
    const store = setup()
    const after = planWithSelection(store)
    openPalette()
    fireEvent.click(within(palette()).getByRole('button', { name: /^サーベイ/ }))
    expect(screen.queryByRole('dialog', { name: dict.mInsertCmd })).toBeNull()
    expect(screen.getByTestId('survey-draw-hint').textContent).toContain(dict.svDrawHint)
    expect(screen.getByTestId('mission-map').dataset.drawing).toBe('0')
    mapClick(3)
    expect(store.getState().history.present.items).toHaveLength(4)
    await act(async () => {
      fireEvent.keyDown(view(), { key: 'Enter' })
    })
    const d = store.getState().history.present
    expect(d.surveys).toHaveLength(1)
    const s = d.surveys[0]!
    const i = d.items.findIndex((it) => it.uid === after)
    expect(d.items[i + 1]!.uid).toBe(s.uids[0])
    expect(s.spec.airframe).toBe('copter')
    expect([...store.getState().selected]).toEqual([s.uids[0]])
    expect(screen.queryByTestId('survey-draw-hint')).toBeNull()
    expect(screen.getByTestId('survey-panel')).toBeInTheDocument()
    expect(screen.getAllByTestId('survey-row')).toHaveLength(1)
  })

  it('Esc while drawing leaves the draft unchanged', () => {
    const store = setup()
    planWithSelection(store)
    const before = store.getState().history.present
    openPalette()
    fireEvent.click(within(palette()).getByRole('button', { name: /^サーベイ/ }))
    mapClick(3)
    fireEvent.keyDown(view(), { key: 'Escape' })
    expect(store.getState().history.present).toBe(before)
    expect(screen.queryByTestId('survey-draw-hint')).toBeNull()
    expect(screen.getByTestId('mission-map').dataset.drawing).toBe('-1')
  })

  it('palette KML opens the file picker; two polygons ask which one inline', async () => {
    const store = setup()
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    openPalette()
    fireEvent.click(within(palette()).getByRole('button', { name: /KML から読み込む/ }))
    expect(click).toHaveBeenCalled()
    click.mockRestore()
    const ring = (lat: number) => `139,${lat} 139.01,${lat} 139.01,${lat + 0.01} 139,${lat}`
    const mark = (name: string, lat: number) => `<Placemark><name>${name}</name><Polygon><outerBoundaryIs><LinearRing><coordinates>${ring(lat)}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`
    const text = `<kml xmlns="http://www.opengis.net/kml/2.2"><Document>${mark('North', 36.2)}${mark('South', 36.1)}</Document></kml>`
    await act(async () => {
      fireEvent.change(screen.getByTestId('survey-kml-file'), { target: { files: [new File([text], 'a.kml')] } })
    })
    fireEvent.click(within(screen.getByRole('list', { name: dict.svKmlChoose })).getByRole('button', { name: /South/ }))
    const d = store.getState().history.present
    expect(d.surveys.map((s) => s.spec.name)).toEqual(['South'])
  })
})
