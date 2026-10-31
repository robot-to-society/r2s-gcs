// Copy for the plan assignment board (spec 2026-10-31).

export const assignJa = {
  asRoverNoTakeoff: 'Rover は離陸のあるプランを走れません',
  asAirNeedsTakeoff: 'この機体は TAKEOFF のないプランを飛べません',
  // left panel: plan cards
  asPlans: 'プラン',
  asFilterPlans: 'プランを絞り込み',
  asHintDrag: '機体へドラッグ',
  asHintDragRest: 'して割り当てます。タッチは長押ししてから動かします。',
  asHintTap: 'タップで選んで',
  asHintTapRest: 'から機体をタップしても割り当てられます。',
  asHintDouble: 'ダブルクリック',
  asHintDoubleRest: 'で地図を寄せます。',
  asNoPlans: '該当するプランはありません',
  asLoadingPlans: 'プランを読み込み中',
  asAssignedN: '{n} 機に割当',
  asUnassigned: '未割当',
  asDirty: '未保存の変更あり',
  asDirtyWhy: '未保存の変更があります。保存すると割り当てられます',
  asTakesOff: '離陸あり',
  asGround: '地上走行',
}

export const assignEn: Record<keyof typeof assignJa, string> = {
  asRoverNoTakeoff: 'A rover cannot run a plan that takes off',
  asAirNeedsTakeoff: 'This vehicle cannot fly a plan without a TAKEOFF',
  asPlans: 'Plans',
  asFilterPlans: 'Filter plans',
  asHintDrag: 'Drag onto a vehicle',
  asHintDragRest: ' to assign it. On touch, hold, then move.',
  asHintTap: 'Tap to pick',
  asHintTapRest: ' a plan, then tap vehicles to assign it.',
  asHintDouble: 'Double-click',
  asHintDoubleRest: ' to frame it on the map.',
  asNoPlans: 'No plans match',
  asLoadingPlans: 'Loading plans',
  asAssignedN: 'On {n} vehicles',
  asUnassigned: 'Unassigned',
  asDirty: 'Unsaved changes',
  asDirtyWhy: 'This plan has unsaved changes. Save it to assign it',
  asTakesOff: 'Takes off',
  asGround: 'Ground run',
}
