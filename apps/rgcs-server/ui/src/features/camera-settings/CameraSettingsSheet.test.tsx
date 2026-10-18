import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CameraProfile, CameraState } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { DEFAULT_PROFILE } from '../gimbal-joystick'
import { CameraSettingsSheet } from './CameraSettingsSheet'

const profile = (over: Partial<CameraProfile> = {}): CameraProfile => ({
  sysid: 1, kind: 'none', host: '192.168.144.25', port: 37260, rtsp_url: 'rtsp://{host}:8554/video1', comp_id: 100, video_source_mode: 'auto',
  android_url: '', encoding_preset: 'h264_1080p', thermal_palette: 3, thermal_overlay: true, ai_box_px: 100, clock_sync: true, auto_record: true, ...over,
})
const camState: CameraState = { connected: true, last_error: null, firmware: { camera: 'v1.0.1', gimbal: 'v0.1.10', zoom: 'v0.0.0' }, recording: 'idle', zoom: 1, zoom_max: 165, video_mode: 'rgb', gimbal: null, gimbal_mode: 'follow', stream: null }

const base = { sysid: 1, inputProfile: DEFAULT_PROFILE, cameraState: camState, gamepadIds: ['Pad A'], onCancel: () => {}, onCenter: () => {}, dict: t('ja') }

describe('CameraSettingsSheet', () => {
  it('kind none hides host/port; choosing MT11 shows them with the rtsp preview', () => {
    render(<CameraSettingsSheet {...base} profile={profile()} onSave={() => {}} />)
    expect(screen.queryByLabelText('IP')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('カメラ種別'), { target: { value: 'siyi_mt11' } })
    expect(screen.getByLabelText('IP')).toHaveValue('192.168.144.25')
    expect(screen.getByLabelText('制御ポート')).toHaveValue(37260)
    expect(screen.getByText('rtsp://192.168.144.25:8554/video1')).toBeInTheDocument()
    expect(screen.getByText(/v1\.0\.1/)).toBeInTheDocument()
  })

  it('invalid port shows red and keeps save disabled', () => {
    render(<CameraSettingsSheet {...base} profile={profile({ kind: 'siyi_mt11' })} onSave={() => {}} />)
    fireEvent.change(screen.getByLabelText('制御ポート'), { target: { value: '0' } })
    expect(screen.getByLabelText('制御ポート')).toHaveClass('invalid')
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
  })

  it('save calls onSave with both profiles after edits on both tabs', async () => {
    const onSave = vi.fn()
    render(<CameraSettingsSheet {...base} profile={profile({ kind: 'siyi_mt11' })} onSave={onSave} />)
    fireEvent.change(screen.getByLabelText('IP'), { target: { value: '10.0.0.5' } })
    fireEvent.click(screen.getByRole('button', { name: '操作' }))
    fireEvent.change(screen.getByLabelText('最大パン速度'), { target: { value: '45' } })
    fireEvent.change(screen.getByLabelText('軸 1 の機能'), { target: { value: 'none' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    const [cam, input] = onSave.mock.calls[0]!
    expect(cam).toMatchObject({ kind: 'siyi_mt11', host: '10.0.0.5', port: 37260 })
    expect(input.max_pan_speed).toBe(45)
    expect(input.axes[1]?.fn).toBe('none')
  })

  it('center button sends the gimbal centre command', () => {
    const onCenter = vi.fn()
    render(<CameraSettingsSheet {...base} profile={profile({ kind: 'siyi_mt11' })} onSave={() => {}} onCenter={onCenter} />)
    fireEvent.click(screen.getByRole('button', { name: '操作' }))
    fireEvent.click(screen.getByRole('button', { name: 'ジンバルをセンター' }))
    expect(onCenter).toHaveBeenCalledTimes(1)
  })
})
