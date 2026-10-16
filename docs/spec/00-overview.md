# RGCS 仕様書 00 — 概要・スコープ・用語

- 版: 0.1(2026-10-16)
- 対象: RGCS(ArduPilot 対応地上局)スタンドアローン Pi 版 → クラウド版
- 正本デザイン: `design_base/project/RGCS Prototype Glass.dc.html`(コミット `f18b6d4` 以降)
- 関連: `10-screens.md` 画面仕様 / `20-design-tokens.md` / `30-architecture.md` / `40-camera-gimbal.md` / `50-api.md` / `60-data-model.md` / `70-safety-auth.md` / `../plan/implementation-plan.md`

## 1. 目的

RGCS は ArduPilot(Copter / Rover)機体を監視・操作する地上局アプリケーションである。既存の 2 つの資産を 1 つの製品に統合する。

1. デザインプロトタイプ(運用マップ、全機体映像、ミッション作成、メンテナンス、AI チャット)。
2. `siyi-mt11-cameracontrol`(Python / FastAPI)。SIYI MT11 ジンバルカメラの操作・GPS ROI 追従・映像配信・ジョイスティック操作を機体側 Raspberry Pi 上で提供している。

統合後は、機体側 Pi 上の **1 つの Rust サービス(`rgcs-server`)** が MAVLink・カメラ・映像中継・Web UI 配信を担い、操作者はブラウザから LAN / LTE 越しに操作する。Python 版はこのサービスで置き換える。

## 2. 配置形態

| 形態 | 時期 | 構成 | 備考 |
|---|---|---|---|
| **スタンドアローン(Pi)** | M1〜M3 で出荷 | 機体側 companion Pi で `rgcs-server --role standalone`。1 Pi = 1 機体。ブラウザが UI。 | Rpanion-server(MAVLink 配信)と MediaMTX(RTSP → WebRTC)は既存のまま同居 |
| **edge + hub(クラウド)** | M5 | 各 Pi が `--role edge` で集約サーバー(`--role hub`)へ WSS でアウトバウンド登録。hub が多機体 UI を配信 | MAVLink をクラウドで終端しない。映像・カメラ TCP は Pi で終端 |
| **デスクトップ殻** | M5 以降(任意) | Tauri で同じ UI を包む(地上 PC 常駐、オフラインタイル) | M1〜M4 では作らない |

内部データモデルは最初から **sysid キーの多機体構造** を持つ。スタンドアローン版でも UI の機体リストは存在し、1 台だけが並ぶ。

## 3. 用語

| 用語 | 意味 |
|---|---|
| 機体 (vehicle) | MAVLink の `system_id` で識別される ArduPilot 機体。種別 `copter` / `rover` |
| オペレータ (operator) | ログインしたユーザー。全ての送信操作は `audit_log` にこの名前で記録される |
| カメラ (camera) | 機体に割り当てられたペイロード。`kind` = `none` / `mavlink` / `siyi_mt11` |
| 能力 (capability, caps) | カメラが提供する機能の集合(`CameraCaps`)。UI は能力に無い操作を **表示しない** |
| ジンバル | カメラの雲台。速度指令(rate)・角度指令(angle)・モード(Lock / Follow / FPV) |
| ROI(GPS ROI) | 登録座標へカメラを向け続ける機能。MT11 では GCS 側 PID で実現、MAVLink カメラでは `DO_SET_ROI_LOCATION` |
| AI 追跡 | カメラ内蔵 AI による対象追跡(MT11 0x55/0x56/0x50/0x5F) |
| 操作卓 (cockpit) | 全機体映像で 1 機を最大化した画面。カメラ操作の主画面 |
| カメラ帯 (camera strip) | 運用マップ右パネル内の簡易カメラ操作 2 行 |
| 確認トークン | ARM / DISARM / RTL / LAND / モード変更などに必要な UI 確認の証明。無ければサーバーが拒否 |
| 映像ソース | ブラウザへ流す映像の出どころ。`mt11`(RTSP → MediaMTX)/ `android`(USB 端末画面)/ 自動選択 |

## 4. 画面一覧

| # | 画面 | プロトタイプの状態 | 仕様 |
|---|---|---|---|
| 0 | ログイン | `view:'login'` | 10 §2 |
| 1 | 運用マップ(2D / 3D、機体リスト、右パネル 詳細 / AI) | `view:'ops'` | 10 §3 |
| 2 | 全コマンド・Guided 移動 | `modal:'commands' / 'guided'` | 10 §3.5 |
| 3 | 全機体映像(グリッド) | `view:'video'` | 10 §4 |
| 4 | 映像最大化 = カメラ操作卓 | `view:'video', maxVideo` | 10 §4.2 |
| 5 | カメラ設定シート(接続 / 操作 / ROI / 映像) | `modal:'camera'` | 10 §5 |
| 6 | ミッション作成(2D / 3D、標高プロファイル) | `view:'mission'` | 10 §6 |
| 7 | メンテナンス: 機体設定 / 点検・校正 / ログ・AI 解析 / 変更履歴 / アプリ設定 | `view:'maint'` | 10 §7 |
| 8 | ヘッダー・フッター(ログピル)・ユーザーポップオーバー | 常時 | 10 §1 |

## 5. 要求の優先順位

1. **安全**: 機体へ送る全てのコマンドはサーバーのコマンドキューを通り、確認・レート制限・監査を受ける。カメラの SD フォーマット(MT11 0x48)は送信経路の最下層で禁止。
2. **MT11 の全機能**: Python 版にある機能(README の一覧)を欠落なく移植する。Python 版のテストを移植の正解データにする。
3. **能力駆動 UI**: カメラ種別が変わっても画面構造は変わらず、表示される操作だけが変わる。
4. **オフライン・低帯域**: LTE 越し(数百 ms 遅延、UDP 不通あり)でも操作できる。映像は再エンコードせず、操作は 20 Hz 以下の軽量メッセージ。
5. **多言語**: 日本語 / 英語の切替(UI 文言は辞書、機体メッセージは原文保持)。

## 6. スコープ外(本版)

- MAVLink 署名鍵の配布・保管方式(M4 で決定)
- ローカル LLM の規模・配布(M5)
- Tauri デスクトップ殻の配布形態
- MT11 以外の SIYI 機種(ZR10 / A8 等)。プロトコルは同系統なのでドライバの派生で対応予定だが本版では扱わない
- 複数操作者の同時操作の調停(hub 版で設計)

## 7. 既に決まっていること(2026-10-16)

- フロントエンド: React + TypeScript(Vite)。状態は機能単位のストア、サーバー状態は WebSocket 差分で同期。
- バックエンド: Rust(tokio / axum / sqlx)。クレートは `30-architecture.md`。
- 配置: スタンドアローン Pi 版を先行。クラウド版は edge → hub の集約。
- MT11 アプリは Rust に移植して内蔵(REST 連携や段階移行はしない)。
- ログイン = オペレータ。モック認証は `admin` / `admin`。本番はアカウント管理に置換(M5)。
- ジョイスティックは操作者 PC 側でブラウザの Gamepad API で読み、WebSocket で Pi へ送る(`gilrs` は使わない)。
- デザインは Glass 版のトークン(`20-design-tokens.md`)を正とする。

## 8. 文書の読み方

- 「必須」「しなければならない」は受け入れ条件。「推奨」「望ましい」は実装者の判断に委ねる。
- プロトタイプの振る舞いと本仕様が食い違う場合は本仕様が優先し、差分は本仕様に「プロトタイプとの差」として明記する。
- 各節の末尾「受け入れ条件」は、`../plan/implementation-plan.md` のマイルストーン完了判定にそのまま使う。
