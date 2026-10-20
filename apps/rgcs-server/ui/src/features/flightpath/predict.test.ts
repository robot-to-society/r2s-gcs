import { describe, expect, it } from 'vitest'
import type { Home, MissionItem } from '../../shared/api/types'
import { PLANE_DEFAULTS } from './params'
import { predictFor } from './predict'

const takeoff: MissionItem = { command: 22, frame: 'rel', params: [0, 0, 0, 0], lat: 0, lon: 0, alt: 40, autocontinue: true }
const plan = (home: Home | null) => ({ items: [takeoff], mission: { home } })
const qp = { ...PLANE_DEFAULTS, quadplane: true }

describe('predictFor', () => {
  it('starts from the plan home, else from the vehicle home, else predicts nothing', () => {
    const planHome = { lat: 36.25, lon: 137.6, alt: 1500 }
    expect(predictFor(plan(planHome), qp, null)!.home).toEqual({ lat: 36.25, lon: 137.6 })
    const fromVehicle = predictFor(plan(null), qp, { lat: 36.3, lon: 137.7, alt: 1490 })!
    expect(fromVehicle.home).toEqual({ lat: 36.3, lon: 137.7 })
    expect(fromVehicle.points.at(-1)!.alt).toBe(40)
    expect(predictFor(plan(null), qp, null)).toBeNull()
  })
})
