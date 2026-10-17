import type { CommandResult, ServerMessage, SysId, VehicleMessage, VehicleState } from '../../shared/api/types'
import { applyDiff } from '../../shared/ws/apply'

export type LinkState = 'connecting' | 'open' | 'closed'

export interface VehiclesState {
  readonly vehicles: ReadonlyMap<SysId, VehicleState>
  readonly messages: readonly VehicleMessage[]
  /** `command_result` frames, newest first, unique by id (the footer shows the top two). */
  readonly results: readonly CommandResult[]
  readonly link: LinkState
}

export const initialState: VehiclesState = { vehicles: new Map(), messages: [], results: [], link: 'connecting' }

const MAX_MESSAGES = 200
const MAX_RESULTS = 50

/** Newest first; a result whose id is already present is ignored (HTTP reply vs WS race). */
export function addResult(results: readonly CommandResult[], r: CommandResult): readonly CommandResult[] {
  if (results.some((x) => x.id === r.id)) return results
  return [r, ...results].slice(0, MAX_RESULTS)
}

function placeholder(sysid: SysId): VehicleState {
  return {
    sysid,
    name: `UAV-${String(sysid).padStart(2, '0')}`,
    kind: 'other',
    mode: '',
    armed: false,
    lat: 0,
    lon: 0,
    alt_rel: 0,
    alt_msl: 0,
    hdg: null,
    ground_speed: 0,
    climb: 0,
    battery: { pct: null, volt: 0, current: null },
    link: 'ok',
    last_rx_ms: 0,
    gps: { fix: 0, sats: 0, hdop: null },
    warn: false,
    unread: 0,
  }
}

function withVehicle(state: VehiclesState, v: VehicleState): VehiclesState {
  const vehicles = new Map(state.vehicles)
  vehicles.set(v.sysid, v)
  return { ...state, vehicles }
}

/** Pure reducer over server frames; the store and the tests share it. */
export function reduce(state: VehiclesState, msg: ServerMessage): VehiclesState {
  switch (msg.t) {
    case 'snapshot':
      return { ...state, vehicles: new Map(msg.vehicles.map((v) => [v.sysid, v])) }
    case 'telemetry': {
      const prev = state.vehicles.get(msg.sysid) ?? placeholder(msg.sysid)
      return withVehicle(state, applyDiff(prev, msg.diff))
    }
    case 'vehicle_discovered':
      return state.vehicles.has(msg.sysid) ? state : withVehicle(state, placeholder(msg.sysid))
    case 'vehicle_lost': {
      const vehicles = new Map(state.vehicles)
      vehicles.delete(msg.sysid)
      return { ...state, vehicles }
    }
    case 'vehicle_message': {
      const { t: _t, ...m } = msg
      return { ...state, messages: [m, ...state.messages].slice(0, MAX_MESSAGES) }
    }
    case 'command_result': {
      const { t: _t, ...r } = msg
      const results = addResult(state.results, r)
      return results === state.results ? state : { ...state, results }
    }
    default:
      return state
  }
}

export function setLink(state: VehiclesState, link: LinkState): VehiclesState {
  return state.link === link ? state : { ...state, link }
}
