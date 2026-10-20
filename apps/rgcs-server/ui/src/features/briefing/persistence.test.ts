import { describe, expect, it, vi } from 'vitest'
import type { Briefing, BriefingFull, Mission } from '../../shared/api/types'
import { appendWaypoint, emptyDraft, toMission } from '../mission/model'
import { INITIAL_MISSION_UI, MissionStore, edit, loaded } from '../mission/store'
import { activeRow, addRow, assign, emptyWorkspace, type Workspace } from './model'
import { commitSaved, saveWorkspace, validName, workspaceFrom } from './persistence'
import { BriefingStore, replaceWorkspace } from './store'

const mission = (name: string, id: number | null = null): Mission => ({ ...toMission(appendWaypoint(emptyDraft(), 36, 139)), name, id })
const nameOf = (m: Mission) => m.name

/** Alpha (saved #1, clean), Beta (from a file, never saved), Gamma (saved #3, dirty, active), Lost (missing). */
function fourRows(): Workspace {
  const base = emptyWorkspace()
  const alpha: Workspace = { ...base, name: 'Morning', rows: base.rows.map((r) => ({ ...r, ui: loaded(INITIAL_MISSION_UI, mission('Alpha', 1), 1) })) }
  const beta = addRow(alpha, loaded(INITIAL_MISSION_UI, mission('Beta'), null))
  const gamma = addRow(beta, loaded(INITIAL_MISSION_UI, mission('Gamma', 3), 3))
  const lost = addRow(gamma, loaded(INITIAL_MISSION_UI, mission('Lost'), null))
  const withLost: Workspace = { ...lost, rows: lost.rows.map((r, i) => (i === 3 ? { ...r, missing: true } : r)), active: gamma.active }
  return assign(withLost, gamma.active, 2)
}

function fakeDeps() {
  const calls: string[] = []
  let next = 10
  const deps = {
    create: vi.fn(async (m: Mission) => {
      calls.push(`create ${m.name}`)
      return { ...m, id: next++ }
    }),
    update: vi.fn(async (id: number, m: Mission) => {
      calls.push(`update ${id} ${m.name}`)
      return { ...m, id }
    }),
    createB: vi.fn(async (b: Briefing) => {
      calls.push('createB')
      return { ...b, id: 5 }
    }),
    updateB: vi.fn(async (id: number, b: Briefing) => {
      calls.push(`updateB ${id}`)
      return { ...b, id }
    }),
  }
  return { deps, calls }
}

describe('briefing persistence', () => {
  it('save_writes_new_and_dirty_missions_first_then_the_briefing_with_their_ids', async () => {
    const ws = fourRows()
    const live = edit(activeRow(ws).ui, appendWaypoint(activeRow(ws).ui.history.present, 35, 139))
    const { deps, calls } = fakeDeps()
    const saved = await saveWorkspace(ws, live, deps)
    expect(calls).toEqual(['create Beta', 'update 3 Gamma', 'createB'])
    expect(deps.update.mock.calls[0]![1].items).toHaveLength(2)
    const sent = deps.createB.mock.calls[0]![0]
    expect(sent).toEqual({
      id: null,
      name: 'Morning',
      active_mission_id: 3,
      rows: [
        { mission_id: 1, color: ws.rows[0]!.color, sysid: null },
        { mission_id: 10, color: ws.rows[1]!.color, sysid: null },
        { mission_id: 3, color: ws.rows[2]!.color, sysid: 2 },
      ],
    })
    expect(saved.id).toBe(5)
    expect(saved.rows.map((r) => r.ui.savedId)).toEqual([1, 10, 3, null])
    expect(saved.rows.map((r) => r.ui.dirty)).toEqual([false, false, false, false])
    expect(saved.rows[3]!.missing).toBe(true)
    expect(activeRow(saved).ui.history.present.items).toHaveLength(2)
    expect(deps.create.mock.calls.map(([m]) => nameOf(m))).toEqual(['Beta'])
  })

  it('saving_twice_updates_instead_of_creating', async () => {
    const ws = fourRows()
    const { deps, calls } = fakeDeps()
    const first = await saveWorkspace(ws, activeRow(ws).ui, deps)
    calls.length = 0
    const second = await saveWorkspace({ ...first, name: 'Evening' }, activeRow(first).ui, deps)
    expect(calls).toEqual(['updateB 5'])
    expect(deps.updateB.mock.calls[0]![1].name).toBe('Evening')
    expect(second.id).toBe(5)
  })

  it('workspace_from_marks_deleted_missions_missing_and_restores_the_active_row', () => {
    const full: BriefingFull = {
      briefing: {
        id: 7,
        name: 'Survey day',
        active_mission_id: 3,
        rows: [
          { mission_id: 1, color: '#5fd39b', sysid: 1 },
          { mission_id: 2, color: '#f2b544', sysid: 2 },
          { mission_id: 3, color: '#9cc9ff', sysid: null },
        ],
      },
      missions: [mission('Alpha', 1), null, mission('Gamma', 3)],
    }
    const ws = workspaceFrom(full)
    expect(ws.id).toBe(7)
    expect(ws.name).toBe('Survey day')
    expect(ws.rows.map((r) => r.missing)).toEqual([false, true, false])
    expect(ws.rows.map((r) => r.color)).toEqual(['#5fd39b', '#f2b544', '#9cc9ff'])
    expect(ws.rows.map((r) => r.sysid)).toEqual([1, 2, null])
    expect(ws.rows.map((r) => r.hidden)).toEqual([false, false, false])
    expect(ws.rows.map((r) => r.ui.dirty)).toEqual([false, false, false])
    expect(ws.rows[1]!.ui.history.present.items).toHaveLength(0)
    expect(ws.rows[0]!.ui.savedId).toBe(1)
    expect(new Set(ws.rows.map((r) => r.key)).size).toBe(3)
    expect(activeRow(ws).ui.history.present.mission.name).toBe('Gamma')
    const gone = workspaceFrom({ ...full, briefing: { ...full.briefing, active_mission_id: 2 } })
    expect(gone.active).toBe(gone.rows[0]!.key)
  })

  it('a_finished_save_shows_saved_ids_in_the_list_and_the_editor', async () => {
    const b = new BriefingStore()
    const m = new MissionStore()
    replaceWorkspace(b, m, fourRows())
    m.update((u) => edit(u, appendWaypoint(u.history.present, 35, 139)))
    const sent = m.getState()
    const out = await saveWorkspace(b.getState(), sent, fakeDeps().deps)
    b.update((w) => ({ ...w, rows: w.rows.map((r, i) => (i === 0 ? { ...r, color: '#c6d36b' } : r)) }))
    commitSaved(b, m, sent, out)
    expect(b.getState().id).toBe(5)
    expect(b.getState().rows.map((r) => r.ui.savedId)).toEqual([1, 10, 3, null])
    expect(b.getState().rows[0]!.color).toBe('#c6d36b')
    expect(m.getState().savedId).toBe(3)
    expect(m.getState().dirty).toBe(false)
    expect(m.getState().history.present.items).toHaveLength(2)
  })

  it('an_untouched_new_row_is_not_saved_and_names_are_1_to_80_characters', async () => {
    const ws = emptyWorkspace()
    const { deps } = fakeDeps()
    await saveWorkspace({ ...ws, name: 'x' }, activeRow(ws).ui, deps)
    expect(deps.create).not.toHaveBeenCalled()
    expect(deps.createB.mock.calls[0]![0].rows).toEqual([])
    expect([validName(''), validName('  '), validName('a'), validName('あ'.repeat(80)), validName('a'.repeat(81))]).toEqual([false, false, true, true, false])
  })
})
