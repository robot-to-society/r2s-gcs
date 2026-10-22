import { describe, expect, it } from 'vitest'
import { buttonAction } from './buttons'

describe('buttonAction (spec 40 §6)', () => {
  it('roi_N starts that preset, or stops it when it is the active one', () => {
    expect(buttonAction('roi_3', null, null)).toEqual({ kind: 'roi_start', id: 'roi_3' })
    expect(buttonAction('roi_3', null, 'roi_3')).toEqual({ kind: 'roi_stop' })
    expect(buttonAction('roi_3', null, 'roi_1')).toEqual({ kind: 'roi_start', id: 'roi_3' })
    expect(buttonAction('roi_10', null, null)).toEqual({ kind: 'roi_start', id: 'roi_10' })
  })

  it('roi_stop stops only while active', () => {
    expect(buttonAction('roi_stop', null, null)).toBeNull()
    expect(buttonAction('roi_stop', null, 'roi_2')).toEqual({ kind: 'roi_stop' })
  })

  it('camera functions become camera commands', () => {
    expect(buttonAction('shutter', null, null)).toEqual({ kind: 'camera', cmd: { cmd: 'photo' } })
    expect(buttonAction('none', null, 'roi_1')).toBeNull()
    expect(buttonAction('gimbal_stop', null, null)).toBeNull()
  })
})
