// Copy added by the 2026-10-26 UI/UX review (labels that say what a control acts on).

export const uxJa = {
  mPickTarget: '書込先の機体を選んでください',
  mWriteTo: '{name} に書き込む',
  mWriteAsk: 'ミッションを書き込みますか?',
  mWriteReplaces: '機体に入っているミッションは置き換えられます。',
  mWriteGo: '書き込む',
  armedState: 'アーム中',
  disarmedState: 'ディスアーム',
  groupDrive: '走行',
} as const

export const uxEn: Record<keyof typeof uxJa, string> = {
  mPickTarget: 'Choose the vehicle to write to',
  mWriteTo: 'Write to {name}',
  mWriteAsk: 'Write this mission?',
  mWriteReplaces: 'The mission on the vehicle will be replaced.',
  mWriteGo: 'Write',
  armedState: 'ARMED',
  disarmedState: 'Disarmed',
  groupDrive: 'Drive',
}
