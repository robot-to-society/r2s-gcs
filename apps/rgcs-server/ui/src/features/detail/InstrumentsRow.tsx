import type { VehicleState } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { AttitudeIndicator } from './AttitudeIndicator'
import { modelFor } from '../map/models/meshes'
import { CompassRose } from './CompassRose'
import { fmtHeading, fmtSigned, readAttitude, readHeading } from './instruments'

interface Props {
  readonly vehicle: VehicleState
  readonly dict: Dict
}

/** 姿勢 + 方位 row of the detail panel with the numeric R / P / HDG line under it. */
export function InstrumentsRow({ vehicle, dict }: Props) {
  const att = readAttitude(vehicle.attitude)
  const hdg = readHeading(vehicle.hdg)
  const cog = readHeading(vehicle.cog)
  const roll = att?.roll ?? null
  const pitch = att?.pitch ?? null
  return (
    <div className="instruments" data-testid="instruments">
      <div className="instruments-dials">
        <AttitudeIndicator roll={roll} pitch={pitch} dict={dict} />
        <CompassRose hdg={hdg} cog={cog} frame={modelFor(vehicle.kind, vehicle.vtol ?? false)} dict={dict} />
      </div>
      <div className="instruments-values num" data-testid="instruments-values">
        <span>
          <span className="lbl" title={dict.instRoll}>{dict.instRollShort}</span> {fmtSigned(roll)}
        </span>
        <span>
          <span className="lbl" title={dict.instPitch}>{dict.instPitchShort}</span> {fmtSigned(pitch)}
        </span>
        <span>
          <span className="lbl" title={dict.instHeading}>{dict.instHdgShort}</span> {fmtHeading(hdg)}
        </span>
      </div>
    </div>
  )
}
