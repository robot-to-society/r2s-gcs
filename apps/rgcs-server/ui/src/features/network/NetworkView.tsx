import type { Dict } from '../../shared/i18n'
import type { NetworkTopology } from '../../shared/api/types'
import { useNetwork } from './useNetwork'

export interface NetworkViewProps {
  /** The reducer's last `network_status` topology. */
  readonly ws: NetworkTopology | null
  readonly dict: Dict
}

/** The ネットワーク screen. Skeleton: the canvas and the inspector arrive in Tasks 6 and 7. */
export function NetworkView({ ws, dict }: NetworkViewProps) {
  const { topology, error } = useNetwork(ws)
  const status = topology === null ? (error === null ? dict.netLoading : dict.netLoadFailed) : null
  return (
    <div className="netwrap" data-testid="network-view">
      <div className="netbar">
        <b>{dict.netTitle}</b>
      </div>
      <div className="netmap">{status !== null && <div className="nethint">{status}</div>}</div>
    </div>
  )
}
