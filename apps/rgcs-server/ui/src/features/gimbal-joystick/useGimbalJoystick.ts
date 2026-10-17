import { useEffect, useRef } from 'react'
import type { ButtonFunction, GimbalInputProfile } from '../../shared/api/types'
import { vehicleStore } from '../vehicles/store'
import { GimbalLoop, TICK_MS } from './loop'

function readGamepad(deviceId: string | null): { axes: readonly number[]; buttons: readonly boolean[] } | null {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return null
  const pads = navigator.getGamepads()
  const pad = (deviceId ? pads.find((p) => p?.id === deviceId) : pads.find((p) => p !== null)) ?? null
  return pad ? { axes: pad.axes, buttons: pad.buttons.map((b) => b.pressed) } : null
}

/**
 * Owns one GimbalLoop for the selected vehicle. Tab hidden or pad unplugged → one zero and
 * silence until things come back (spec 70 §2).
 */
export function useGimbalJoystick(sysid: number | null, profile: GimbalInputProfile | null, onButton: (fn: ButtonFunction) => void): void {
  const onButtonRef = useRef(onButton)
  onButtonRef.current = onButton
  const loopRef = useRef<GimbalLoop | null>(null)

  useEffect(() => {
    if (!profile) return
    const loop = new GimbalLoop({
      send: (m) => vehicleStore.send(m),
      onButton: (fn) => onButtonRef.current(fn),
      readGamepad: () => readGamepad(profile.device_id),
      now: () => performance.now(),
    })
    loopRef.current = loop
    loop.start(profile, sysid)
    const timer = setInterval(() => loop.tick(), TICK_MS)
    const onVisibility = () => loop.setTarget(document.visibilityState === 'hidden' ? null : sysid)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      loop.stop()
      loopRef.current = null
    }
    // The loop is rebuilt when the profile changes; target changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile])

  useEffect(() => {
    loopRef.current?.setTarget(sysid)
  }, [sysid])
}
