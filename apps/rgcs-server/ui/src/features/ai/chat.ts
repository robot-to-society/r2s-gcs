// Pure state of the AI chat panel: the items shown, the conversation id and the in-flight flag.
// Append-only like the server conversation; only a proposal's state changes in place (as a new item).
import type { AiChatReply, AiProposal, AiStatusCard, AiToolRun } from '../../shared/api/types'

export type ProposalState = 'pending' | 'sending' | 'executed' | 'dismissed' | 'failed' | 'expired'

export type ChatItem =
  | { readonly kind: 'user'; readonly id: string; readonly text: string; readonly ts: number }
  | { readonly kind: 'bot'; readonly id: string; readonly text: string; readonly ts: number; readonly truncated: boolean }
  | { readonly kind: 'tool'; readonly id: string; readonly card: AiStatusCard | null; readonly runs: readonly AiToolRun[]; readonly ts: number }
  | { readonly kind: 'proposal'; readonly id: string; readonly proposal: AiProposal; readonly state: ProposalState; readonly error?: string }
  | { readonly kind: 'error'; readonly id: string; readonly code: string; readonly message: string; readonly ts: number; readonly retryAfterS?: number }

export interface ChatState {
  readonly conversationId: string | null
  readonly items: readonly ChatItem[]
  readonly pending: boolean
  /** The server refused the conversation as too long (`409 conversation_full`): offer 新しい会話. */
  readonly full: boolean
}

export const EMPTY_CHAT: ChatState = Object.freeze({ conversationId: null, items: Object.freeze([]), pending: false, full: false })

export type ChatAction =
  | { readonly t: 'send'; readonly text: string; readonly ts: number }
  | { readonly t: 'reply'; readonly reply: AiChatReply }
  | { readonly t: 'fail'; readonly code: string; readonly message: string; readonly ts: number; readonly retryAfterS?: number }
  | { readonly t: 'proposal'; readonly id: string; readonly state: ProposalState; readonly error?: string }
  | { readonly t: 'reset' }

function replyItems(r: AiChatReply, n: number): ChatItem[] {
  const bot: ChatItem = { kind: 'bot', id: `b${n}`, text: r.reply, ts: r.ts, truncated: r.truncated }
  const tool: ChatItem[] = r.tool_runs.length > 0 ? [{ kind: 'tool', id: `t${n + 1}`, card: r.status_card, runs: r.tool_runs, ts: r.ts }] : []
  const proposals: ChatItem[] = r.proposals.map((p) => ({ kind: 'proposal', id: p.id, proposal: p, state: 'pending' }))
  return [bot, ...tool, ...proposals]
}

function failItem(a: Extract<ChatAction, { t: 'fail' }>, n: number): ChatItem {
  const base = { kind: 'error' as const, id: `e${n}`, code: a.code, message: a.message, ts: a.ts }
  return a.retryAfterS === undefined ? base : { ...base, retryAfterS: a.retryAfterS }
}

function withProposal(items: readonly ChatItem[], a: Extract<ChatAction, { t: 'proposal' }>): ChatItem[] {
  return items.map((it) => {
    if (it.kind !== 'proposal' || it.id !== a.id) return it
    const { error: _old, ...rest } = it
    return a.error === undefined ? { ...rest, state: a.state } : { ...rest, state: a.state, error: a.error }
  })
}

export function chatReducer(s: ChatState, a: ChatAction): ChatState {
  const n = s.items.length
  switch (a.t) {
    case 'send':
      return { ...s, items: [...s.items, { kind: 'user', id: `u${n}`, text: a.text, ts: a.ts }], pending: true }
    case 'reply':
      return { ...s, conversationId: a.reply.conversation_id, items: [...s.items, ...replyItems(a.reply, n)], pending: false, full: false }
    case 'fail':
      return { ...s, items: [...s.items, failItem(a, n)], pending: false, full: s.full || a.code === 'conversation_full' }
    case 'proposal':
      return { ...s, items: withProposal(s.items, a) }
    case 'reset':
      return EMPTY_CHAT
  }
}
