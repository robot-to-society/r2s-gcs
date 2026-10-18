// Line icons copied from the Glass prototype (24-unit viewBox, 2 px stroke). Keep them tiny: one path set each.
import type { ReactNode } from 'react'

interface IconProps {
  readonly size?: number
  readonly className?: string
}

function line(children: ReactNode, size: number, className?: string, strokeWidth = 2) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} className={className} aria-hidden="true">
      {children}
    </svg>
  )
}

export const IconMap = ({ size = 20, className }: IconProps) => line(<><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" /><path d="M9 4v14M15 6v14" /></>, size, className)
export const IconVideo = ({ size = 20, className }: IconProps) => line(<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M8 5v14M16 5v14M3 10h5M3 14h5M16 10h5M16 14h5" /></>, size, className)
export const IconMission = ({ size = 20, className }: IconProps) => line(<><circle cx="5" cy="19" r="2.5" /><circle cx="19" cy="5" r="2.5" /><circle cx="12" cy="12" r="2" /><path d="M7 17.5l3.5-4M13.5 10.5L17 7" /></>, size, className)
export const IconChat = ({ size = 20, className }: IconProps) => line(<path d="M4 5h16v11H9l-5 4z" />, size, className)
export const IconGear = ({ size = 20, className }: IconProps) => line(<><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" /></>, size, className)
export const IconUser = ({ size = 18, className }: IconProps) => line(<><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></>, size, className)
export const IconClose = ({ size = 20, className }: IconProps) => line(<path d="M6 6l12 12M18 6L6 18" />, size, className)
export const IconCollapse = ({ size = 18, className }: IconProps) => line(<path d="M15 5l-7 7 7 7" />, size, className)
export const IconMenu = ({ size = 18, className }: IconProps) => line(<path d="M4 6h16M4 12h16M4 18h16" />, size, className)
export const IconChevron = ({ size = 18, className }: IconProps) => line(<path d="M9 5l7 7-7 7" />, size, className)
export const IconCheck = ({ size = 16, className }: IconProps) => line(<path d="M5 12l5 5 9-10" />, size, className, 2.5)
export const IconClock = ({ size = 22, className }: IconProps) => line(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>, size, className)
export const IconWrench = ({ size = 22, className }: IconProps) => line(<><path d="M14.7 6.3a4 4 0 0 0 5 5L10 21l-3-3L16.7 7.3z" /><path d="M14.7 6.3L17 4a4 4 0 0 1 3 3l-2.3 2.3" /></>, size, className)
export const IconCamera = ({ size = 18, className }: IconProps) => line(<><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></>, size, className)
export const IconMaximize = ({ size = 16, className }: IconProps) => line(<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />, size, className)
export const IconSearch = ({ size = 16, className }: IconProps) => line(<><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></>, size, className)
export const IconSpeed = ({ size = 15, className }: IconProps) => line(<><path d="M4 16a8 8 0 0 1 16 0" /><path d="M12 16l4-5" /></>, size, className)
export const IconFollow = ({ size = 13, className }: IconProps) => line(<><circle cx="12" cy="12" r="6" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /></>, size, className, 2.2)
export const IconCopter = ({ size = 22, className }: IconProps) => line(<><path d="M5 5l4 4M19 5l-4 4M5 19l4-4M19 19l-4-4" /><circle cx="12" cy="12" r="3" /><circle cx="5" cy="5" r="2" /><circle cx="19" cy="5" r="2" /><circle cx="5" cy="19" r="2" /><circle cx="19" cy="19" r="2" /></>, size, className)
export const IconRover = ({ size = 22, className }: IconProps) => line(<><path d="M3 13l2-5h14l2 5v5H3z" /><circle cx="7" cy="17" r="1.5" /><circle cx="17" cy="17" r="1.5" /></>, size, className)
export const IconWarn = ({ size = 18, className }: IconProps) => line(<><path d="M12 3l10 18H2z" /><path d="M12 10v5M12 18v.5" /></>, size, className)

/** Filled glyphs. */
export const IconPin = ({ size = 18 }: IconProps) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
    <path d="M9 3h6l-1 7 3 3v1H7v-1l3-3z" />
    <path d="M11 14h2v7h-2z" />
  </svg>
)
export const IconGrid = ({ size = 22 }: IconProps) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
    {[6, 12, 18].flatMap((y) => [6, 12, 18].map((x) => <circle key={`${x}${y}`} cx={x} cy={y} r="2" />))}
  </svg>
)
export const IconHeading = ({ size = 14 }: IconProps) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" style={{ opacity: 0.7 }} aria-hidden="true">
    <path d="M12 4l7 16H5z" />
  </svg>
)
export const IconSignal = ({ size = 18, top = 'var(--text-3)' }: IconProps & { readonly top?: string }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="var(--text-3)" aria-hidden="true">
    <rect x="2" y="16" width="3" height="6" />
    <rect x="7" y="12" width="3" height="10" />
    <rect x="12" y="8" width="3" height="14" />
    <rect x="17" y="4" width="3" height="18" fill={top} />
  </svg>
)
