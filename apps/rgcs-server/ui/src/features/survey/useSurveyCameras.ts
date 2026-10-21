// The shared survey camera list: loaded once, reloaded after every change.
import { useCallback, useEffect, useState } from 'react'
import type { SurveyCamera } from '../../shared/api/types'
import { createCamera, deleteCamera, fromValues, listCameras, updateCamera, validCameraValues } from './cameraApi'
import type { SurveyCameraValues } from './spec'

const INVALID = 'invalid camera values'
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export interface SurveyCameras {
  readonly cameras: readonly SurveyCamera[]
  readonly error: string | null
  readonly reload: () => Promise<void>
  readonly saveAs: (values: SurveyCameraValues, name: string) => Promise<SurveyCamera | null>
  readonly update: (id: number, values: SurveyCameraValues) => Promise<SurveyCamera | null>
  readonly remove: (id: number) => Promise<true | null>
}

export function useSurveyCameras(): SurveyCameras {
  const [cameras, setCameras] = useState<readonly SurveyCamera[]>([])
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      setCameras(await listCameras())
      setError(null)
    } catch (e) {
      setError(message(e))
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  /** Runs a change, then refreshes the list; a failure is shown instead of thrown. */
  const change = useCallback(
    async <T,>(run: () => Promise<T>): Promise<T | null> => {
      try {
        const out = await run()
        await reload()
        return out
      } catch (e) {
        setError(message(e))
        return null
      }
    },
    [reload],
  )

  const guarded = useCallback(
    async (values: SurveyCameraValues, run: () => Promise<SurveyCamera>) => {
      if (!validCameraValues(values)) {
        setError(INVALID)
        return null
      }
      return change(run)
    },
    [change],
  )

  const saveAs = useCallback((values: SurveyCameraValues, name: string) => guarded(values, () => createCamera(fromValues({ ...values, name }))), [guarded])
  const update = useCallback((id: number, values: SurveyCameraValues) => guarded(values, () => updateCamera(id, { ...fromValues(values), id })), [guarded])
  const remove = useCallback((id: number) => change(async () => (await deleteCamera(id), true as const)), [change])

  return { cameras, error, reload, saveAs, update, remove }
}
