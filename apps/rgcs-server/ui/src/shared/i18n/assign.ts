// Copy for the plan assignment board (spec 2026-10-31).

export const assignJa = {
  asRoverNoTakeoff: 'Rover は離陸のあるプランを走れません',
  asAirNeedsTakeoff: 'この機体は TAKEOFF のないプランを飛べません',
}

export const assignEn: Record<keyof typeof assignJa, string> = {
  asRoverNoTakeoff: 'A rover cannot run a plan that takes off',
  asAirNeedsTakeoff: 'This vehicle cannot fly a plan without a TAKEOFF',
}
