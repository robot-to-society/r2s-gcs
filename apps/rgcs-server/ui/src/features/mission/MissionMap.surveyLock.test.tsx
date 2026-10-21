// The map leaves survey items to the survey (final review C2 / I2): no drags, no "+" inside a survey,
// and badges only for the selected survey.
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { created } from '../../test/fakeMaplibre'

vi.mock('maplibre-gl', async () => (await import('../../test/fakeMaplibre')).maplibreModule)

const { MissionMap } = await import('./MissionMap')
const { appendWaypoint } = await import('./model')
const { rasterStyle } = await import('../map/style')
const { surveyDraft } = await import('../survey/surveyFixture')

const style = rasterStyle('https://t/{z}/{x}/{y}.png', 'x')
const DEM = 'https://dem/{z}/{x}/{y}.png'
const live = (cls: string) => created.markers.filter((m) => m.el.classList.contains(cls) && !m.removed)

/** A survey followed by one plain waypoint. */
function planned() {
  const { draft } = surveyDraft()
  const d = appendWaypoint(draft, 36.3, 139.1)
  return { d, survey: d.surveys[0]!.uids, plain: d.items.at(-1)!.uid }
}

function renderMap(over: Partial<React.ComponentProps<typeof MissionMap>>) {
  const noop = vi.fn()
  const props = {
    draft: planned().d,
    selected: new Set<number>(),
    tool: 'add' as const,
    style,
    vehicle: null,
    fitRequest: 0,
    onAdd: noop, onInsertAfter: noop, onMove: noop, onMoveSelected: noop, onShiftAlt: noop, onBoxSelect: noop, onArc: noop,
    onPlanClick: noop, onFenceEdit: noop, onRallyMove: noop, onSelect: noop, onBackgroundClick: noop, onContext: noop,
    ...over,
  }
  return render(<MissionMap {...props} />)
}

describe('MissionMap and survey items', () => {
  beforeEach(() => {
    created.maps = []
    created.markers = []
    created.deferLoad = false
  })

  it('no badges for an unselected survey; the plain waypoint keeps its draggable badge', () => {
    const { d } = planned()
    renderMap({ draft: d })
    expect(live('rg-wp').map((m) => m.draggable)).toEqual([true])
  })

  it('a selected survey shows its badges, none of them draggable', () => {
    const { d, survey } = planned()
    renderMap({ draft: d, selected: new Set([survey[3]!]) })
    const badges = live('rg-wp')
    expect(badges.length).toBeGreaterThan(2)
    expect(badges.slice(0, -1).every((m) => !m.draggable)).toBe(true)
    expect(badges.at(-1)!.draggable).toBe(true)
  })

  it('a "+" only on the leg leaving the survey', () => {
    const { d, plain } = planned()
    renderMap({ draft: d })
    expect(live('rg-mid')).toHaveLength(1)
    expect(live('rg-mid')[0]!.lngLat[1]).toBeCloseTo((d.items.at(-2)!.lat + d.items.find((it) => it.uid === plain)!.lat) / 2, 9)
  })

  it('3D: feet (position drags) only under plain items', () => {
    const { d } = planned()
    renderMap({ draft: d, terrainTiles: DEM, mode: '3d' })
    expect(live('rg-foot')).toHaveLength(1)
  })
})
