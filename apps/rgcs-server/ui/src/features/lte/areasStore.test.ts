import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LteAreasStore } from './areasStore'
import { area } from './testArea'

describe('LTE areas store', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('loads_the_list_once_on_demand', async () => {
    const load = vi.fn(async () => [area()])
    const s = new LteAreasStore(load)
    s.subscribe(() => {})
    s.ensureLoaded()
    s.ensureLoaded()
    await vi.waitFor(() => expect(s.getState().loaded).toBe(true))
    expect(load).toHaveBeenCalledTimes(1)
    expect(s.getState().areas).toEqual([area()])
  })

  it('polls_every_second_while_an_area_is_fetching', async () => {
    const replies = [[area({ status: 'fetching' })], [area({ status: 'fetching' })], [area()]]
    const load = vi.fn(async () => replies.shift() ?? [area()])
    const s = new LteAreasStore(load)
    s.subscribe(() => {})
    await s.reload()
    expect(load).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(load).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1000)
    expect(load).toHaveBeenCalledTimes(3)
    expect(s.getState().areas[0]!.status).toBe('ready')
    await vi.advanceTimersByTimeAsync(5000)
    expect(load).toHaveBeenCalledTimes(3)
  })

  it('stops_polling_when_nobody_listens', async () => {
    const load = vi.fn(async () => [area({ status: 'fetching' })])
    const s = new LteAreasStore(load)
    const off = s.subscribe(() => {})
    await s.reload()
    off()
    await vi.advanceTimersByTimeAsync(3000)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('a_failed_load_keeps_the_last_list_and_flags_the_error', async () => {
    const load = vi.fn().mockResolvedValueOnce([area()]).mockRejectedValueOnce(new Error('down'))
    const s = new LteAreasStore(load)
    await s.reload()
    await s.reload()
    expect(s.getState()).toMatchObject({ areas: [area()], error: true, loaded: true })
  })
})
