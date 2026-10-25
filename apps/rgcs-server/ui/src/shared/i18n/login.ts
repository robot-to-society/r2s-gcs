// Copy for the sign-in screen, its cloud transition and the 表示 (theme) setting (2026-10-25).

export const loginJa = {
  loginServer: 'SERVER',
  loginSubtitle: '直射日光の下でも読みやすく。',
  loginSigningIn: 'サインイン中…',
  loginSignedIn: 'サインインしました',
  loginCredit: '出典: 国土地理院(シームレス空中写真)',
  loginServerUp: 'サーバー稼働中',
  loginServerUnknown: 'サーバー状態不明',
  themeTitle: '表示',
  themeAuto: '自動',
  themeDark: 'ダーク',
  themeLight: 'ライト',
  themeNote: '自動は OS の設定に従います。ライトはログイン画面に適用され、アプリ本体は常にダーク表示です。',
}

export const loginEn: Record<keyof typeof loginJa, string> = {
  loginServer: 'SERVER',
  loginSubtitle: 'Readable in direct sunlight.',
  loginSigningIn: 'Signing in…',
  loginSignedIn: 'Signed in',
  loginCredit: '出典: 国土地理院(シームレス空中写真)',
  loginServerUp: 'Server up',
  loginServerUnknown: 'Server status unknown',
  themeTitle: 'Appearance',
  themeAuto: 'Auto',
  themeDark: 'Dark',
  themeLight: 'Light',
  themeNote: 'Auto follows the OS setting. Light applies to the sign-in screen; the app itself always stays dark.',
}
