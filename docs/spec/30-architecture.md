# RGCS 仕様書 30 — アーキテクチャ(スタンドアローン Pi 版 → edge / hub)

- 版: 0.1(2026-10-16)
- 前身: `design_base/project/RGCS Rust Architecture.dc.html`(Tauri 前提の v0.1)。本書で Pi サーバー + ブラウザ構成に改訂する

## 1. ランタイム構成(スタンドアローン)

```
[機体] FC ─serial─> companion Pi ──LTE/VPN or LAN──> 操作者 PC(ブラウザ + ジョイスティック)
                    ├ Rpanion-server(既存: serial → udpin:127.0.0.1:15555 へ配信)
                    ├ MediaMTX(既存: MT11 RTSP → WebRTC / WHEP、再エンコードなし)
                    ├ android-stream(任意: USB 端末画面 → WHEP、:8080)
                    └ rgcs-server(新規 1 プロセス, Rust / tokio / axum)
                        ├ MAVLink  udpin:127.0.0.1:15555(Python 版と同じ)
                        ├ SIYI MT11  TCP + UDP 192.168.144.25:37260(TCP は 1 クライアント制限 → 本プロセスが唯一)
                        ├ HTTP :8000  静的 UI(Vite ビルド)+ REST + /ws
                        └ WHEP リバースプロキシ → MediaMTX 127.0.0.1:8889 / android-stream :8080
```

- `rgcs-server` は aarch64 単一バイナリ。systemd ユニット `rgcs-server.service` が Python 版 `mt11-camera-ui.service` を置き換える(同時起動禁止、MT11 の TCP が 1 本のため)。
- tokio マルチスレッドランタイム 1 つ。ブロッキング I/O(シリアル直結時、SQLite)は `spawn_blocking`。
- ブラウザから必要なポート: 8000(HTTP / WS)、8189(WebRTC UDP、不通なら TCP)。Android ソース使用時は追加の UDP。
- 設定ファイル `/etc/rgcs/config.toml`(リッスン、MAVLink URL、データディレクトリ `/var/lib/rgcs`、役割)。カメラ・ROI・入力設定は SQLite(60)。

## 2. クレート構成

```
r2s-gcs/
├─ Cargo.toml                 # workspace
├─ crates/
│  ├─ rgcs-core      # ドメイン型: Vehicle, VehicleState, Command, Event, Operator, Mission(serde + ts-rs)
│  ├─ rgcs-mavlink   # リンク(udpin/udpout/tcp/serial)、Router(sysid/compid)、CommandQueue、PARAM 同期、SET_MESSAGE_INTERVAL 遅延要求
│  ├─ rgcs-camera    # Camera trait / CameraCaps / CameraCommand / CameraState、ドライバ siyi・mavlink_cam・none、ROI 制御器、時刻同期
│  ├─ rgcs-video     # 映像ソース監視(RTSP DESCRIBE / android /status)、WHEP 中継、録画状態、遅延統計
│  ├─ rgcs-input     # WS 入力の検証・レート制限・デッドマン、MANUAL_CONTROL / GimbalRate への変換
│  ├─ rgcs-mission   # Mission Protocol 状態機械、.waypoints / .rgcsmission、検証
│  ├─ rgcs-map       # (hub / desktop 向け)MBTiles 配信、タイル取得、地形サンプリング
│  ├─ rgcs-log       # DataFlash .bin / tlog パーサ、polars 抽出
│  ├─ rgcs-ai        # ルール解析、LLM アダプタ、ツール定義
│  ├─ rgcs-store     # sqlx SQLite: users / sessions / audit_log / param_history / camera_profiles / roi_* / gimbal_input_profile / app_settings
│  └─ rgcs-i18n      # fluent リソース(サーバー側メッセージ)
├─ apps/
│  ├─ rgcs-server    # axum: 認証、REST、WS ハブ、静的配信、--role standalone|edge|hub
│  │  └─ ui/         # React + TypeScript(Vite)。ts-rs 生成型を import
│  ├─ rgcs-cli       # siyi probe(0x0E 基準確認・温度・サーマル読み取り)、log analyze、tiles fetch
│  └─ rgcs-desktop   # (将来)Tauri 殻。M1〜M4 では空
└─ tests/            # SITL 統合(docker: ArduCopter × N)、MT11 疑似サーバー(Python 版の挙動を再現)
```

変更点(旧設計書比): `rgcs-camera` 新規、`rgcs-server` が `rgcs-desktop` の役割を継承、`rgcs-video` は GStreamer を持たない、`rgcs-input` は `gilrs` を持たない。

## 3. データフロー

```
┌──────────── ブラウザ(React) ────────────┐
│ WS ↓ telemetry 10Hz 差分 / camera_state / events │
│ WS ↑ gimbal_rate 20Hz / manual 50Hz / input_hb 1Hz │
│ REST: 認証・コマンド・設定・ミッション・WHEP     │
└───────────────┬────────────────────────┘
                │ axum(セッションクッキー)
┌───────────────┴────────── rgcs-server ───────────┐
│ AppState { vehicles: DashMap<SysId, VehicleHandle>, cameras: DashMap<SysId, CameraHandle>, hub: WsHub } │
│ VehicleHandle { state: watch::Sender<VehicleState>, cmd_tx: mpsc::Sender<Command> }                     │
│ CameraHandle  { caps, state: watch::Sender<CameraState>, cmd_tx: mpsc::Sender<CameraCommand> }           │
│ ┌ LinkManager ┐ ┌ CommandQueue ┐ ┌ CameraTask × N ┐ ┌ RoiController ┐ ┌ VideoSource ┐ ┌ InputGate ┐│
│ │ udpin/serial│ │ 確認・再送・ACK│ │ siyi TCP/UDP   │ │ PID 10 Hz     │ │ probe/WHEP  │ │ deadman  ││
│ └──────┬──────┘ └──────┬───────┘ └───────┬────────┘ └──────┬────────┘ └──────┬──────┘ └────┬─────┘│
│        └── Router ─────┴─ AuditLog(SQLite) ┴────────────────┴────────────────┴─────────────┘      │
└───────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **テレメトリ**: 受信は最大レート。`VehicleState` を `watch` で更新し、10 Hz タイマで直前送信値との差分だけを WS に流す。
- **カメラ状態**: ドライバが push(0x50 追跡枠、0x5F 検出枠)とポーリング(1 Hz 状態、10 s SD、5 s 時刻)を統合して `CameraState` を更新。WS には変化時 + 1 Hz。
- **コマンド**: 機体コマンドもカメラコマンドも mpsc キューを経て 1 タスクが直列に送る。確認トークン・レート制限・監査はキュー入口で一括。
- **入力**: `gimbal_rate` はキューを通さず `InputGate` が直接ドライバへ(20 Hz、25 Hz 超は間引き)。`input_hb` が 1.5 s 途絶したら速度 0 を送る。

## 4. MAVLink(rgcs-mavlink)

- 既定リンク `udpin:127.0.0.1:15555`(Rpanion の配信先)。`udpout` / `tcp` / `/dev/tty*,baud` も可。`tcpin` は不可。
- 最初の HEARTBEAT から 10 s 待ち、`GLOBAL_POSITION_INT`(10 Hz)/ `SYSTEM_TIME`(1 Hz)/ `ATTITUDE` が流れていないときだけ `SET_MESSAGE_INTERVAL` を要求する(Python `mavlink_source.py` の方針)。
- HEARTBEAT 欠落 3 s → `CommsDelay`(黄)、10 s → `LinkLost`(赤)。
- 未知の sysid は自動登録し `VehicleDiscovered`。スタンドアローンでは通常 1 機。
- MAVLink 2、署名は M4 で鍵配布方式と共に決定。

## 5. 映像(rgcs-video)

- Pi で GStreamer を動かさない。MT11 の RTSP(`rtsp://{host}:8554/video1`)は MediaMTX がそのまま WebRTC 化する。
- `rgcs-video` の責務: ソース監視(MT11 RTSP DESCRIBE → Android `/status` → 無ければ 15 s 後に再スキャン、選択中は 3 s ごと確認、2 回連続失敗で切替)、WHEP 中継(`POST …/video/whep` の SDP を MediaMTX または android-stream へ転送、トークン付与)、録画状態(カメラ側 SD 録画の状態を `camera_state.recording` に反映)、遅延統計(ブラウザが報告する RTT / ジッタ)。
- 録画ファイルはカメラ本体の SD。GCS 側録画(AUTO REC の mp4 保存)は hub / desktop 版の `rgcs-video` 拡張で扱う。

## 6. ジョイスティック

- 操作者 PC のブラウザが Gamepad API で読み(`features/gimbal-joystick/`)、プロファイル(60 §3)に従って軸・ボタンを機能に変換し、WS で送る。
- ジンバル: `gimbal_rate` 20 Hz(無入力時は送らず、入力が 0 になった瞬間に 1 回だけ 0 を送る)。
- 機体操作: `manual`(MANUAL_CONTROL)50 Hz。対象は選択中の機体。切替時は 0.5 s ニュートラル。
- サーバーはデバイス切断を `input_hb` 途絶で検知し、ニュートラル / 速度 0 を送って警告を積む。
- `gilrs` は使わない(デバイスは Pi に無い)。

## 7. edge / hub(クラウド版)

- `--role edge`: UI 配信と認証を止め、hub へ WSS でアウトバウンド接続(mTLS)。内部イベント(テレメトリ差分、カメラ状態、コマンド結果)を転送し、hub からのコマンドをキューに入れる。映像は hub が WHEP を edge へ中継(edge 経由で MediaMTX)。
- `--role hub`: N edge を sysid 空間で束ね、同じ UI を多機体で配信。アカウント管理・監査・録画保存を持つ。
- edge / hub 間の契約は 50 §5 の WS メッセージと同一形式。

## 8. ビルド・配布

- Rust stable、`cross` で `aarch64-unknown-linux-gnu`。`sqlx` はオフラインモード(`.sqlx/`)。
- UI は `pnpm build` の成果物を `rgcs-server` に `include_dir` で埋め込む。
- 配布物: `rgcs-server` バイナリ、`rgcs-server.service`、`config.toml` 雛形、`mediamtx.yml`(既存 Python 版 `deploy/` から継承)。
- Pi セットアップ手順(移行): Python 版サービス停止 → バイナリ配置 → `config.toml` に MAVLink URL とカメラ IP → `systemctl enable --now rgcs-server` → ブラウザで `http://<pi>:8000` → admin/admin。

## 9. 性能目標

| 項目 | 目標 |
|---|---|
| テレメトリ → UI 反映 | 150 ms 以内(LAN) |
| ジンバル速度指令 | ブラウザ→カメラ 100 ms 以内(LAN)、20 Hz 安定 |
| CPU(Pi 4, 1 機 + MT11 + ROI) | `rgcs-server` 15% 以下 |
| メモリ | 150 MB 以下 |
| UI | 20 機ダミーで 10 Hz 更新時に 50 fps 以上(MacBook / 1440×900) |
