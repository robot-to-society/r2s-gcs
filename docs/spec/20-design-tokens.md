# RGCS 仕様書 20 — デザイントークン(Glass)

- 版: 0.1(2026-10-16)
- 正本: `design_base/project/RGCS Prototype Glass.dc.html` の `<style>` 先頭 `:root` ブロック
- 実装: `apps/rgcs-server/ui/src/styles/tokens.css` に CSS 変数として移植し、コンポーネントは変数だけを参照する

## 1. 方針

- 地図と映像が主役。UI は薄いすりガラスの計器盤で、色は意味だけを運ぶ。
- 素材は 1 種類(ガラス)、角丸は 2 種類(パネル 18px / コントロール 12px)、影は 1 種類。
- 装飾的な発光・枠線は使わない。区切りは余白と髪線(hairline)。
- 「液体」の動きはセグメントコントロールのレンズ 1 箇所に限定し、`prefers-reduced-motion` で無効化する。

## 2. 色

| トークン | 値 | 用途 |
|---|---|---|
| `--base` | `#11161e` | 地図の無い領域の地色(ログイン、動画、メンテ) |
| `--glass` | `rgba(20,26,34,.56)` | 浮遊パネル素材(`backdrop-filter: blur(22px) saturate(1.35)`) |
| `--glass-strong` | `rgba(18,23,31,.8)` | モーダル・シート(blur 32px) |
| `--line` / `--line-hi` / `--line-soft` | `rgba(255,255,255,.09 / .16 / .06)` | 1px 枠 / 上端ハイライト / 行区切り |
| `--text` / `--text-2` / `--text-3` / `--text-4` | `#f2f5f8` / `#b3bfcc` / `#8a97a5` / `#687582` | 本文 / 補助 / ラベル / プレースホルダ |
| `--accent` | `#9cc9ff` | 操作・選択・プライマリボタン(文字は `--on-accent #0b1b2e`) |
| `--accent-deep` | `#4f8fdc` | 濃色面上のアクセント |
| `--accent-tint` / `--accent-line` | `rgba(156,201,255,.14 / .45)` | 選択行の塗り / 枠 |
| `--caution` | `#f2b544` | 注意・選択中機体・追従チップ(文字 `--on-caution #1f1500`) |
| `--danger` | `#ff6961` | 危険・削除・SD 残量警告 |
| `--rec` | `#e5484d` | REC ピル・録画ボタン ON |
| `--ok` | `#5fd39b` | 正常・ROI・追跡中 |
| `--alt-hi` | `#d8a8ff` | 高度グラデーションの上端(`--accent` → `--alt-hi`) |
| サーマル温度マーカー | 最高 `#ff6961`、最低 `#9cdcff` | 映像オーバーレイのみ |

禁止: ネオンシアン `#00e5ff`、ネイビー面 `#0b1626` 系、`rgba(0,229,255,…)` 枠。

## 3. 書体

| 用途 | 書体 | サイズ / ウェイト |
|---|---|---|
| 本文 | IBM Plex Sans JP(fallback Noto Sans JP, system-ui) | 13px / 400、行間 1.45 |
| 見出し | 同上 | `.h1` 17px / 500、`.h2` 15px / 500 |
| 大きな数値(テレメトリ、ズーム倍率) | 同上 | `.big` 22px / 300、単位 `.unit` 12px / 500 `--text-2` |
| 識別子(MAV_CMD、パラメータ名、IP、RTSP、軸番号) | IBM Plex Mono | 12–13px / 400 |
| 数値全般 | `font-variant-numeric: tabular-nums`(`.num`) | |
| 小ラベル | 11–12px `--text-3` | 全大文字・トラッキングは使わない |

## 4. レイアウト

- ヘッダー: 浮遊ガラスバー(top 10px、高さ 52px、左右 12px)。ナビは 5 ボタンの `.seg.n5`。
- `main.stage` は全面。地図は `inset:0`。パネルは `position:absolute` のフロート。
- CSS 変数: `--aside-w`(296 / rail 60 / mission 320)、`--right-w`(372 / 0 / mission 360)、`--top: 72px`、`--gap: 12px`。
- stage クラス: `mission` `rail` `noright` `video` `maint` `elev` で変数を切替。
- 地図オーバーレイ位置: `.map-l` `.map-r` `.map-r2` `.map-c` `.top1` `.top2`。
- フッターのログは底部中央のピル(`bottom:12px`、`max-width: min(720px, …)`)。
- MapLibre のスケール・帰属は `bottom:60px`(標高シート展開時 272px)。帰属はホバー時のみ展開。
- 地図の `setPadding({top:72,left,right,bottom})` をパネル状態から同期し、追従・カメラ移動を可視領域の中央に合わせる。
- 最小ウィンドウ 1280×720。これより狭い場合は横スクロール(固定レイアウト)。

## 5. 部品クラス(プロトタイプと同名で実装する)

| クラス | 役割 |
|---|---|
| `.g` / `.g-strong` / `.g-ctl` | ガラス 3 種(パネル / モーダル / 小コントロール) |
| `.surface` / `.inset` / `.aurora` | マット面 / 窪み / 背景の淡い光源(動画・メンテ・ログイン) |
| `.btn` `.btn-primary` `.btn-danger` `.btn-ghost` `.btn-sm` `.btn-lg` `.btn-icon` | ボタン |
| `.seg` + `.lens`(`.n3` `.n4` `.n5` `.sm`) | セグメント(レンズが滑る) |
| `.in` `.rg-sel` `.rg-num` `.spin` | 入力 |
| `.pill` `.pill-rec` `.badge` `.dot` `.count` `.chip` `.hint` `.warnbox` `.dev` | 表示 |
| `.vrow` `.wrow` `.secrow` `.tbl`(`.compact`) `.kv` `.form`(`.wide`) | 行・表・フォーム |
| `.cam-strip` `.cam-status` `.rec-btn` `.cam-bar` `.zoom` `.chips` `.trk` `.tmark` `.cam-dial` `.cam-card` `.feed`(`.ir` `.half-l` `.half-r`) | カメラ操作 |
| `.login` `.pop` | ログイン・ユーザーポップオーバー |
| `.rg-mk` `.rg-wp` `.rg-mid` `.rg-tgt` `.rg-roi` `.rg-elev-pt` | 地図マーカー |

## 6. 動き

- `.seg .lens`: `transform .22s cubic-bezier(.2,.8,.2,1)`。
- `.rg-rec` 点滅、`.rg-tgt` パルス、`.cam-dial .pt` の `transform .9s linear`(ジンバル姿勢の補間)は機能表示なので維持。
- それ以外の自動モーションは追加しない。`@media (prefers-reduced-motion: reduce)` で全て無効。

## 7. アクセシビリティ

- `:focus-visible` は 2px `--accent` のアウトライン。
- 文字コントラスト: `--text-3` on `--base` で 4.5:1 以上。`--caution` / `--danger` 文字は 13px 以上。
- 全てのアイコンボタンに `title`(= aria-label)。
- セグメントは `role="radiogroup"`、チップは `aria-pressed`。

## 8. 実装上の注意

- Tailwind 等は使わず、トークン CSS + 部品 CSS(`styles/components.css`)+ 機能ごとの CSS Modules。
- inline style はレイアウト計算値(位置・%・transform)に限定する。色・寸法の inline 指定は禁止。
- 地図のマーカー DOM はトークンの CSS 変数を参照し、色リテラルを持たない(MapLibre レイヤーのペイントだけは `CYAN` / `AMBER` 相当の定数を TS 側で持つ)。
