import type { VehicleState } from '../../shared/api/types'
import { IconAltitude, IconBattery, IconSpeed } from '../../shared/ui/icons'
import { altText, battText, speedText } from '../vehicles/format'

/** Altitude · speed · battery over the video, each behind its Lucide icon (spec 20 §9). */
export function StatLine({ v }: { readonly v: VehicleState }) {
  return (
    <>
      <span className="row" style={{ gap: 5 }}>
        <IconAltitude size={14} />
        {altText(v)}
      </span>
      <span className="row" style={{ gap: 5 }}>
        <IconSpeed size={14} />
        {speedText(v)}
      </span>
      <span className="row" style={{ gap: 5 }}>
        <IconBattery size={14} />
        {battText(v)}
      </span>
    </>
  )
}
