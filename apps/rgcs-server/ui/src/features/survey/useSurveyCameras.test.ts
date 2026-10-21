import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ALPHA7R4 } from './spec'
import * as api from './cameraApi'
import { useSurveyCameras } from './useSurveyCameras'

vi.mock('./cameraApi', async (orig) => ({ ...(await orig<typeof api>()), listCameras: vi.fn(), createCamera: vi.fn(), updateCamera: vi.fn(), deleteCamera: vi.fn() }))

const built = { ...api.fromValues(ALPHA7R4), id: 1, builtin: true }

describe('useSurveyCameras', () => {
  beforeEach(() => {
    vi.mocked(api.listCameras).mockReset().mockResolvedValue([built])
    vi.mocked(api.createCamera).mockReset()
  })

  it('loads_the_list', async () => {
    const { result } = renderHook(() => useSurveyCameras())
    await waitFor(() => expect(result.current.cameras).toEqual([built]))
    expect(result.current.error).toBeNull()
  })

  it('saveAs_creates_a_non_builtin_camera_with_the_name_and_reloads', async () => {
    vi.mocked(api.createCamera).mockResolvedValue({ ...api.fromValues(ALPHA7R4), id: 2, name: 'Mine' })
    const { result } = renderHook(() => useSurveyCameras())
    await waitFor(() => expect(result.current.cameras).toHaveLength(1))
    await act(async () => {
      await result.current.saveAs(ALPHA7R4, 'Mine')
    })
    expect(api.createCamera).toHaveBeenCalledWith(expect.objectContaining({ name: 'Mine', builtin: false, id: null, sensor_w_mm: 35.7 }))
    expect(api.listCameras).toHaveBeenCalledTimes(2)
  })

  it('reports_a_failed_load', async () => {
    vi.mocked(api.listCameras).mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useSurveyCameras())
    await waitFor(() => expect(result.current.error).toBe('boom'))
  })
})
