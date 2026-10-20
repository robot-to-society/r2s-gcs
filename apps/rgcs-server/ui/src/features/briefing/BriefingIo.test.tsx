import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Briefing, BriefingFull, Mission } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { appendWaypoint, emptyDraft, toMission } from '../mission/model'
import { INITIAL_MISSION_UI, MissionStore, edit, loaded, useMissionUi } from '../mission/store'
import { BriefingList } from './BriefingList'
import { useBriefingIo, type BriefingApi } from './BriefingIo'
import { BriefingStore, replaceWorkspace } from './store'
import { useBriefing } from './useBriefing'
import { emptyWorkspace } from './model'

const dict = t('ja')
const mission = (name: string, id: number | null = null): Mission => ({ ...toMission(appendWaypoint(emptyDraft(), 36, 139)), name, id })
const full: BriefingFull = {
  briefing: { id: 9, name: 'Survey day', active_mission_id: 2, rows: [{ mission_id: 1, color: '#5fd39b', sysid: null }, { mission_id: 2, color: '#f2b544', sysid: null }] },
  missions: [mission('Alpha', 1), mission('Beta', 2)],
}

function fakeApi() {
  return {
    create: vi.fn(async (m: Mission) => ({ ...m, id: 40 })),
    update: vi.fn(async (id: number, m: Mission) => ({ ...m, id })),
    createB: vi.fn(async (b: Briefing) => ({ ...b, id: 9 })),
    updateB: vi.fn(async (id: number, b: Briefing) => ({ ...b, id })),
    list: vi.fn(async () => [{ id: 9, name: 'Survey day', mission_count: 2, updated_at: 1 }]),
    get: vi.fn(async (_id: number) => full),
  } satisfies BriefingApi
}

function Harness({ b, m, api, push }: { b: BriefingStore; m: MissionStore; api: BriefingApi; push: (r: unknown) => void }) {
  const ui = useMissionUi(m)
  const brief = useBriefing(b, m, ui)
  const io = useBriefingIo(b, m, brief.list.workspace, dict, { api, vehicles: { pushLocalResult: push }, onFit: () => undefined })
  return (
    <>
      <BriefingList {...brief.list} liveDirty={ui.dirty} vehicles={[]} dict={dict} header={io.header} />
      {io.sheet}
    </>
  )
}

function setup(dirty: boolean) {
  const b = new BriefingStore()
  const m = new MissionStore()
  const base = emptyWorkspace()
  replaceWorkspace(b, m, { ...base, rows: base.rows.map((r) => ({ ...r, ui: loaded(INITIAL_MISSION_UI, mission('Draft', 5), 5) })) })
  if (dirty) m.update((u) => edit(u, appendWaypoint(u.history.present, 35, 139)))

  const api = fakeApi()
  const push = vi.fn()
  render(<Harness b={b} m={m} api={api} push={push} />)
  return { b, m, api, push }
}

const openFromPicker = async () => {
  fireEvent.click(screen.getByRole('button', { name: dict.bfOpen }))
  fireEvent.click(await screen.findByText('Survey day'))
}

describe('useBriefingIo', () => {
  it('opening_with_unsaved_changes_asks_first_then_replaces_the_workspace', async () => {
    const { b, m, api } = setup(true)
    await openFromPicker()
    expect(screen.getByRole('alertdialog')).toHaveTextContent(dict.mDiscard)
    expect(api.get).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: dict.mContinue }))
    await waitFor(() => expect(b.getState().id).toBe(9))
    expect(b.getState().rows.map((r) => r.ui.history.present.mission.name)).toEqual(['Alpha', 'Beta'])
    expect(m.getState().savedId).toBe(2)
    expect(screen.getByRole('textbox', { name: dict.bfName })).toHaveValue('Survey day')
  })

  it('cancelling_the_question_keeps_the_workspace', async () => {
    const { b, api } = setup(true)
    await openFromPicker()

    fireEvent.click(screen.getByRole('button', { name: dict.cancel }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(api.get).not.toHaveBeenCalled()
    expect(b.getState().id).toBeNull()
  })

  it('a_clean_workspace_opens_without_asking', async () => {
    const { b } = setup(false)
    await openFromPicker()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    await waitFor(() => expect(b.getState().id).toBe(9))
  })

  it('saving_needs_a_name_and_marks_the_editor_saved', async () => {
    const { b, m, api, push } = setup(true)
    expect(screen.getByRole('button', { name: dict.bfSave })).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox', { name: dict.bfName }), { target: { value: 'Morning' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: dict.bfSave }))
    })
    await waitFor(() => expect(b.getState().id).toBe(9))
    expect(api.update).toHaveBeenCalledWith(5, expect.objectContaining({ name: 'Draft' }))
    expect(m.getState().dirty).toBe(false)
    expect(m.getState().busy).toBe('idle')
    expect(push).toHaveBeenCalledWith(expect.objectContaining({ cmd: 'briefing_save', ok: true }))
  })

  it('a_failed_open_is_reported_in_the_footer', async () => {
    const { b, api, push } = setup(false)
    api.get.mockRejectedValueOnce(new Error('gone'))
    await openFromPicker()
    await waitFor(() => expect(push).toHaveBeenCalledWith(expect.objectContaining({ cmd: 'briefing_open', ok: false, reason: 'gone' })))
    expect(b.getState().id).toBeNull()
  })

  it('a_changed_missing_row_also_asks_before_opening', async () => {
    const b = new BriefingStore()
    const m = new MissionStore()
    const base = emptyWorkspace()
    replaceWorkspace(b, m, { ...base, rows: base.rows.map((r) => ({ ...r, missing: true, ui: loaded(INITIAL_MISSION_UI, { ...mission('#4'), items: [] }, null) })) })
    m.update((u) => edit(u, appendWaypoint(u.history.present, 35, 139)))
    const api = fakeApi()
    render(<Harness b={b} m={m} api={api} push={vi.fn()} />)
    await openFromPicker()
    expect(screen.getByRole('alertdialog')).toHaveTextContent(dict.mDiscard)
    expect(api.get).not.toHaveBeenCalled()
  })

  it('nothing_to_save_disables_the_save_button', () => {
    const b = new BriefingStore()
    const m = new MissionStore()
    replaceWorkspace(b, m, { ...emptyWorkspace(), name: 'Morning' })
    const api = fakeApi()
    render(<Harness b={b} m={m} api={api} push={vi.fn()} />)
    const save = screen.getByRole('button', { name: dict.bfSave })
    expect(save).toBeDisabled()
    expect(save).toHaveAttribute('title', dict.bfNothing)
    fireEvent.click(save)
    expect(api.createB).not.toHaveBeenCalled()
  })
})
