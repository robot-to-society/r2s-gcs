import type { Mission, MissionProgress, MissionTransfer, VehicleState } from '../../shared/api/types'
import { TransferBar } from '../mission/TransferBar'
import type { Dict } from '../../shared/i18n'
import { remainingDistanceM } from '../mission/geo'

interface Props {
  readonly progress: MissionProgress | null
  readonly mission: Mission | null
  readonly vehicle: VehicleState
  readonly dict: Dict
  readonly onWrite: () => void
  readonly onStart: () => void
  /** A mission write in progress for this vehicle. */
  readonly transfer?: MissionTransfer | null
}

const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`)

/** Addendum §5.7: current WP / remaining distance plus the 書込 / 開始 shortcuts. */
export function MissionProgressRow({ progress, mission, vehicle, dict, onWrite, onStart, transfer = null }: Props) {
  const total = mission?.items.length ?? progress?.total ?? null
  const remaining = mission && progress ? remainingDistanceM(mission.items, progress.seq, vehicle.lat === 0 && vehicle.lon === 0 ? null : vehicle) : null
  return (
    <>
      <div className="mission-progress" data-testid="mission-progress">
        <span className="t3">{dict.mProgress}</span>
        <span className="num">
          {progress ? `WP ${progress.seq} / ${total ?? '?'}` : mission ? `${mission.items.length} ${dict.mItems}` : '—'}
          {remaining !== null && ` · ${dict.mRemaining} ${km(remaining)}`}
        </span>
        <span className="grow" />
        <button type="button" className="btn btn-ghost btn-sm" onClick={onWrite}>
          {dict.mWriteMission}
        </button>
        {mission && (
          <button type="button" className="btn btn-primary btn-sm" onClick={onStart}>
            {dict.mStart}
          </button>
        )}
      </div>
      {(transfer?.phase === 'write' || transfer?.phase === 'verify') && (
        <div style={{ padding: '0 12px 8px' }}>
          <TransferBar transfer={transfer} dict={dict} />
        </div>
      )}
    </>
  )
}
