import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CameraCaps, CameraState, VehicleState, VideoSourceStatus } from '../../shared/api/types'
import { t } from '../../shared/i18n'

const stats: ((l: { rtt: number | null; jitter: number | null }) => void)[] = []
vi.mock('../../shared/video/whep', () => ({
  WhepPlayer: class {
    constructor(_v: HTMLVideoElement, _url: string, opts: { onStats?: (l: { rtt: number | null; jitter: number | null }) => void }) {
      if (opts.onStats) stats.push(opts.onStats)
    }
    start() {}
    stop() {}
  },
}))

const { Cockpit } = await import('./Cockpit')
const v: VehicleState = {
  sysid: 1, name: 'UAV-01', kind: 'copter', mode: 'AUTO', armed: true, lat: 36, lon: 139, alt_rel: 81.6, alt_msl: 0, hdg: 0,
  ground_speed: 7.25, climb: 0, battery: { pct: 64, volt: 22.1, current: null }, link: 'ok', last_rx_ms: 0,
  gps: { fix: 3, sats: 12, hdop: 1 }, warn: false, unread: 0,
}
const mt11: CameraCaps = {
  kind: 'siyi_mt11',
  gimbal: { rate: true, angle: true, center: true, modes: ['lock', 'follow', 'fpv'], attitude: true, pitch_range: [-90, 30] },
  zoom: { max: 165, absolute: true, step: true, continuous: true },
  focus: true, photo: true, record: true, video_modes: ['rgb', 'thermal', 'side_by_side'], hfov_deg: 62, roi: 'computed',
}
const state: CameraState = {
  connected: true, last_error: null, firmware: null, recording: 'idle', zoom: 1, zoom_max: 165, video_mode: 'rgb',
  gimbal: { yaw: 45, pitch: -90, roll: 0, age_ms: 0 }, gimbal_mode: 'follow', stream: null,
}
const live: VideoSourceStatus = { mode: 'auto', source: 'mt11', scanning: false, probe_ok: true, whep_path: 'mt11' }
const setup = (over: { caps?: CameraCaps; state?: CameraState } = {}) => {
  const p = { vehicle: v, camera: { sysid: 1, caps: over.caps ?? mt11, state: over.state ?? state }, status: live, pending: false, dict: t('ja'), onCommand: vi.fn(), onSettings: vi.fn(), onRestore: vi.fn(), map: <div data-testid="mini-map" /> }
  render(<Cockpit {...p} />)
  return p
}

describe('Cockpit (spec 10 §4.2)', () => {
  it('shows the vehicle pills, the mini map and a restore button', () => {
    const p = setup()
    expect(screen.getByText('UAV-01')).toBeInTheDocument()
    expect(screen.getByText('AUTO')).toBeInTheDocument()
    expect(screen.getByText('▲ 82 m')).toBeInTheDocument()
    expect(screen.getByTestId('mini-map')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '元に戻す' }))
    expect(p.onRestore).toHaveBeenCalledOnce()
  })

  it('sends record, photo, zoom steps, video type, gimbal mode and center from the bar', () => {
    const p = setup()
    for (const name of ['録画', '写真', 'ズームイン', 'ズームアウト', 'IR', 'Lock', 'ジンバルをセンター']) fireEvent.click(screen.getByRole('button', { name }))
    expect(p.onCommand.mock.calls.map(([c]) => c)).toEqual([
      { cmd: 'record_start' },
      { cmd: 'photo' },
      { cmd: 'zoom_step', args: { steps: 1 } },
      { cmd: 'zoom_step', args: { steps: -1 } },
      { cmd: 'video_mode', args: { mode: 'thermal' } },
      { cmd: 'gimbal_mode', args: { mode: 'lock' } },
      { cmd: 'gimbal_center', args: { mode: 'one_key_reset' } },
    ])
    fireEvent.click(screen.getByRole('button', { name: 'カメラ設定' }))
    expect(p.onSettings).toHaveBeenCalledOnce()
  })

  it('the log zoom slider sends one absolute zoom when released, not one per pixel', () => {
    const p = setup()
    const slider = screen.getByRole('slider', { name: 'ズーム' })
    fireEvent.change(slider, { target: { value: '700' } })
    fireEvent.change(slider, { target: { value: '1000' } })
    expect(p.onCommand).not.toHaveBeenCalled()
    // the value follows the thumb while dragging; after release it waits for camera_state
    expect(screen.getByText('165.0×')).toBeInTheDocument()
    fireEvent.pointerUp(slider)
    expect(p.onCommand.mock.calls).toEqual([[{ cmd: 'zoom_absolute', args: { zoom: 165 } }]])
  })

  it('stops recording when recording, and hides what a camera cannot do', () => {
    const p = setup({ state: { ...state, recording: 'recording' }, caps: { ...mt11, gimbal: null, video_modes: [], zoom: null, photo: false } })
    fireEvent.click(screen.getByRole('button', { name: '録画' }))
    expect(p.onCommand).toHaveBeenCalledWith({ cmd: 'record_stop' })
    for (const name of ['写真', 'IR', 'Lock', 'ジンバルをセンター', 'ズームイン']) expect(screen.queryByRole('button', { name })).toBeNull()
    expect(screen.queryByRole('slider')).toBeNull()
    expect(screen.queryByText('ジンバル')).toBeNull()
  })

  it('the status card puts the gimbal on the dial and shows source and measured delay', () => {
    setup()
    expect(screen.getByText(/^Follow\s+45\.0° \/ −90\.0°$/)).toBeInTheDocument()
    const pt = document.querySelector('.cam-dial .pt') as HTMLElement
    expect(pt.style.transform).toBe('translate(18px, 36px)')
    act(() => stats[stats.length - 1]!({ jitter: 80, rtt: 40 }))
    expect(screen.getAllByText(/100 ms/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/MT11/).length).toBeGreaterThan(0)
  })

  it('a vehicle without a camera shows only the video and the map', () => {
    setup({ caps: { ...mt11, kind: 'none' } })
    expect(screen.queryByRole('button', { name: '録画' })).toBeNull()
    expect(document.querySelector('.cam-card')).toBeNull()
    expect(screen.getByTestId('mini-map')).toBeInTheDocument()
  })
})
