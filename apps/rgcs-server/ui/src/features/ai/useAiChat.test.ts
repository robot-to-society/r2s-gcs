import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../shared/api/client'
import { proposal, reply } from './fixtures'

const api = { getAiStatus: vi.fn(), postChat: vi.fn(), dismissProposal: vi.fn() }
vi.mock('./api', () => ({
  getAiStatus: () => api.getAiStatus(),
  postChat: (b: unknown) => api.postChat(b),
  dismissProposal: (id: string) => api.dismissProposal(id),
}))

const { useAiChat } = await import('./useAiChat')

const STATUS = { configured: true, provider: 'anthropic', model: 'claude-sonnet-5-5', reason: null, budget_left: null }

describe('useAiChat', () => {
  beforeEach(() => {
    for (const f of Object.values(api)) f.mockReset()
    api.getAiStatus.mockResolvedValue(STATUS)
  })

  it('fetches the status once on mount', async () => {
    const { result, rerender } = renderHook(() => useAiChat())
    await waitFor(() => expect(result.current.status).toEqual(STATUS))
    rerender()
    expect(api.getAiStatus).toHaveBeenCalledTimes(1)
  })

  it('send posts the message, then continues the conversation it got back', async () => {
    api.postChat.mockResolvedValue(reply())
    const { result } = renderHook(() => useAiChat())
    act(() => result.current.send(3, 'status?'))
    expect(result.current.state.pending).toBe(true)
    await waitFor(() => expect(result.current.state.pending).toBe(false))
    expect(api.postChat).toHaveBeenLastCalledWith({ sysid: 3, message: 'status?', conversation_id: null })
    act(() => result.current.send(3, 'and now?'))
    await waitFor(() => expect(api.postChat).toHaveBeenCalledTimes(2))
    expect(api.postChat).toHaveBeenLastCalledWith({ sysid: 3, message: 'and now?', conversation_id: 'c-1' })
  })

  it('a lost conversation is retried once as a new one', async () => {
    api.postChat.mockResolvedValueOnce(reply())
    const { result } = renderHook(() => useAiChat())
    act(() => result.current.send(3, 'one'))
    await waitFor(() => expect(result.current.state.conversationId).toBe('c-1'))
    api.postChat.mockRejectedValueOnce(new ApiError(404, 'conversation_not_found', 'gone')).mockResolvedValueOnce(reply({ conversation_id: 'c-2' }))
    act(() => result.current.send(3, 'two'))
    await waitFor(() => expect(result.current.state.conversationId).toBe('c-2'))
    expect(api.postChat.mock.calls.map((c) => (c[0] as { conversation_id: string | null }).conversation_id)).toEqual([null, 'c-1', null])
    expect(result.current.state.items.filter((i) => i.kind === 'user')).toHaveLength(2)
  })

  it('a failure becomes an error item with the rate-limit delay', async () => {
    api.postChat.mockRejectedValue(new ApiError(429, 'rate_limited', 'slow', { retryAfterS: 9 }))
    const { result } = renderHook(() => useAiChat())
    act(() => result.current.send(3, 'x'))
    await waitFor(() => expect(result.current.state.pending).toBe(false))
    expect(result.current.state.items[1]).toMatchObject({ kind: 'error', code: 'rate_limited', retryAfterS: 9 })
  })

  it('ignores a send while one is in flight and blank text', async () => {
    api.postChat.mockReturnValue(new Promise(() => {}))
    const { result } = renderHook(() => useAiChat())
    act(() => result.current.send(3, '   '))
    expect(api.postChat).not.toHaveBeenCalled()
    act(() => result.current.send(3, 'a'))
    act(() => result.current.send(3, 'b'))
    expect(api.postChat).toHaveBeenCalledTimes(1)
  })

  it('dismiss marks the proposal dismissed, or expired when the server says so', async () => {
    api.postChat.mockResolvedValue(reply({ proposals: [proposal(), proposal({ id: 'p-2' })] }))
    const { result } = renderHook(() => useAiChat())
    act(() => result.current.send(3, 'x'))
    await waitFor(() => expect(result.current.state.items).toHaveLength(4))
    api.dismissProposal.mockResolvedValueOnce({ id: 'p-1', status: 'dismissed' }).mockRejectedValueOnce(new ApiError(409, 'proposal_expired', 'late'))
    act(() => result.current.dismiss('p-1'))
    act(() => result.current.dismiss('p-2'))
    await waitFor(() => expect(result.current.state.items[2]).toMatchObject({ state: 'dismissed' }))
    await waitFor(() => expect(result.current.state.items[3]).toMatchObject({ state: 'expired' }))
  })

  it('setProposal and reset update the state', async () => {
    api.postChat.mockResolvedValue(reply({ proposals: [proposal()] }))
    const { result } = renderHook(() => useAiChat())
    act(() => result.current.send(3, 'x'))
    await waitFor(() => expect(result.current.state.items).toHaveLength(3))
    act(() => result.current.setProposal('p-1', 'failed', 'link lost'))
    expect(result.current.state.items[2]).toMatchObject({ state: 'failed', error: 'link lost' })
    act(() => result.current.reset())
    expect(result.current.state.items).toEqual([])
    expect(result.current.state.conversationId).toBeNull()
  })
})
