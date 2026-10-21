import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { t } from '../../shared/i18n'
import { CameraFields } from './CameraFields'
import { fromValues } from './cameraApi'
import { ALPHA7R4 } from './spec'

const dict = t('ja')
const builtin = { ...fromValues(ALPHA7R4), id: 1, builtin: true }
const mine = { ...fromValues({ ...ALPHA7R4, name: 'Mine', focalMm: 24 }), id: 2 }

function setup(over: Partial<React.ComponentProps<typeof CameraFields>> = {}) {
  const props = { values: ALPHA7R4, orientation: 'landscape' as const, cameras: [builtin, mine], dict, onChange: vi.fn(), onOrientation: vi.fn(), onPick: vi.fn(), onSaveAs: vi.fn(), onUpdate: vi.fn(), onDelete: vi.fn(), ...over }
  render(<CameraFields {...props} />)
  return props
}

describe('CameraFields', () => {
  it('shows_the_alpha7r4_values', () => {
    setup()
    expect(screen.getByLabelText(dict.svSensorW)).toHaveValue(35.7)
    expect(screen.getByLabelText(dict.svImageH)).toHaveValue(6336)
    expect(screen.getByLabelText(dict.svShutter)).toHaveValue(1000)
  })

  it('typing_500_in_shutter_stores_0_002_seconds', () => {
    const p = setup()
    fireEvent.change(screen.getByLabelText(dict.svShutter), { target: { value: '500' } })
    expect(p.onChange).toHaveBeenCalledWith({ ...ALPHA7R4, shutterS: 0.002 })
  })

  it('picking_a_camera_passes_its_values', () => {
    const p = setup()
    fireEvent.change(screen.getByLabelText(dict.svCameraPick), { target: { value: '2' } })
    expect(p.onPick).toHaveBeenCalledWith(expect.objectContaining({ name: 'Mine', focalMm: 24 }))
  })

  it('orientation_toggles', () => {
    const p = setup()
    fireEvent.click(screen.getByRole('button', { name: dict.svPortrait }))
    expect(p.onOrientation).toHaveBeenCalledWith('portrait')
  })

  it('save_as_sends_the_entered_name', () => {
    const p = setup()
    fireEvent.change(screen.getByLabelText(dict.svSaveName), { target: { value: 'New cam' } })
    fireEvent.click(screen.getByRole('button', { name: dict.svSaveAs }))
    expect(p.onSaveAs).toHaveBeenCalledWith('New cam')
  })

  it('builtin_has_no_edit_or_delete', () => {
    setup()
    fireEvent.change(screen.getByLabelText(dict.svCameraPick), { target: { value: '1' } })
    expect(screen.queryByRole('button', { name: dict.svCamUpdate })).toBeNull()
    expect(screen.queryByRole('button', { name: dict.svCamDelete })).toBeNull()
  })

  it('user_camera_updates_and_deletes_with_a_second_click', () => {
    const p = setup()
    fireEvent.change(screen.getByLabelText(dict.svCameraPick), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: dict.svCamUpdate }))
    expect(p.onUpdate).toHaveBeenCalledWith(2)
    fireEvent.click(screen.getByRole('button', { name: dict.svCamDelete }))
    expect(p.onDelete).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: dict.svCamDeleteConfirm }))
    expect(p.onDelete).toHaveBeenCalledWith(2)
  })
})
