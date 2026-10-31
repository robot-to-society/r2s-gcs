import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLteArea, deleteLteArea, estimateLteArea, listLteAreas, refreshLteArea } from './api'

const envelope = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { 'content-type': 'application/json' } })

describe('LTE api', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses_the_documented_paths_methods_and_bodies', async () => {
    const f = vi.fn<typeof fetch>(async () => envelope({ tiles: 12 }))
    vi.stubGlobal('fetch', f)
    const rect = { south: 33.6, west: 135.8, north: 33.7, east: 135.9 }
    await listLteAreas()
    expect(await estimateLteArea(rect)).toBe(12)
    await createLteArea({ name: 'Nachi', ...rect })
    await refreshLteArea(3)
    await deleteLteArea(3)
    const calls = f.mock.calls.map(([url, init]) => [String(url), init?.method ?? 'GET', typeof init?.body === 'string' ? JSON.parse(init.body) : undefined])
    expect(calls).toEqual([
      ['/api/lte/areas', 'GET', undefined],
      ['/api/lte/areas/estimate', 'POST', rect],
      ['/api/lte/areas', 'POST', { name: 'Nachi', ...rect }],
      ['/api/lte/areas/3/refresh', 'POST', undefined],
      ['/api/lte/areas/3', 'DELETE', undefined],
    ])
  })

  it('reports_the_server_error_code', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: false, error: { code: 'too_many_tiles', message: 'x' } }), { status: 400 })))
    await expect(createLteArea({ name: 'a', south: 0, west: 0, north: 1, east: 1 })).rejects.toMatchObject({ code: 'too_many_tiles' })
  })
})
