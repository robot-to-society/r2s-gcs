import { useMemo } from 'react'
import type { Mission, VehicleState } from '../../shared/api/types'
import type { Predicted } from '../mission/missionAir'
import { planeParams } from './params'
import { predictFor } from './predict'
import { usePathParams } from './usePathParams'

/** The expected flight of a plane / QuadPlane for its mission (operations map); null otherwise. */
export function usePredicted(mission: Mission | null, vehicle: VehicleState | null): Predicted | null {
  const isPlane = vehicle?.kind === 'plane'
  const sysid = isPlane ? (vehicle?.sysid ?? null) : null
  const values = usePathParams(sysid, isPlane)
  // telemetry replaces the vehicle every update: depend on the home's values only
  const [hLat, hLon, hAlt] = [vehicle?.home?.lat, vehicle?.home?.lon, vehicle?.home?.alt]
  return useMemo(() => {
    if (!isPlane || !mission) return null
    const home = hLat !== undefined && hLon !== undefined && hAlt !== undefined ? { lat: hLat, lon: hLon, alt: hAlt } : null
    return predictFor({ items: mission.items, mission }, planeParams(values).params, home)
  }, [isPlane, mission, values, hLat, hLon, hAlt])
}
