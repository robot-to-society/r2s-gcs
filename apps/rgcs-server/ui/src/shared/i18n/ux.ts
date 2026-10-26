// Copy added by the 2026-10-26 UI/UX review (labels that say what a control acts on).

export const uxJa = {
  mPickTarget: '書込先の機体を選んでください',
} as const

export const uxEn: Record<keyof typeof uxJa, string> = {
  mPickTarget: 'Choose the vehicle to write to',
}
