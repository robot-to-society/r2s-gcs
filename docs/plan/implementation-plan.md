# RGCS 実装プラン

- 版: 0.2(2026-10-17)。0.1(2026-10-16)を年末デモ向けに並べ直した。差分は §7。
- 仕様: `../spec/00-overview.md` 〜 `70-safety-auth.md` + 設計追補 `../superpowers/specs/2026-10-17-year-end-demo-design.md`(矛盾時は追補が優先)。デザイン正本: `design_base/project/RGCS Prototype Glass.dc.html`
- 詳細な実行プラン(タスク・テスト・コミット単位)はフェーズ開始時に `../superpowers/plans/` に 1 本ずつ書く。P1 は `2026-10-17-p1-close-m1.md`。
- 開発規約: 不変データ(破壊的更新をしない)、1 ファイル 200–400 行(最大 800)、関数 50 行未満、TDD(先に赤)、カバレッジ 80% 以上、conventional commits、`console.log` 禁止、秘密情報をコードに置かない、入力は zod / `TryFrom` で検証

## 1. ゴール(2026 年 12 月下旬のデモ)

MT11 を載せた ArduCopter を操作者一人で運用する。前日に RGCS の地図で組んだミッションで自動飛行し、操作者はカメラに集中する。外部モニターに観客向けの映像 + 小地図 + ロゴを出し、**その映像は何があっても止まらない**。飛行前点検と飛行後のログ取り出しを国交省の飛行日誌 3 様式として出力する。詳細は設計追補 §1〜§4。

## 2. 前提と判断

| 判断 | 内容 | 根拠 |
|---|---|---|
| Pi スタンドアローン先行 | 機体側 companion Pi の `rgcs-server` 1 プロセス + ブラウザ UI。1 Pi = 1 機体 | 最初の現場が MT11 1 台構成 |
| **ミッションを M4 → P3 に前倒し** | 2D 作成、`.waypoints` 書き出し、機体往復、AUTO 開始、進捗表示 | デモは自動飛行(追補 §5.2) |
| **観客用画面を新設** | `/present`: 映像 + 小地図 + ロゴ、トークン保護、別 WHEP セッション、最終フレーム保持 | 本人の最重要要件(追補 §5.1) |
| **飛行日誌を新設** | 点検テンプレート、日常点検、飛行記録(ARM/DISARM から下書き)、点検整備、ログ取り出し、PDF / CSV | 国交省 3 様式(追補 §5.5–5.6) |
| **全パラメータ検索** | 全件テーブル + 検索 + 変更セット書込。セクション表示は後送り | 当日の現場調整(追補 §5.4) |
| MT11 は Rust 移植 | デモ版は ジンバル速度 / センター / ズーム / 録画 / 写真 / 映像タイプ / 状態 に絞る。trait と caps は仕様通り | 期限(追補 §5.3) |
| ログイン = オペレータ | admin/admin シード → M5 でアカウント管理 | 変更なし |
| ジョイスティックはブラウザ側 | Gamepad API → WS 20 Hz、デッドマン必須 | 変更なし |
| 映像は MediaMTX パススルー | Pi で再エンコードしない | 変更なし。観客用の安定性にも直結 |
| フロントは React + TS(Vite) | 機能単位ストア + WS 差分 | 変更なし |
| **SITL はローカルバイナリ** | `scripts/dev.sh` で SITL + server + Vite を起動。docker-compose は作らない | Mac 上で即起動できる |
| 地図タイル | `config.toml` の `map_tile_url`(既定 OSM ラスタ)。衛星画像は現場の契約に合わせて差し替え | 期限内に権利関係を抱えない |

## 3. ロードマップ(10 週: 2026-10-20 → 12-26)

| フェーズ | 期間 | 内容 | 出荷 / 合格 |
|---|---|---|---|
| **P1 M1 を閉じる** | 10/20–11/05(2.5 週) | 週 2 バックエンドをコミット、認証統合テスト、UI: ログイン / ヘッダー / ポップオーバー / フッター / 全コマンド / 確認、MapLibre 地図 + マーカー + 航跡 + 追従、右パネル詳細 + STATUSTEXT、Guided、Playwright、SITL 受入 | admin/admin → SITL を確認付き ARM → 監査行 → フッター。追従 ±4 px。LinkLost で 503 |
| **P2 カメラ・映像・観客用** | 11/06–11/26(3 週) | `rgcs-camera`(trait、caps、siyi 絞込実装、none)、MT11 疑似サーバー、`rgcs-video` WHEP 中継 + 統計、UI: 右パネル映像 + カメラ帯 + 操作卓、ゲームパッド → `gimbal_rate` + デッドマン、**`/present`**(トークン、ロゴ、小地図、最終フレーム保持)、設定: ロゴ / トークン | 操作者が全操作を一巡しても `/present` が止まらない(自動化 + 手動) |
| **P3 ミッション**(実装済 2026-10-18、`docs/superpowers/plans/2026-10-17-p3-mission.md`) | 11/27–12/10(2 週) | `rgcs-mission`(Mission Protocol 状態機械、`.waypoints` 読み書き、検証)、`missions` テーブル、UI: 2D 作成(一覧 / 地図編集 / パラメータ / サマリー / Undo・Redo)、書込・読込・開始、運用マップの経路 + 現在 WP | SITL に 20 WP 往復一致、`.waypoints` を Mission Planner が読む、AUTO で動く |
| **P4 パラメータ**(実装済 2026-10-18、`docs/superpowers/plans/2026-10-18-p4-params.md`) | 12/11–12/12(0.5 週)※P3 と並行可 | PARAM 全件取得 + キャッシュ + 進捗(欠番は index 読みで補完)、メタデータ同梱(`apm.pdef.json` → `public/params/arducopter.json`)、UI: 全件テーブル + 検索 + 変更セット + 確認 + 書戻し検証 + 履歴 | 1,000 件超を検索 → 変更 → `param_history`(`tests/sitl/accept-params.sh`) |
| **P5 点検・飛行日誌**(実装済 2026-10-18、`docs/superpowers/plans/2026-10-18-p5-logbook.md`) | 12/01–12/19(並行ストリーム、2.5 週) | 台帳列(機体 / 操縦者)、点検テンプレート + 実施、飛行検出(ARM → DISARM)+ 飛行記録下書き、不具合記事、点検整備記録、ログ取り出し(LOG_REQUEST_*)、PDF(Noto Sans JP 同梱)/ CSV、UI: 日常点検 / 飛行日誌タブ、アプリ設定(台帳・テンプレート) | 様式 1 / 2 / 3 の PDF と CSV。SITL 飛行で下書き自動生成 |
| **P6 配備・リハーサル** | 12/08–12/12 リハ 1、12/22–12/26 リハ 2 + 修正 | `cross` aarch64(CI 済)、`include_dir` で UI 埋め込み、`deploy/install.sh`、実 Pi + 実 FC + MT11、LTE 越し、修正週 | リハ 1: 飛行 + 映像 + 観客用。リハ 2: 全シナリオ(追補 §4) |

**並行の前提**: P5 は P3 / P4 と触る層が重ならない(store + UI + 独立したログ取り出し)ので、`superpowers:subagent-driven-development` で別ワークツリーのストリームとして走らせる。単線で進める場合は P5 が 12/26 を超えるため、その時は PDF 出力を CSV のみに縮退し PDF をデモ後に送る(本人判断)。

**余白**: 実質 1 週(12/22–26 の修正週)。P2 の観客用安定化が遅れた場合は P3 の Undo / Redo と右クリックメニューを削る。

## 4. P1 の要点(詳細は `../superpowers/plans/2026-10-17-p1-close-m1.md`)

1. 未コミットの週 2 バックエンド(auth / sessions / lockout / confirm / queue / audit、86 テスト緑)をコミット。
2. `rgcs-server` を lib + bin に分け、`tests/` に認証・コマンドの統合テスト(401 / 403 / 429 / 409 / 503)。
3. UI: API クライアント(CSRF ヘッダ、封筒解釈、401 → ログインへ)、認証ストア、ログイン画面、ヘッダー 5 ナビ、ユーザーポップオーバー、フッターのログピル。
4. UI: 全コマンドシート + 確認ダイアログ(`POST confirm` → `confirm_token` → `POST command`)。
5. 地図: MapLibre ラスタ、`.rg-mk` マーカー、航跡 600 点、追従 + `setPadding` 同期。
6. 右パネル詳細(映像未接続、テレメトリ 3 列、タイル 3 つ、メッセージ + 確認)。STATUSTEXT(チャンク結合)と CommsDelay / LinkLost を `vehicle_message` に。
7. Guided: `SET_POSITION_TARGET_GLOBAL_INT`、GUIDED でなければ 409、`FENCE_ALT_MAX` 既知なら上限拒否、初回のみ確認。
8. Playwright(ログイン → 一覧 → ポップオーバー → ログアウト。SITL ありの拡張はローカル)、`tests/sitl/accept-m1.sh`、CI に e2e ジョブ。
9. 仕様書の同期(10 §7 タブ、50 / 60 の追加、00 §7 の決定)。

## 5. P2〜P5 の設計上の席(P1 で壊さないこと)

- `AppState` にカメラ・映像・プレゼンのハンドルを足せるよう、`AppState::new` の引数は構造体化しない(フィールド追加で済む)。
- `ServerMessage` は `#[serde(tag = "t")]` の追加のみで拡張(`camera_state`, `mission_progress`, `log_fetch_progress`, `flight_draft_created`)。既存バリアントの形は変えない。
- UI の `features/<name>/` 1 機能 1 ディレクトリ、`index.ts` で公開。`view` は `'ops'|'video'|'mission'|'ai'|'maint'|'present'` の union を P1 で定義し、未実装はナビで無効化。
- `Router` の `RouterEvent` に `Statustext` と `ParamValue` を P1 で足す(P4 / P5 が使う)。
- `vehicles` / `users` テーブルの列追加はマイグレーション `0002_` 以降で行う(P5)。`0001_init.sql` は触らない。

## 6. テスト戦略

| 層 | 対象 | 手段 |
|---|---|---|
| 単体 | 型・パーサ・エンコーダ・状態機械・reducer・フォーマット | `cargo test` / `vitest` |
| 統合 | 認証、API エラー経路、WS 契約、コマンド → 監査、Mission Protocol(MT11 疑似サーバーと SITL) | `cargo test --test`(in-memory store + 疑似 Router)、`tests/sitl/*.sh` |
| E2E | ログイン → 一覧 → 詳細 → コマンド(確認)→ ログアウト、`/present` 連続再生 | Playwright(CI は SITL なし、ローカルは `scripts/dev.sh --built`) |
| 受入 | 各フェーズの合格条件(§3)、リハーサル 2 回 | 手動 + スクリプト |

## 7. 0.1 からの変更

- ロードマップを M1〜M5 から P1〜P6(10 週)に差し替え。ミッションを 4 番目から 3 番目へ、パラメータ全件検索を新設、観客用画面と飛行日誌を新設。
- デモ後送り: ROI 制御器、サーマル温度、AI 追跡、時刻同期 / SD / 自動録画、機体操作ジョイスティック、3D / 地形 / 標高プロファイル、edge / hub、アカウント管理、AI チャット、ログ AI 解析、Tauri、MAVLink 署名、英語の完成。
- SITL は docker ではなくローカルバイナリ(`scripts/dev.sh`)。
- 詳細プランは本書から `docs/superpowers/plans/` に分離(本書はロードマップと判断のみ)。
