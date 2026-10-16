# RGCS 実装プラン

- 版: 0.1(2026-10-16)
- 仕様: `../spec/00-overview.md` 〜 `70-safety-auth.md`。デザイン正本: `design_base/project/RGCS Prototype Glass.dc.html`
- 開発規約: 不変データ(破壊的更新をしない)、1 ファイル 200–400 行(最大 800)、関数 50 行未満、TDD(先に赤)、カバレッジ 80% 以上、conventional commits、`console.log` 禁止、秘密情報をコードに置かない、入力は zod / `TryFrom` で検証

## 1. 前提と判断

| 判断 | 内容 | 根拠 |
|---|---|---|
| Pi スタンドアローン先行 | 機体側 companion Pi の `rgcs-server` 1 プロセス + ブラウザ UI。1 Pi = 1 機体 | 最初の現場が MT11 1 台構成で、Python 版を 1 サービスで置き換えたい |
| MT11 は Rust 移植 | `rgcs-camera::siyi`。Python 版のテストを正解データに | Pi 上に 2 サービスを残さない。機能追加を 1 箇所にする |
| ログイン = オペレータ | モック admin/admin → M5 でアカウント管理 | クラウド版で自然に置換できる |
| ジョイスティックはブラウザ側 | Gamepad API → WS 20 Hz。`gilrs` 不使用 | デバイスは操作者 PC に接続される |
| 映像は MediaMTX パススルー | Pi で GStreamer を動かさない | Pi の CPU と Python 版での実績 |
| Tauri は後送り | `apps/rgcs-desktop` は席だけ | UI は同一。デスクトップ殻は価値が小さい |
| フロントは React + TS(Vite) | 状態は機能単位ストア + WS 差分 | プロトタイプの構造をそのまま移せる |

## 2. ワークスペースの初期構成

```
r2s-gcs/
├─ Cargo.toml  rust-toolchain.toml  .cargo/config.toml(aarch64 クロス)  deny.toml
├─ crates/rgcs-{core,mavlink,camera,video,input,mission,store,i18n,map,log,ai}/
├─ apps/rgcs-server/(src/, ui/, migrations → rgcs-store)
├─ apps/rgcs-cli/
├─ tests/(sitl/ docker-compose、siyi-sim/)
├─ deploy/(rgcs-server.service, config.toml.example, mediamtx.yml, install.sh)
├─ docs/(本書・仕様)
└─ design_base/(デザイン正本、無変更)
```

UI(`apps/rgcs-server/ui`): `src/app/`(ルート・認証ゲート)、`src/features/{auth,vehicles,map,video,camera,camera-settings,gimbal-joystick,mission,maintenance,ai-chat,settings}/`、`src/shared/{api,ws,ui(部品),i18n,schemas}/`、`src/styles/{tokens,components}.css`。1 コンポーネント 1 ファイル、機能ごとに `index.ts` で公開。

## 3. ロードマップ

| MS | 期間 | 内容 | 出荷 |
|---|---|---|---|
| **M1 Pi 基盤** | 4 週 | ワークスペース、`rgcs-server` + ログイン、`rgcs-mavlink`(udpin、Router、CommandQueue、確認トークン)、WS テレメトリ、UI: ログイン / 運用マップ 2D / 機体リスト / 右パネル詳細(カメラ帯なし)/ 全コマンド / Guided / フッター、監査ログ、systemd、aarch64 ビルド、SITL + 実 Pi で動作 | 内部 |
| **M2 カメラ・MT11** | 4 週 | `rgcs-camera`(trait、caps、siyi 全 CMD、mavlink_cam、none)、`rgcs-video`(ソース監視、WHEP 中継、遅延統計)、UI: カメラ帯、全機体映像、操作卓(録画 / 写真 / ズーム / 映像タイプ / モード / センター / 遅延)、カメラ設定(接続 / 操作 / 映像)、Gamepad → WS(ジンバル)、デッドマン | **0.1 = Python 版置換** |
| **M3 ROI・サーマル・AI 追跡** | 3 週 | ROI 制御器(rate / angle、PID)、プリセット + 地図で指定 + CSV、ROI チップ・マーカー・視線、温度オーバーレイ(0x14 / 0x12)、クリック追跡 / Ctrl 選択 / 0x5F、時刻同期、SD 監視、自動録画、カメラ設定 ROI タブ | **0.2** |
| **M4 メンテナンス・ミッション** | 4 週 | パラメータ(`apm.pdef.xml`、書戻し検証、履歴)、校正、ミッション(Mission Protocol、ファイル、検証、標高プロファイル)、3D 地図(地形)、機体操作ジョイスティック(MANUAL_CONTROL)、MAVLink 署名、i18n 完成、負荷試験 | **0.3** |
| **M5 多機体・クラウド・AI** | 4 週+ | `--role edge / hub`、アカウント管理(モック廃止)、DataFlash 解析 + ルール AI、AI チャット、録画保存(hub)、Tauri 殻(任意) | **1.0** |

依存: M2 は M1 の WS / 認証 / 監査に依存。M3 は M2 のドライバと `GLOBAL_POSITION_INT` 受信に依存。M4 の 3D 地図はプロトタイプの `AirPathLayer` を移植。M5 の edge/hub は M1〜M4 の WS 契約をそのまま使う。

## 4. M1 詳細(4 週)

### 週 1: 骨組みとテレメトリ
1. `cargo new` でワークスペース。`rgcs-core` にドメイン型(`VehicleState`, `Command`, `CommandResult`, `Operator`)+ ts-rs 出力(`ui/src/shared/api/types.ts` を `cargo test` で生成し CI で差分検出)。
2. `rgcs-mavlink`: リンク URL パーサ(`udpin|udpout|udp|tcp:<host>:<port>` / `/dev/tty*[,baud]`、`tcpin` 拒否)→ 先にテスト。Router(sysid/compid → `VehicleHandle`、未知 sysid 自動登録)。HEARTBEAT 監視(3 s / 10 s)。`SET_MESSAGE_INTERVAL` 遅延要求(Python `test_mavlink_source.py` を移植)。
3. `rgcs-server`: axum 起動、`config.toml`、静的配信、`/ws` に `snapshot` + `telemetry` 10 Hz 差分。
4. UI: Vite + React + TS、`tokens.css` / `components.css`(プロトタイプの `<style>` を移植)、WS クライアント、機体リスト。
5. 受け入れ: SITL(docker、ArduCopter 1 機)の位置が UI のリストに 10 Hz で出る。

### 週 2: 認証・監査・コマンド
1. `rgcs-store`: マイグレーション(`users`, `sessions`, `audit_log`, `param_history`, `vehicles`, `app_settings`)、`admin` シード、`dev_mode` 判定。
2. 認証 API(login / logout / me)、tower-sessions、CSRF ヘッダ、5 回失敗ロック → 統合テスト(401 / 429)。
3. `CommandQueue`: ポリシー(ACK 必須 / 再送 / タイムアウト)、確認トークン発行と検証(30 s)、監査記録、`command_result` 配信。先にユニットテスト(要確認コマンドのトークン無し → `confirm_required`)。
4. UI: ログイン画面(`glass_login.png`)、ヘッダー + ユーザーポップオーバー、全コマンドシート、確認ダイアログ、フッターのログピル。
5. 受け入れ: admin/admin でログイン → SITL を ARM(確認付き)→ `audit_log` に行、フッターに結果。

### 週 3: 地図と右パネル
1. MapLibre 地図(2D)、機体マーカー(`.rg-mk`)、航跡、追従と `setPadding` 同期(プロトタイプ `syncPadding` を移植)。
2. 右パネル詳細(映像サムネイルは「映像未接続」固定、テレメトリ 3 列、タイル 3 つ、メッセージ + 確認)。`vehicle_message`(STATUSTEXT、CommsDelay / LinkLost)。
3. Guided 移動(目標クリック、高度モード、`SET_POSITION_TARGET_GLOBAL_INT`、ジオフェンス上限チェック)。
4. 受け入れ: 追従中の機体が可視領域中央 ±4 px。Guided で SITL が動く。LinkLost 時にコマンドが 503。

### 週 4: Pi 配備と仕上げ
1. `cross` で aarch64 ビルド、`sqlx` オフライン、`include_dir` で UI 埋め込み、`deploy/install.sh`(Python 版サービス停止 → 配置 → `config.toml` → enable)。
2. 実 Pi(Rpanion `udpin:127.0.0.1:15555`)で実機 FC 接続、LTE 越しのブラウザ操作。
3. Playwright E2E: ログイン → リスト → 詳細 → コマンド(確認)→ ログアウト。
4. 性能: 20 機ダミー(SITL 2 機 + 生成テレメトリ)で UI 50 fps、`rgcs-server` CPU 計測。
5. ドキュメント: `deploy/README`(Pi セットアップ)、`docs/spec` の差分反映。

### M1 受け入れ条件(まとめ)
- 30 §9 の性能目標(テレメトリ反映、CPU、メモリ)。
- 70 §8 のうち確認トークン・401 / 429 / 409。
- 10 §1〜3 の受け入れ条件(カメラ帯を除く)。
- `cargo test` / `pnpm test` / Playwright が CI で緑、カバレッジ 80%。

## 5. M2 詳細(要点)

- 週 1: `rgcs-camera` 型 + `siyi/frame.rs`(CRC・フレーミング、`test_camera_protocol.py` 移植)+ `siyi/client.rs`(TCP / UDP、ハートビート、再接続、`FORBIDDEN_CMD_IDS`)+ `tests/siyi-sim`(Python 版の応答を再現する疑似カメラ)。
- 週 2: 全 CMD の encode / parse(ai / thermal / tf_card / encoding)、`CameraState` 更新、`camera_state` 配信、`mavlink_cam` の caps 取得、`camera_profiles` + API。
- 週 3: `rgcs-video`(`video_source.py` 移植、WHEP 中継、`/video/stats`)、UI: 全機体映像グリッド、操作卓(映像 `<video>` + 操作バー)、カメラ帯、カメラ設定(接続 / 操作 / 映像)。
- 週 4: Gamepad API(`app.js` の軸 / ボタン処理を TS に移植、vitest)、WS `gimbal_rate` / `input_hb`、`InputGate` デッドマン、実機 MT11 で Python 版と並べて比較(同時起動は不可なので交互に)、Pi 配備、**0.1 出荷**。

## 6. テスト戦略

| 層 | 内容 | ツール |
|---|---|---|
| ユニット(Rust) | フレーミング / パーサ / PID / geo / 時刻同期 / 検証範囲 / コマンドポリシー | `cargo test`、Python テストのケースを移植 |
| ユニット(TS) | 軸・ボタン処理、クリック→画素座標、zod スキーマ、WS 差分適用、i18n 欠落検出 | vitest |
| 統合 | 認証、API エラー経路、WS 契約、`siyi-sim` との往復、SITL(docker)での ARM / Guided / パラメータ往復 / ミッション往復 | `cargo test --test`、docker-compose |
| E2E | ログイン → 運用 → 操作卓 → 設定保存 → ログアウト、能力ゲート(MT11 / MAVLink / none) | Playwright(`e2e-runner`) |
| 負荷 | 20 機 × 50 Hz + 6 映像、WS 10 Hz 維持、Pi CPU | 専用スクリプト |
| 実機 | MT11 全機能、ROI、LTE 越し、`siyi probe` | チェックリスト(40 §8) |

TDD の順序: Python テスト → Rust テスト(赤)→ 実装(緑)→ リファクタ。UI は Storybook 不要、Playwright のスクリーンショットをデザイン正本(`design_base/screenshots/glass_*.png`)と目視比較。

## 7. リスク

| リスク | 対策 |
|---|---|
| Pi の CPU(映像を Pi で触ると不足) | MediaMTX パススルーを崩さない。Pi 上の処理は制御・中継のみ |
| WebRTC over LTE(UDP 8189 不通、H.265 非対応ブラウザ) | TCP フォールバック、既定は H.264 1080p、UI に遅延と理由を表示 |
| MT11 TCP 1 クライアント制限 | Python 版と `rgcs-server` の同時起動禁止(install.sh が停止)、`siyi probe` はサービス停止前提 |
| `0x0E` 角度基準・温度の負値など未確認仕様 | 実機確認済み事項を 40 に記載。未確認は `siyi probe` で先に確認 |
| aarch64 クロスビルド・`sqlx` オフライン | 週 1 から CI でクロスビルドを回す |
| モックログインが本番に残る | `dev_mode` バッジ + 初回パスワード変更強制(M5)+ インストール手順に明記 |
| ROI 精度(コンパス・GPS) | 高倍率は ROI → AI 追跡に切替える運用を UI の注記に出す |
| 仕様の二重管理(範囲表) | `docs/spec/ranges.json` を両側のテストが参照 |

## 8. 未決事項

1. MAVLink 署名鍵の配布・保管(M4 冒頭)。
2. hub の認証基盤(自前 / 外部 IdP)(M5 冒頭)。
3. SIYI 他機種(ZR10 / A8)対応の優先度。
4. 地図タイルのオフライン化(Pi 版はオンライン前提、hub / desktop で MBTiles)。

## 9. 直近の着手順

1. ワークスペース生成とクロスビルド CI(M1 週 1 の 1)。
2. `rgcs-core` の型と ts-rs 生成。
3. `rgcs-mavlink` の URL パーサ・Router(テスト先行)。
4. UI の `tokens.css` / `components.css` 移植とログイン画面。
