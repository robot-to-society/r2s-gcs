import { describe, expect, it } from 'vitest'
import { applyOthersMode } from './useBriefingOverlay'

function fakeMap(ids: readonly string[]) {
  const vis = new Map<string, string>()
  const m = {
    getLayer: (id: string) => (ids.includes(id) ? { id } : undefined),
    setLayoutProperty: (id: string, _k: string, v: string) => vis.set(id, v),
  }
  return { m: m as never, vis }
}

describe('applyOthersMode', () => {
  it('hides the 2D routes in 3D (the 3D lines replace them) and keeps fence / rally draped', () => {
    const { m, vis } = fakeMap(['briefing-paths', 'briefing-predicted', 'briefing-fence', 'briefing-rally'])
    applyOthersMode(m, true)
    expect(vis.get('briefing-paths')).toBe('none')
    expect(vis.get('briefing-predicted')).toBe('none')
    expect(vis.has('briefing-fence')).toBe(false)
    expect(vis.has('briefing-rally')).toBe(false)
    applyOthersMode(m, false)
    expect(vis.get('briefing-paths')).toBe('visible')
    expect(vis.get('briefing-predicted')).toBe('visible')
  })
  it('does nothing before the layers exist', () => {
    const { m, vis } = fakeMap([])
    applyOthersMode(m, true)
    expect(vis.size).toBe(0)
  })
})
