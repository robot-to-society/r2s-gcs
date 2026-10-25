// Shared test data for the AI chat modules (not imported by production code).
import type { AiChatReply, AiProposal } from '../../shared/api/types'

export function proposal(over: Partial<AiProposal> = {}): AiProposal {
  return {
    id: 'p-1',
    sysid: 3,
    vehicle_name: 'UAV-03',
    command: { cmd: 'set_mode', args: { mode: 'LOITER' } },
    reason: 'hold position',
    requires_confirm: false,
    created_ms: 1_000,
    expires_ms: 121_000,
    ...over,
  }
}

export function reply(over: Partial<AiChatReply> = {}): AiChatReply {
  return {
    conversation_id: 'c-1',
    reply: 'UAV-03 is flying',
    tool_runs: [],
    status_card: null,
    proposals: [],
    truncated: false,
    ts: 2_000,
    ...over,
  }
}
