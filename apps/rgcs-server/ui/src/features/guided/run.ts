import { ApiError } from '../../shared/api/client'
import { sendGuided, type GuidedBody, type GuidedReply } from './api'

export type GuidedOutcome =
  | { readonly kind: 'sent'; readonly id: number; readonly warning: string | null }
  | { readonly kind: 'mode_required' }
  | { readonly kind: 'needs_confirm'; readonly message?: string }
  | { readonly kind: 'error'; readonly code: string; readonly message: string }

export type SendGuidedFn = (sysid: number, body: GuidedBody) => Promise<GuidedReply>

/** Sends a Guided target and classifies the server's answer for the modal. */
export async function runGuided(sysid: number, body: GuidedBody, token?: string, send: SendGuidedFn = sendGuided): Promise<GuidedOutcome> {
  try {
    const { id, warning } = await send(sysid, { ...body, confirm_token: token })
    return { kind: 'sent', id, warning }
  } catch (e) {
    if (e instanceof ApiError && e.code === 'mode_required') return { kind: 'mode_required' }
    if (e instanceof ApiError && e.code === 'confirm_required') return { kind: 'needs_confirm', message: e.message }
    if (e instanceof ApiError) return { kind: 'error', code: e.code, message: e.message }
    return { kind: 'error', code: 'unknown', message: e instanceof Error ? e.message : String(e) }
  }
}
