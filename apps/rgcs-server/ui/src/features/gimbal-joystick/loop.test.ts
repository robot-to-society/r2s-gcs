import { describe, expect, it, vi } from 'vitest'
import type { ClientMessage } from '../../shared/api/types'
import { GimbalLoop } from './loop'
import { DEFAULT_PROFILE } from './profile'

function harness() {
  const sent: ClientMessage[] = []
  let now = 0
  let pad: { axes: readonly number[]; buttons: readonly boolean[] } | null = { axes: [0, 0], buttons: [false, false] }
  const onButton = vi.fn()
  const loop = new GimbalLoop({ send: (m) => (sent.push(m), true), onButton, readGamepad: () => pad, now: () => now })
  return { sent, onButton, loop, setPad: (p: typeof pad) => (pad = p), advance: (ms: number) => (now += ms) }
}

const rates = (sent: ClientMessage[]) => sent.filter((m) => m.t === 'gimbal_rate').map((m) => (m.t === 'gimbal_rate' ? [m.sysid, m.yaw, m.pitch] : []))

describe('GimbalLoop', () => {
  it('sends non-zero rates at 20 Hz and a single zero afterwards', () => {
    const h = h0()
    h.loop.start(DEFAULT_PROFILE, 1)
    h.setPad({ axes: [0.5, 0], buttons: [] })
    h.loop.tick()
    h.advance(50)
    h.loop.tick()
    expect(rates(h.sent)).toEqual([[1, 14, 0], [1, 14, 0]])
    h.setPad({ axes: [0, 0], buttons: [] })
    h.advance(50)
    h.loop.tick()
    h.advance(50)
    h.loop.tick()
    expect(rates(h.sent)).toEqual([[1, 14, 0], [1, 14, 0], [1, 0, 0]])
    const seqs = h.sent.filter((m) => m.t === 'gimbal_rate').map((m) => (m.t === 'gimbal_rate' ? m.seq : -1))
    expect(seqs).toEqual([1, 2, 3])
  })

  it('sends input_hb once per second only while a target is set', () => {
    const h = h0()
    h.loop.start(DEFAULT_PROFILE, 1)
    for (let i = 0; i < 25; i++) {
      h.loop.tick()
      h.advance(50)
    }
    expect(h.sent.filter((m) => m.t === 'input_hb')).toHaveLength(2)
    h.loop.setTarget(null)
    for (let i = 0; i < 25; i++) {
      h.loop.tick()
      h.advance(50)
    }
    expect(h.sent.filter((m) => m.t === 'input_hb')).toHaveLength(2)
  })

  it('setTarget sends zero to the old target then select', () => {
    const h = h0()
    h.loop.start(DEFAULT_PROFILE, 1)
    h.loop.setTarget(2)
    expect(h.sent).toEqual([
      { t: 'select', sysid: 1 },
      { t: 'gimbal_rate', sysid: 1, yaw: 0, pitch: 0, seq: 1 },
      { t: 'select', sysid: 2 },
    ])
  })

  it('disconnect sends zero and stops; stop() does the same', () => {
    const h = h0()
    h.loop.start(DEFAULT_PROFILE, 1)
    h.setPad({ axes: [1, 0], buttons: [] })
    h.loop.tick()
    h.setPad(null)
    h.advance(50)
    h.loop.tick()
    h.advance(50)
    h.loop.tick()
    expect(rates(h.sent)).toEqual([[1, 30, 0], [1, 0, 0]])
    h.setPad({ axes: [1, 0], buttons: [] })
    h.advance(50)
    h.loop.tick()
    expect(rates(h.sent)).toHaveLength(3)
    h.loop.stop()
    expect(rates(h.sent).at(-1)).toEqual([1, 0, 0])
    h.advance(50)
    h.loop.tick()
    expect(rates(h.sent)).toHaveLength(4)
  })

  it('routes rising button edges to onButton', () => {
    const h = h0()
    h.loop.start(DEFAULT_PROFILE, 1)
    h.setPad({ axes: [0, 0], buttons: [true, false] })
    h.loop.tick()
    h.loop.tick()
    expect(h.onButton).toHaveBeenCalledTimes(1)
    expect(h.onButton).toHaveBeenCalledWith('record_toggle')
  })
})

function h0() {
  return harness()
}
