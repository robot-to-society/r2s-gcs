import type { LatLon } from '../mission/geo'

export type KmlErrorCode = 'not_kml' | 'no_polygon'

export class KmlError extends Error {
  readonly code: KmlErrorCode
  constructor(code: KmlErrorCode) {
    super(code)
    this.name = 'KmlError'
    this.code = code
  }
}

export interface KmlPolygon {
  name: string
  ring: LatLon[]
}

export interface KmlResult {
  polygons: KmlPolygon[]
  holesIgnored: boolean
}

const NS = '*'

function parseCoordinates(text: string): LatLon[] {
  const ring = text
    .trim()
    .split(/\s+/)
    .map((tuple) => tuple.split(',').map(Number))
    .filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat))
    .map(([lon, lat]) => ({ lat, lon }))
  const first = ring[0]
  const last = ring[ring.length - 1]
  const closed = ring.length > 1 && first.lat === last.lat && first.lon === last.lon
  return closed ? ring.slice(0, -1) : ring
}

function outerRing(polygon: Element): LatLon[] {
  const outer = polygon.getElementsByTagNameNS(NS, 'outerBoundaryIs')[0]
  const coords = outer?.getElementsByTagNameNS(NS, 'coordinates')[0]
  return coords?.textContent ? parseCoordinates(coords.textContent) : []
}

function placemarkName(polygon: Element): string | null {
  const placemark = polygon.closest('Placemark') ?? findAncestor(polygon, 'Placemark')
  if (!placemark) return null
  const name = Array.from(placemark.children).find((c) => c.localName === 'name')
  return name?.textContent?.trim() || null
}

function findAncestor(el: Element, localName: string): Element | null {
  for (let p = el.parentElement; p; p = p.parentElement) if (p.localName === localName) return p
  return null
}

export function parseKmlPolygons(text: string): KmlResult {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  const root = doc.documentElement
  if (!root || doc.getElementsByTagName('parsererror').length > 0 || root.localName !== 'kml') {
    throw new KmlError('not_kml')
  }
  const polygons: KmlPolygon[] = []
  let holesIgnored = false
  Array.from(doc.getElementsByTagNameNS(NS, 'Polygon')).forEach((polygon) => {
    const ring = outerRing(polygon)
    if (ring.length < 3) return
    if (polygon.getElementsByTagNameNS(NS, 'innerBoundaryIs').length > 0) holesIgnored = true
    polygons.push({ name: placemarkName(polygon) ?? `エリア ${polygons.length + 1}`, ring })
  })
  if (polygons.length === 0) throw new KmlError('no_polygon')
  return { polygons, holesIgnored }
}
