// 「KML から読み込む」: the hidden file input the palette clicks, the inline chooser when the file
// holds several polygons, and the reason a file could not be used.
import { useState, type RefObject } from 'react'
import type { Dict } from '../../shared/i18n'
import { readFileText } from '../mission/files'
import type { LatLon } from '../mission/geo'
import { KmlError, parseKmlPolygons, type KmlErrorCode, type KmlPolygon } from './kml'

interface Props {
  readonly inputRef: RefObject<HTMLInputElement | null>
  readonly dict: Dict
  readonly onPolygon: (ring: readonly LatLon[], name: string) => void
}

const ERROR_TEXT: Readonly<Record<KmlErrorCode, keyof Dict>> = {
  not_kml: 'svKmlNotKml',
  no_polygon: 'svKmlNoPolygon',
  bad_coordinates: 'svKmlBadCoordinates',
  too_large: 'svKmlTooLarge',
}

async function readKml(file: File): Promise<{ polygons: KmlPolygon[]; holesIgnored: boolean }> {
  try {
    return parseKmlPolygons(await readFileText(file))
  } catch (e) {
    throw e instanceof KmlError ? e : new KmlError('not_kml')
  }
}

export function KmlPick({ inputRef, dict, onPolygon }: Props) {
  const [choices, setChoices] = useState<readonly KmlPolygon[] | null>(null)
  const [holes, setHoles] = useState(false)
  const [error, setError] = useState<KmlErrorCode | null>(null)

  const load = async (file: File) => {
    setChoices(null)
    setHoles(false)
    setError(null)
    try {
      const { polygons, holesIgnored } = await readKml(file)
      setHoles(holesIgnored)
      const only = polygons.length === 1 ? polygons[0] : undefined
      if (only) onPolygon(only.ring, only.name)
      else setChoices(polygons)
    } catch (e) {
      setError(e instanceof KmlError ? e.code : 'not_kml')
    }
  }
  const pick = (p: KmlPolygon) => {
    setChoices(null)
    onPolygon(p.ring, p.name)
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".kml,application/vnd.google-earth.kml+xml"
        style={{ display: 'none' }}
        data-testid="survey-kml-file"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void load(file)
        }}
      />
      {error && (
        <div className="hint caution sv-draw" role="alert">
          {dict[ERROR_TEXT[error]]}
        </div>
      )}
      {holes && <div className="hint sv-draw t3">{dict.svKmlHoles}</div>}
      {choices && (
        <div className="sv-draw sv-kml-choose">
          <div className="row" style={{ gap: 8 }}>
            <span className="t2">{dict.svKmlChoose}</span>
            <div className="grow" />
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setChoices(null)}>
              {dict.svDrawCancel}
            </button>
          </div>
          <div role="list" aria-label={dict.svKmlChoose} className="sv-kml-list">
            {choices.map((p, i) => (
              <div role="listitem" key={`${i}-${p.name}`}>
                <button type="button" className="btn btn-sm sv-kml-item" onClick={() => pick(p)}>
                  <span className="ell">{p.name}</span>
                  <span className="t3 num">{dict.svDrawCount.replace('{n}', String(p.ring.length))}</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
