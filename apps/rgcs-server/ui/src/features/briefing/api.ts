// REST calls for briefings (the planner's saved set of missions, spec 2026-10-20 §5.1).
import { apiFetch } from '../../shared/api/client'
import type { Briefing, BriefingFull, BriefingSummary } from '../../shared/api/types'

export const listBriefings = (): Promise<BriefingSummary[]> => apiFetch('/api/briefings')
export const getBriefing = (id: number): Promise<BriefingFull> => apiFetch(`/api/briefings/${id}`)
export const createBriefing = (b: Briefing): Promise<Briefing> => apiFetch('/api/briefings', { method: 'POST', body: b })
export const updateBriefing = (id: number, b: Briefing): Promise<Briefing> => apiFetch(`/api/briefings/${id}`, { method: 'PUT', body: b })
export const deleteBriefing = (id: number): Promise<{ deleted: boolean }> => apiFetch(`/api/briefings/${id}`, { method: 'DELETE' })
