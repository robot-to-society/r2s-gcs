// Saving the open missions as a named briefing and opening a saved one, wired for MissionView:
// the list header's handlers, the picker sheet and the discard question (spec 2026-10-20 §5.1).
// Results go to the footer pills like the planner's other saves.
import { useState, type ReactNode } from 'react'
import type { BriefingFull, BriefingSummary, CommandResult } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { createMission, updateMission } from '../mission/api'
import { localResultId } from '../vehicles/localResultId'
import { setBusy, type MissionStore } from '../mission/store'
import { vehicleStore } from '../vehicles/store'
import { createBriefing, getBriefing, listBriefings, updateBriefing } from './api'
import { BriefingPicker, DiscardSheet } from './BriefingPicker'
import type { BriefingHeader } from './BriefingList'
import { parkActive, type Workspace } from './model'
import { BriefingSaveError, commitSaved, hasMissions, saveWorkspace, validName, workspaceFrom, type SaveDeps } from './persistence'
import { replaceWorkspace, type BriefingStore } from './store'
import { isPristine } from './useBriefing'

export interface BriefingApi extends SaveDeps {
  readonly list: () => Promise<BriefingSummary[]>
  readonly get: (id: number) => Promise<BriefingFull>
}

const API: BriefingApi = { create: createMission, update: updateMission, createB: createBriefing, updateB: updateBriefing, list: listBriefings, get: getBriefing }

interface Options {
  readonly api?: BriefingApi
  readonly vehicles?: { readonly pushLocalResult: (r: CommandResult) => void }
  /** Frames the opened briefing's waypoints on the map. */
  readonly onFit: (points: readonly { lat: number; lon: number }[]) => void
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** Something opening a briefing would lose: a changed mission, or one never saved. */
const hasUnsaved = (ws: Workspace): boolean => ws.rows.some((r) => r.ui.dirty || (r.ui.savedId === null && !isPristine(r.ui)))

const pointsOf = (ws: Workspace) => ws.rows.flatMap((r) => r.ui.history.present.items.filter((it) => it.lat !== 0 || it.lon !== 0).map((it) => ({ lat: it.lat, lon: it.lon })))

type Report = (cmd: string, ok: boolean, reason: string | null) => void

/** Saves the missions and the briefing with the editor marked busy (so its row cannot switch meanwhile). */
async function saveBriefing(b: BriefingStore, m: MissionStore, api: BriefingApi, report: Report, nothing: string): Promise<void> {
  const sent = m.getState()
  if (sent.busy !== 'idle' || !validName(b.getState().name)) return
  if (!hasMissions(parkActive(b.getState(), sent))) return report('briefing_save', false, nothing)
  m.update((u) => setBusy(u, 'saving'))
  try {
    const out = await saveWorkspace(b.getState(), sent, api)
    commitSaved(b, m, sent, out)
    report('briefing_save', true, out.name.trim())
  } catch (e) {
    if (e instanceof BriefingSaveError) commitSaved(b, m, sent, e.workspace)
    report('briefing_save', false, errText(e))
  } finally {
    m.update((u) => setBusy(u, 'idle'))
  }
}

async function openBriefing(b: BriefingStore, m: MissionStore, api: BriefingApi, id: number, report: Report, onFit: Options['onFit']): Promise<void> {
  try {
    const next = workspaceFrom(await api.get(id))
    replaceWorkspace(b, m, next)
    onFit(pointsOf(next))
  } catch (e) {
    report('briefing_open', false, errText(e))
  }
}

/** `ws`: the workspace with the live editor parked in its active row (useBriefing's list.workspace). */
export function useBriefingIo(b: BriefingStore, m: MissionStore, ws: Workspace, dict: Dict, { api = API, vehicles = vehicleStore, onFit }: Options): { header: BriefingHeader; sheet: ReactNode } {
  const [picker, setPicker] = useState(false)
  const [pending, setPending] = useState<number | null>(null)
  const [working, setWorking] = useState(false)
  const result: Report = (cmd, ok, reason) => vehicles.pushLocalResult({ id: localResultId(), sysid: 0, cmd, ok, reason, ts: Date.now() })
  const idle = !working && m.getState().busy === 'idle'

  const save = async () => {
    setWorking(true)
    await saveBriefing(b, m, api, result, dict.bfNothing).finally(() => setWorking(false))
  }
  const open = async (id: number) => {
    setPending(null)
    setWorking(true)
    await openBriefing(b, m, api, id, result, onFit).finally(() => setWorking(false))
  }

  const pick = (id: number) => {
    setPicker(false)
    if (hasUnsaved(ws)) setPending(id)
    else void open(id)
  }

  const header: BriefingHeader = {
    name: ws.name,
    canSave: idle && validName(ws.name) && hasMissions(ws),
    saveHint: hasMissions(ws) ? dict.bfNameHint : dict.bfNothing,
    busy: !idle,
    onName: (name) => b.update((w) => ({ ...w, name })),
    onSave: () => void save(),
    onOpen: () => setPicker(true),
  }
  const sheet = (
    <>
      {picker && <BriefingPicker dict={dict} load={api.list} onPick={pick} onClose={() => setPicker(false)} />}
      {pending !== null && <DiscardSheet dict={dict} onCancel={() => setPending(null)} onContinue={() => void open(pending)} />}
    </>
  )
  return { header, sheet }
}
