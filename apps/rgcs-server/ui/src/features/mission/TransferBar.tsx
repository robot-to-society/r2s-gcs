import type { MissionTransfer } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'

/** Writing takes the first 70 % of the bar, the read-back check the rest. */
const WRITE_SHARE = 70

export function transferPercent(t: MissionTransfer): number {
  const f = t.total === 0 ? 1 : t.done / t.total
  if (t.phase === 'write') return Math.round(f * WRITE_SHARE)
  if (t.phase === 'verify') return Math.round(WRITE_SHARE + f * (100 - WRITE_SHARE))
  return 100
}

/** Mission write progress (`mission_transfer`): shown while writing / verifying, gone afterwards. */
export function TransferBar({ transfer, dict }: { readonly transfer: MissionTransfer | null | undefined; readonly dict: Dict }) {
  if (!transfer || (transfer.phase !== 'write' && transfer.phase !== 'verify')) return null
  const pct = transferPercent(transfer)
  const label = transfer.phase === 'write' ? dict.transferWrite : dict.transferVerify
  return (
    <div className="transfer-bar" role="progressbar" aria-label={dict.mWriteMission} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <span className="num">{`${label} ${transfer.done} / ${transfer.total}`}</span>
      <span className="bar">
        <span style={{ width: `${pct}%` }} />
      </span>
    </div>
  )
}
