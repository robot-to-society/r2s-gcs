// Copy for the 3D mission editing round (2026-10-19): altitude / position drags and the
// climb-coloured path, listed in the mission map's help panel.

export const edit3dJa = {
  mHelp8k: '3D: 番号・高度チップを上下にドラッグ',
  mHelp8v: '高度だけを変更 (複数選択中は一括)',
  mHelp9k: '3D: 地上の丸をドラッグ',
  mHelp9v: '位置だけを変更 (高度はそのまま)',
  mHelp10k: '3D の経路の色',
  mHelp10v: '上昇角: 水平は水色、急上昇ほど赤 (45° で赤)、下降は紫',
} as const

export const edit3dEn: Record<keyof typeof edit3dJa, string> = {
  mHelp8k: '3D: drag a number / altitude chip up or down',
  mHelp8v: 'Change only the altitude (all selected when multi-selected)',
  mHelp9k: '3D: drag the ground circle',
  mHelp9v: 'Change only the position (altitude kept)',
  mHelp10k: '3D path colour',
  mHelp10v: 'Climb angle: level cyan, steeper climbs redder (red at 45°), descents violet',
}
