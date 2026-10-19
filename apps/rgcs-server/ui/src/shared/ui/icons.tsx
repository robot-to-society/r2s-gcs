// Icons (spec 20 §9, 2026-10-18): Lucide everywhere, with the prototype's names; only the
// multicopter is custom. This file is the single import point so components keep `Icon*` names.
import type { LucideIcon } from 'lucide-react'
import {
  ArrowDownToLine,
  ArrowDownWideNarrow,
  ArrowUpDown,
  ArrowUpToLine,
  BotMessageSquare,
  Camera,
  Car,
  ChartArea,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleCheck,
  Crosshair,
  Ellipsis,
  Gauge,
  Grip,
  History,
  House,
  Info,
  Layers,
  ListChecks,
  LocateFixed,
  Map as MapIcon,
  Maximize,
  Minimize,
  Minus,
  MonitorPlay,
  Network,
  OctagonX,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Pin,
  Play,
  Plus,
  Power,
  PowerOff,
  Repeat,
  Route,
  Search,
  Settings,
  StepForward,
  TriangleAlert,
  User,
  Wrench,
  X,
} from 'lucide-react'

interface IconProps {
  readonly size?: number
  readonly className?: string
}

/** A Lucide icon with the prototype's `.ic` class. */
function Lucide({ icon: Icon, size, className }: { readonly icon: LucideIcon; readonly size: number; readonly className?: string }) {
  return <Icon size={size} strokeWidth={2} className={className ? `ic ${className}` : 'ic'} aria-hidden="true" />
}

// Navigation (20 px) and chrome.
export const IconMap = ({ size = 20, className }: IconProps) => <Lucide icon={MapIcon} size={size} className={className} />
export const IconVideo = ({ size = 20, className }: IconProps) => <Lucide icon={MonitorPlay} size={size} className={className} />
export const IconMission = ({ size = 20, className }: IconProps) => <Lucide icon={Route} size={size} className={className} />
export const IconNetwork = ({ size = 20, className }: IconProps) => <Lucide icon={Network} size={size} className={className} />
export const IconChat = ({ size = 20, className }: IconProps) => <Lucide icon={BotMessageSquare} size={size} className={className} />
export const IconGear = ({ size = 20, className }: IconProps) => <Lucide icon={Settings} size={size} className={className} />
export const IconUser = ({ size = 18, className }: IconProps) => <Lucide icon={User} size={size} className={className} />
export const IconClose = ({ size = 20, className }: IconProps) => <Lucide icon={X} size={size} className={className} />
export const IconCollapse = ({ size = 18, className }: IconProps) => <Lucide icon={PanelLeftClose} size={size} className={className} />
export const IconMenu = ({ size = 18, className }: IconProps) => <Lucide icon={PanelLeftOpen} size={size} className={className} />
export const IconChevron = ({ size = 18, className }: IconProps) => <Lucide icon={ChevronRight} size={size} className={className} />
export const IconChevronUp = ({ size = 16, className }: IconProps) => <Lucide icon={ChevronUp} size={size} className={className} />
export const IconChevronDown = ({ size = 16, className }: IconProps) => <Lucide icon={ChevronDown} size={size} className={className} />
export const IconCheck = ({ size = 16, className }: IconProps) => <Lucide icon={CircleCheck} size={size} className={className} />
export const IconClock = ({ size = 22, className }: IconProps) => <Lucide icon={History} size={size} className={className} />
export const IconHistory = ({ size = 22, className }: IconProps) => <Lucide icon={History} size={size} className={className} />
export const IconWrench = ({ size = 22, className }: IconProps) => <Lucide icon={Wrench} size={size} className={className} />
export const IconCamera = ({ size = 18, className }: IconProps) => <Lucide icon={Camera} size={size} className={className} />
export const IconMaximize = ({ size = 16, className }: IconProps) => <Lucide icon={Maximize} size={size} className={className} />
export const IconMinimize = ({ size = 16, className }: IconProps) => <Lucide icon={Minimize} size={size} className={className} />
export const IconSearch = ({ size = 16, className }: IconProps) => <Lucide icon={Search} size={size} className={className} />
export const IconSpeed = ({ size = 15, className }: IconProps) => <Lucide icon={Gauge} size={size} className={className} />
export const IconFollow = ({ size = 13, className }: IconProps) => <Lucide icon={LocateFixed} size={size} className={className} />
export const IconRover = ({ size = 22, className }: IconProps) => <Lucide icon={Car} size={size} className={className} />
export const IconWarn = ({ size = 18, className }: IconProps) => <Lucide icon={TriangleAlert} size={size} className={className} />
export const IconPin = ({ size = 18, className }: IconProps) => <Lucide icon={Pin} size={size} className={className} />
export const IconGrid = ({ size = 22, className }: IconProps) => <Lucide icon={Grip} size={size} className={className} />
export const IconHeading = ({ size = 14, className }: IconProps) => <Lucide icon={ArrowUpToLine} size={size} className={className} />
export const IconHouse = ({ size = 16, className }: IconProps) => <Lucide icon={House} size={size} className={className} />
export const IconMinus = ({ size = 16, className }: IconProps) => <Lucide icon={Minus} size={size} className={className} />
export const IconPlus = ({ size = 16, className }: IconProps) => <Lucide icon={Plus} size={size} className={className} />

export const IconLayers = ({ size = 18, className }: IconProps) => <Lucide icon={Layers} size={size} className={className} />
export const IconBits = ({ size = 16, className }: IconProps) => <Lucide icon={ListChecks} size={size} className={className} />

// Severity (spec 10 §1): info / ok / warn / error.
export const IconInfo = ({ size = 16, className }: IconProps) => <Lucide icon={Info} size={size} className={className} />
export const IconOk = ({ size = 16, className }: IconProps) => <Lucide icon={CircleCheck} size={size} className={className} />
export const IconError = ({ size = 16, className }: IconProps) => <Lucide icon={OctagonX} size={size} className={className} />

// Commands (spec 20 §9).
export const IconPause = ({ size = 18, className }: IconProps) => <Lucide icon={Pause} size={size} className={className} />
export const IconPlay = ({ size = 18, className }: IconProps) => <Lucide icon={Play} size={size} className={className} />
export const IconStepForward = ({ size = 18, className }: IconProps) => <Lucide icon={StepForward} size={size} className={className} />
export const IconLand = ({ size = 18, className }: IconProps) => <Lucide icon={ArrowDownToLine} size={size} className={className} />
export const IconCrosshair = ({ size = 18, className }: IconProps) => <Lucide icon={Crosshair} size={size} className={className} />
export const IconAltitude = ({ size = 18, className }: IconProps) => <Lucide icon={ArrowUpDown} size={size} className={className} />
export const IconRepeat = ({ size = 18, className }: IconProps) => <Lucide icon={Repeat} size={size} className={className} />
export const IconPower = ({ size = 18, className }: IconProps) => <Lucide icon={Power} size={size} className={className} />
export const IconPowerOff = ({ size = 18, className }: IconProps) => <Lucide icon={PowerOff} size={size} className={className} />
export const IconEllipsis = ({ size = 18, className }: IconProps) => <Lucide icon={Ellipsis} size={size} className={className} />

/** Multicopter: not in Lucide; the prototype's `#i-drone` (24 grid, stroke 2). */
export const IconCopter = ({ size = 22, className }: IconProps) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className ? `ic ${className}` : 'ic'}
    aria-hidden="true"
  >
    <path d="M10 10 7 7" />
    <path d="m14 10 3-3" />
    <path d="m14 14 3 3" />
    <path d="m10 14-3 3" />
    <rect x="9.5" y="9.5" width="5" height="5" rx="1.2" />
    <circle cx="5.5" cy="5.5" r="3" />
    <circle cx="18.5" cy="5.5" r="3" />
    <circle cx="5.5" cy="18.5" r="3" />
    <circle cx="18.5" cy="18.5" r="3" />
  </svg>
)

/** Link-quality bars (the vehicle row's own glyph in the prototype, not a Lucide icon). */
export const IconSignal = ({ size = 18, top = 'var(--text-3)' }: IconProps & { readonly top?: string }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="var(--text-3)" aria-hidden="true">
    <rect x="2" y="16" width="3" height="6" />
    <rect x="7" y="12" width="3" height="10" />
    <rect x="12" y="8" width="3" height="14" />
    <rect x="17" y="4" width="3" height="18" fill={top} />
  </svg>
)
export const IconElevation = ({ size = 20, className }: IconProps) => <Lucide icon={ChartArea} size={size} className={className} />
export const IconSortAlerts = ({ size = 18, className }: IconProps) => <Lucide icon={ArrowDownWideNarrow} size={size} className={className} />
