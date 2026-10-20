// The write target with several missions open (spec 2026-10-20 §8): exactly the active row's
// assignment; the right panel's vehicle select assigns the row only. A single mission keeps the
// fallbacks of today (the mission's own vehicle, then the first connected one).
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VehicleState } from '../../shared/api/types'
import { t } from '../../shared/i18n'

vi.mock('./MissionMap', () => ({ MissionMap: () => <div data-testid="mission-map" /> }))

const { MissionView } = await import('./MissionView')
const { MissionStore } = await import('./store')
const { BriefingStore } = await import('../briefing/store')
const { appendWaypoint, emptyDraft, toMission } = await import('./model')
const { serializeRgcsMission } = await import('./files')
const { rasterStyle } = await import('../map/style')

const copter = (sysid: number): VehicleState => ({
  sysid, name: `UAV-0${sysid}`, kind: 'copter', mode: 'STABILIZE', armed: false, lat: 36.16, lon: 139.37, alt_rel: 0, alt_msl: 0, hdg: 0,
  ground_speed: 0, climb: 0, battery: { pct: 90, volt: 24, current: null }, link: 'ok', last_rx_ms: 0, gps: { fix: 3, sats: 12, hdop: 1 }, warn: false, unread: 0,
})
const style = rasterStyle('https://t/{z}/{x}/{y}.png', 'x')
const envelope = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { 'content-type': 'application/json' } })

function setup() {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => envelope([])))
  const store = new MissionStore()
  const briefing = new BriefingStore()
  render(<MissionView vehicles={new Map([[1, copter(1)], [2, copter(2)]])} dict={t('ja')} style={style} store={store} briefing={briefing} />)
  return { store, briefing }
}

function missionFile(name: string, lat0: number): File {
  const draft = appendWaypoint(appendWaypoint(emptyDraft(), lat0, 139), lat0 + 0.01, 139)
  return new File([serializeRgcsMission({ ...toMission(draft), name })], `${name}.rgcsmission`)
}
const pick = async (files: File[]) => {
  await act(async () => {
    fireEvent.change(screen.getByTestId('mission-file'), { target: { files } })
  })
}
const briefRows = () => [...document.querySelectorAll<HTMLElement>('.brief-row')]
const editor = () => within(screen.getByRole('complementary', { name: 'editor' }))
const panelSelect = () => editor().getByLabelText('対象機体') as HTMLSelectElement
const writeButton = () => editor().getByRole('button', { name: '機体に書き込む' })

describe('MissionView write target (§8)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('an_unassigned_row_never_falls_back_to_another_rows_vehicle', async () => {
    const { store, briefing } = setup()
    await pick([missionFile('Alpha', 36), missionFile('Beta', 35)])
    fireEvent.click(briefRows()[0]!.querySelector('.brief-name')!)
    expect(store.getState().history.present.mission.name).toBe('Alpha')
    // A gets UAV-02 from the right panel: the row is assigned, the mission's own vehicle is not written
    fireEvent.change(panelSelect(), { target: { value: '2' } })
    expect(briefing.getState().rows[0]!.sysid).toBe(2)
    expect(store.getState().history.present.mission.sysid).toBeNull()
    // UAV-02 moves to B in the list: A is unassigned
    fireEvent.change(within(briefRows()[1]!).getByLabelText('割当機体'), { target: { value: '2' } })
    expect(briefing.getState().rows[0]!.sysid).toBeNull()
    expect(panelSelect().value).toBe('')
    expect(panelSelect().selectedOptions[0]!.textContent).toBe('未割当')
    expect(writeButton()).toBeDisabled()
    expect(editor().getByText('一覧で機体を割り当てると書き込めます')).toBeInTheDocument()
  })

  it('a_single_mission_defaults_to_the_first_vehicle_and_keeps_its_own', async () => {
    const { store, briefing } = setup()
    await pick([missionFile('Alpha', 36)])
    expect(briefRows()).toHaveLength(1)
    expect(panelSelect().value).toBe('1')
    expect(writeButton()).toBeEnabled()
    expect(editor().queryByText('一覧で機体を割り当てると書き込めます')).not.toBeInTheDocument()
    fireEvent.change(panelSelect(), { target: { value: '2' } })
    expect(briefing.getState().rows[0]!.sysid).toBe(2)
    expect(store.getState().history.present.mission.sysid).toBe(2)
  })
})
