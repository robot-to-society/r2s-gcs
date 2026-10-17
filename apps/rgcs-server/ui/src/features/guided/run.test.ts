import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../shared/api/client'
import { runGuided } from './run'

const body = { lat: 36, lon: 139, alt_mode: 'keep' as const }

describe('runGuided', () => {
  it('sends and reports the id and warning', async () => {
    const send = vi.fn().mockResolvedValue({ id: 4, warning: null })
    expect(await runGuided(1, body, undefined, send)).toEqual({ kind: 'sent', id: 4, warning: null })
    expect(send).toHaveBeenCalledWith(1, { ...body, confirm_token: undefined })
  })

  it('maps mode_required, confirm_required, fence_alt and other errors', async () => {
    const errs = [
      new ApiError(409, 'mode_required', 'switch to GUIDED first'),
      new ApiError(409, 'confirm_required', 'confirm token required'),
      new ApiError(409, 'fence_alt', 'above FENCE_ALT_MAX'),
      new ApiError(503, 'link_lost', 'no heartbeat'),
    ]
    const send = vi.fn()
    for (const e of errs) send.mockRejectedValueOnce(e)
    expect(await runGuided(1, body, undefined, send)).toEqual({ kind: 'mode_required' })
    expect(await runGuided(1, body, undefined, send)).toEqual({ kind: 'needs_confirm', message: 'confirm token required' })
    expect(await runGuided(1, body, undefined, send)).toEqual({ kind: 'error', code: 'fence_alt', message: 'above FENCE_ALT_MAX' })
    expect(await runGuided(1, body, undefined, send)).toEqual({ kind: 'error', code: 'link_lost', message: 'no heartbeat' })
  })
})
