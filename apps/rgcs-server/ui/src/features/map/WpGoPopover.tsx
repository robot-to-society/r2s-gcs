import { useEffect, useRef } from 'react'
import type { VehicleCommand, VehicleState } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { wpGoCommand, type WaypointPick } from './wpGo'

interface Props {
  readonly at: WaypointPick
  /** The badge's vehicle (live state), undefined once it has gone. */
  readonly vehicle: VehicleState | undefined
  readonly dict: Dict
  readonly onSend: (sysid: number, command: VehicleCommand) => void
  readonly onClose: () => void
}

/** Click on a mission badge (ops map): continue the mission from that waypoint, mode unchanged. */
export function WpGoPopover({ at, vehicle, dict, onSend, onClose }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close.current()
    const onDown = (e: PointerEvent) => !(e.target instanceof Node && box.current?.contains(e.target)) && close.current()
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown)
    }
  }, [])
  const title = dict.wpGoTitle.replace('{n}', String(at.n))
  const lost = vehicle === undefined || vehicle.link === 'lost'
  const send = () => {
    onSend(at.sysid, wpGoCommand(at.n))
    onClose()
  }
  return (
    <div ref={box} className="wp-go g-strong" role="dialog" aria-label={title} style={{ left: at.x, top: at.y }}>
      <div className="wp-go-title">{title}</div>
      <div className="t2">{vehicle?.name ?? `#${at.sysid}`}</div>
      {vehicle && vehicle.mode !== 'AUTO' && <div className="wp-go-hint t3">{dict.wpGoAutoHint}</div>}
      {lost && <div className="wp-go-hint t3">{dict.wpGoLinkLost}</div>}
      <div className="wp-go-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          {dict.cancel}
        </button>
        <button type="button" className="btn btn-primary" disabled={lost} onClick={send}>
          {dict.wpGoSend}
        </button>
      </div>
    </div>
  )
}
