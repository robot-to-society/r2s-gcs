// The shared survey camera list: loaded once, reloaded after every change.
import { useCallback, useEffect, useState } from 'react'
import type { SurveyCamera } from '../../shared/api/types'
import { createCamera, deleteCamera, fromValues, listCameras, updateCamera } from './cameraApi'
import type { SurveyCameraValues } from './spec'

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export interface SurveyCameras {
  readonly cameras: readonly SurveyCamera[]
  readonly error: string | null
  readonly reload: () => Promise<void>
  readonly saveAs: (values: SurveyCameraValues, name: string) => Promise<SurveyCamera | null>
  readonly update: (id: number, values: SurveyCameraValues) => Promise<void>
  readonly remove: (id: number) => Promise<void>
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

  const saveAs = useCallback((values: SurveyCameraValues, name: string) => change(() => createCamera(fromValues({ ...values, name }))), [change])
  const update = useCallback(async (id: number, values: SurveyCameraValues) => void (await change(() => updateCamera(id, { ...fromValues(values), id }))), [change])
  const remove = useCallback(async (id: number) => void (await change(() => deleteCamera(id))), [change])

  return { cameras, error, reload, saveAs, update, remove }
}
