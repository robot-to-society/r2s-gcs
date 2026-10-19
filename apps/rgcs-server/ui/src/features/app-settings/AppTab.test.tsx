import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InspectionTemplate, Operator, VehicleRegistry, VehicleState } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { AppTab } from './AppTab'

const copter: VehicleState = {
  sysid: 1, name: 'UAV-01', kind: 'copter', mode: 'STABILIZE', armed: false, lat: 0, lon: 0, alt_rel: 0, alt_msl: 0, hdg: 0,
  ground_speed: 0, climb: 0, battery: { pct: 90, volt: 24, current: null }, link: 'ok', last_rx_ms: 0, gps: { fix: 0, sats: 0, hdop: null }, warn: false, unread: 0,
}
const registry: VehicleRegistry = {
  sysid: 1, name: 'UAV-01', registration: '', uas_type: '', model: '', type_cert_no: '', airworthiness_class: '', airworthiness_no: '', manufacturer: '', serial_no: '',
  initial_flight_minutes: 0, inspection_template_id: null, total_flight_minutes: 0,
}
const template: InspectionTemplate = { id: 1, name: '様式2 標準', version: 1, items: [{ label: '機体全般', detail: 'x' }], updated_at: 0 }
const settings = { lang: 'ja', map_tile_url: 'x', map_attribution: 'y', map: { gimbal_ground_projection: false }, basemaps: [], mavlink: { gcs_sysid: 255 } }
const ok = (data: unknown, status = 200) => new Response(JSON.stringify({ success: true, data }), { status, headers: { 'content-type': 'application/json' } })

function setup(role: Operator['role'] = 'admin') {
  const calls: { url: string; init?: RequestInit }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      calls.push({ url, init })
      if (url.endsWith('/registry') && init?.method === 'PUT') return ok({ ...registry, ...(JSON.parse(String(init.body)) as object), total_flight_minutes: 125 })
      if (url.endsWith('/registry')) return ok(registry)
      if (url.endsWith('/users/me/pilot') && init?.method === 'PUT') return ok({ username: 'admin', ...(JSON.parse(String(init.body)) as object) })
      if (url.endsWith('/users/me/pilot')) return ok({ username: 'admin', full_name: '', license_no: '' })
      if (url.endsWith('/inspection/templates')) return ok([template])
      if (url.endsWith('/settings/app') && init?.method === 'PUT') return ok({ ...settings, ...(JSON.parse(String(init.body)) as object) })
      if (url.endsWith('/settings/app')) return ok(settings)
      return ok(null, 404)
    }),
  )
  const onOpenPresent = vi.fn()
  const me: Operator = { username: 'admin', role, dev_mode: true }
  render(<AppTab sysid={1} vehicle={copter} me={me} dict={t('ja')} onOpenPresent={onOpenPresent} />)
  return { calls, onOpenPresent }
}

describe('AppTab', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('registry_form_loads_and_saves_for_admin', async () => {
    const { calls } = setup()
    await waitFor(() => expect(screen.getByLabelText('登録記号(届出番号)')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('登録記号(届出番号)'), { target: { value: 'JU1234567890' } })
    fireEvent.change(screen.getByLabelText('製造後総飛行時間の初期値(分)'), { target: { value: '125' } })
    const card = screen.getByTestId('registry-card')
    fireEvent.click(within(card).getByRole('button', { name: '保存' }))
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/registry') && c.init?.method === 'PUT')).toBe(true))
    const body = JSON.parse(String(calls.find((c) => c.init?.method === 'PUT')?.init?.body)) as Record<string, unknown>
    expect(body).toMatchObject({ registration: 'JU1234567890', initial_flight_minutes: 125, name: 'UAV-01' })
    await waitFor(() => expect(within(card).getByText('保存しました')).toBeInTheDocument())
    expect(within(card).getByText(/125 分/)).toBeInTheDocument()
  })

  it('operator_sees_registry_read_only', async () => {
    setup('operator')
    await waitFor(() => expect(screen.getByLabelText('登録記号(届出番号)')).toBeInTheDocument())
    expect(screen.getByLabelText('登録記号(届出番号)')).toBeDisabled()
    expect(screen.getByText('管理者のみ変更できます')).toBeInTheDocument()
    expect(within(screen.getByTestId('registry-card')).queryByRole('button', { name: '保存' })).toBeNull()
  })

  it('pilot_form_saves_my_name_and_license', async () => {
    const { calls } = setup('operator')
    await waitFor(() => expect(screen.getByLabelText('氏名')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('氏名'), { target: { value: '川村' } })
    fireEvent.change(screen.getByLabelText('技能証明書番号'), { target: { value: 'T123' } })
    fireEvent.click(within(screen.getByTestId('pilot-card')).getByRole('button', { name: '保存' }))
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/users/me/pilot') && c.init?.method === 'PUT')).toBe(true))
    expect(JSON.parse(String(calls.find((c) => c.url.endsWith('/users/me/pilot') && c.init?.method === 'PUT')?.init?.body))).toEqual({ full_name: '川村', license_no: 'T123' })
  })

  it('present_button_calls_the_callback_and_language_toggles', async () => {
    const { onOpenPresent } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'ロゴ・提示用トークン' }))
    expect(onOpenPresent).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '日本語' }).className).toContain('on')
  })
  it('map_display_switch_toggles_and_saves', async () => {
    const { calls } = setup()
    const sw = await screen.findByRole('switch', { name: 'ジンバルを地面に投影' })
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'false'))
    expect(screen.getByText('地図表示')).toBeInTheDocument()
    expect(screen.getByText(/オフの場合は撮影方向のみを表示します/)).toBeInTheDocument()
    fireEvent.click(sw)
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'true'))
    const put = calls.find((c) => c.url.endsWith('/settings/app') && c.init?.method === 'PUT')
    expect(JSON.parse(String(put?.init?.body))).toEqual({ map: { gimbal_ground_projection: true } })
  })
  it('mavlink_card_saves_the_sysid', async () => {
    const { calls } = setup()
    const input = await screen.findByLabelText('RGCS の SYSID')
    await waitFor(() => expect(input).toHaveValue(255))
    fireEvent.change(input, { target: { value: '250' } })
    const card = screen.getByTestId('mavlink-card')
    fireEvent.click(within(card).getByRole('button', { name: '保存' }))
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/settings/app') && c.init?.method === 'PUT' && String(c.init.body).includes('gcs_sysid'))).toBe(true))
    const put = calls.find((c) => String(c.init?.body).includes('gcs_sysid'))
    expect(JSON.parse(String(put?.init?.body))).toEqual({ mavlink: { gcs_sysid: 250 } })
  })

  it('mavlink_card_is_read_only_for_operators', async () => {
    setup('operator')
    const input = await screen.findByLabelText('RGCS の SYSID')
    expect(input).toBeDisabled()
  })
})
