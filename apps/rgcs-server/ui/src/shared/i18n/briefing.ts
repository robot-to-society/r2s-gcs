// Copy for the briefing list (several missions open at once in the planner, spec 2026-10-20 §5.1).

export const briefingJa = {
  bfList: '開いているミッション',
  bfColor: '色',
  bfVehicle: '割当機体',
  bfUnassigned: '未割当',
  bfUnsaved: '未保存の変更があります',
  bfMissing: '見つかりません',
  bfUp: '上へ',
  bfDown: '下へ',
  bfRemove: '一覧から外す',
  bfShow: '表示',
  bfHide: '非表示',
}

export const briefingEn: Record<keyof typeof briefingJa, string> = {
  bfList: 'Open missions',
  bfColor: 'Colour',
  bfVehicle: 'Assigned vehicle',
  bfUnassigned: 'Unassigned',
  bfUnsaved: 'Unsaved changes',
  bfMissing: 'Not found',
  bfUp: 'Move up',
  bfDown: 'Move down',
  bfRemove: 'Remove from list',
  bfShow: 'Show',
  bfHide: 'Hide',
}
