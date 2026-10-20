import type { GeoPoint, Home, MissionItem } from '../../shared/api/types'
import type { Predicted } from '../mission/missionAir'
import type { PlaneParams } from './params'
import { predictPlane } from './planePath'

interface Plan {
  readonly items: readonly MissionItem[]
  readonly mission: { readonly home: Home | null }
}

/** The expected flight for a plan, from its home (or the vehicle's) — null without a home to start at. */
export function predictFor(plan: Plan, params: PlaneParams, vehicleHome: GeoPoint | null): Predicted | null {
  const home: Home | null = plan.mission.home ?? (vehicleHome ? { lat: vehicleHome.lat, lon: vehicleHome.lon, alt: vehicleHome.alt } : null)
  if (!home) return null
  return { home: { lat: home.lat, lon: home.lon }, points: predictPlane(plan.items, home, params) }
}
