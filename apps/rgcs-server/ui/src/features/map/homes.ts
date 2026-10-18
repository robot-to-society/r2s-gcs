import type { Mission, SysId } from '../../shared/api/types'
import type { LatLon } from './store'

/** Each vehicle's home from the mission it is known to carry (no HOME_POSITION feed yet). */
export function missionHomes(missions: ReadonlyMap<SysId, Mission>): ReadonlyMap<SysId, LatLon> {
  const homes = [...missions].flatMap(([sysid, m]) => (m.home && !(m.home.lat === 0 && m.home.lon === 0) ? [[sysid, { lat: m.home.lat, lon: m.home.lon }] as const] : []))
  return new Map(homes)
}
