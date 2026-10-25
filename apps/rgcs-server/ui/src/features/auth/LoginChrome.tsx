import type { Dict } from '../../shared/i18n'
import type { Theme } from '../../shared/theme/theme'

interface Props {
  readonly theme: Theme
  readonly dev: boolean
  readonly host: string
  readonly up: boolean
  readonly dict: Dict
}

/** The sign-in screen's top corners: brand + DEV badge on the left; 2D/3D chip (dark) or server pill (light) on the right. */
export function LoginChrome({ theme, dev, host, up, dict }: Props) {
  return (
    <>
      <div className={`ls-brand${theme === 'light' ? ' ls-pill' : ''}`}>
        <span className="ls-logo">RGCS</span>
        {dev && <span className="ls-dev">{dict.devBadge}</span>}
      </div>
      {theme === 'dark' ? (
        // The design's view chip: decoration on this screen (the map mode is chosen inside the app).
        <div className="ls-chips ls-pill" aria-hidden="true">
          <span>2D</span>
          <span className="on">3D</span>
        </div>
      ) : (
        <div className="ls-host ls-pill" title={up ? dict.loginServerUp : dict.loginServerUnknown}>
          <span className={`ls-dot${up ? ' up' : ''}`} aria-hidden="true" />
          <span className="ls-hostname">{host}</span>
        </div>
      )}
    </>
  )
}
