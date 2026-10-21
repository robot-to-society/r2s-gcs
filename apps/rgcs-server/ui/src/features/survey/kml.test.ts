/// <reference types="node" />
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { KmlError, parseKmlPolygons } from './kml'

const fixture = (name: string): string =>
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../../../../tests/fixtures/survey', name), 'utf8')
const areaKml = fixture('area.kml')
const twoKml = fixture('two-areas.kml')
const holeKml = fixture('hole.kml')
const notKml = fixture('not-kml.txt')

describe('parseKmlPolygons', () => {
  it('reads one ring, drops the closing vertex and keeps lon,lat order', () => {
    const { polygons, holesIgnored } = parseKmlPolygons(areaKml)
    expect(holesIgnored).toBe(false)
    expect(polygons).toHaveLength(1)
    expect(polygons[0].name).toBe('河原エリア')
    expect(polygons[0].ring).toHaveLength(5)
    expect(polygons[0].ring[0]).toEqual({ lat: 36.25, lon: 137.64 })
    expect(polygons[0].ring[2]).toEqual({ lat: 36.254, lon: 137.646 })
  })

  it('reads several placemarks and falls back to エリア N', () => {
    const { polygons } = parseKmlPolygons(twoKml)
    expect(polygons.map((p) => p.name)).toEqual(['北エリア', 'エリア 2'])
    expect(polygons[1].ring).toHaveLength(4)
  })

  it('ignores holes and reports it', () => {
    const { polygons, holesIgnored } = parseKmlPolygons(holeKml)
    expect(holesIgnored).toBe(true)
    expect(polygons).toHaveLength(1)
    expect(polygons[0].ring).toHaveLength(4)
    expect(polygons[0].ring[0]).toEqual({ lat: 36.25, lon: 137.64 })
  })

  it('throws not_kml for text that is not KML', () => {
    expect(() => parseKmlPolygons(notKml)).toThrow(KmlError)
    try {
      parseKmlPolygons(notKml)
    } catch (e) {
      expect((e as KmlError).code).toBe('not_kml')
    }
  })

  it('throws no_polygon for a KML with only a LineString', () => {
    const line = `<kml xmlns="http://www.opengis.net/kml/2.2"><Placemark><LineString><coordinates>137.64,36.25,0 137.65,36.26,0</coordinates></LineString></Placemark></kml>`
    try {
      parseKmlPolygons(line)
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(KmlError)
      expect((e as KmlError).code).toBe('no_polygon')
    }
  })
})
