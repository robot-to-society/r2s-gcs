import type { ButtonFunction, ClientMessage, GimbalInputProfile } from '../../shared/api/types'
import { axesToRates, buttonEdges } from './mapping'

export interface GamepadSample {
  readonly axes: readonly number[]
  readonly buttons: readonly boolean[]
}

export interface LoopDeps {
  readonly send: (m: ClientMessage) => boolean
  readonly onButton: (fn: ButtonFunction) => void
  /** Null when no gamepad is connected. */
  readonly readGamepad: () => GamepadSample | null
  readonly now: () => number
}

export const TICK_MS = 50
const HB_MS = 1000

/**
 * 20 Hz sampler (spec 30 §6, 40 §6): non-zero rates are sent every tick, a single zero when the
 * stick returns to centre or the pad disappears, `input_hb` once a second while a target exists.
 */
export class GimbalLoop {
  private readonly deps: LoopDeps
  private profile: GimbalInputProfile | null = null
  private target: number | null = null
  private seq = 0
  private lastNonZero = false
  private lastHb: number | null = null
  private prevButtons: readonly boolean[] = []
  private padPresent = false

  constructor(deps: LoopDeps) {
    this.deps = deps
  }

  start(profile: GimbalInputProfile, sysid: number | null): void {
    this.profile = profile
    this.setTarget(sysid)
  }

  setProfile(profile: GimbalInputProfile): void {
    this.profile = profile
  }

  /**
   * Zeroes the previous target before switching (spec 70 §2) — only once a gamepad has been
   * seen: without one, nothing was ever commanded and a selection must not touch the camera.
   */
  setTarget(sysid: number | null): void {
    if (this.padPresent && this.target !== null && this.target !== sysid) this.zero(this.target)
    this.target = sysid
    this.lastHb = null
    if (sysid !== null) this.deps.send({ t: 'select', sysid })
  }

  stop(): void {
    if (this.padPresent && this.target !== null) this.zero(this.target)
    this.target = null
  }

  tick(): void {
    const target = this.target
    const profile = this.profile
    if (target === null || profile === null) return
    const now = this.deps.now()
    const pad = this.deps.readGamepad()
    if (pad === null) {
      if (this.padPresent) this.zero(target)
      this.padPresent = false
      this.prevButtons = []
      return
    }
    this.padPresent = true
    const rates = axesToRates(pad.axes, profile)
    const nonZero = rates.yaw !== 0 || rates.pitch !== 0
    if (nonZero) this.sendRate(target, rates.yaw, rates.pitch)
    else if (this.lastNonZero) this.zero(target)
    this.lastNonZero = nonZero
    for (const fn of buttonEdges(this.prevButtons, pad.buttons, profile)) this.deps.onButton(fn)
    this.prevButtons = pad.buttons
    if (this.lastHb === null || now - this.lastHb >= HB_MS) {
      this.deps.send({ t: 'input_hb', sysid: target })
      this.lastHb = now
    }
  }

  private zero(sysid: number): void {
    this.sendRate(sysid, 0, 0)
    this.lastNonZero = false
  }

  private sendRate(sysid: number, yaw: number, pitch: number): void {
    this.seq += 1
    this.deps.send({ t: 'gimbal_rate', sysid, yaw, pitch, seq: this.seq })
  }
}
