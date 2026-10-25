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
- `config.toml` の `[ai]`(AI チャット、2026-10-24。無い・`provider = "none"` なら無効):
  - `provider` = `none` | `anthropic` | `openai_compat`。
  - `model`(既定 `claude-sonnet-5-5` / `qwen3:8b`)、`base_url`(既定 `https://api.anthropic.com` / `http://127.0.0.1:11434/v1`)。
  - `api_key_env`(Anthropic の既定 `ANTHROPIC_API_KEY`。OpenAI 互換は既定なし)、`api_key`(非推奨、環境変数が優先)。キーは UI・応答・ログに出さない(70 §4)。
  - `effort`(Anthropic `output_config.effort`、既定 `medium`)、`request_timeout_ms`(30 000)、`chat_timeout_ms`(90 000)、`max_tokens_per_chat`(60 000)、`daily_token_budget`(2 000 000、`0` = 無制限)。未知のキーは起動エラー。

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
│  ├─ rgcs-ai        # LLM アダプタ(Anthropic Messages / OpenAI 互換)、ツール定義、エージェントループ(ルール解析は未実装)
│  ├─ rgcs-store     # sqlx SQLite: users / sessions / audit_log / param_history / camera_profiles / roi_* / gimbal_input_profile / app_settings
│  └─ rgcs-i18n      # fluent リソース(サーバー側メッセージ)
├─ apps/
│  ├─ rgcs-server    # axum: 認証、REST、WS ハブ、静的配信、--role standalone|edge|hub
│  │  └─ ui/         # React + TypeScript(Vite)。ts-rs 生成型を import
│  ├─ rgcs-cli       # siyi probe(0x0E 基準確認・温度・サーマル読み取り)、log analyze、tiles fetch
│  └─ rgcs-desktop   # (将来)Tauri 殻。M1〜M4 では空
└─ tests/            # SITL 統合(docker: ArduCopter × N)、MT11 疑似サーバー(Python 版の挙動を再現)
```

`rgcs-ai`(2026-10-24 実装): axum / `AppState` を知らない。`config`(`AiConfig` と伏字の `Secret`)、`llm`(プロバイダー非依存の `Turn` / `Block` / `LlmClient`)、`anthropic` / `openai`(`reqwest` の JSON、非ストリーミング。Anthropic の assistant ブロックは thinking を含めそのまま再送)、`tools`(5 ツールの JSON スキーマと入力の検証)、`prompt`(固定の日本語システムプロンプト)、`agent`(`run_turn`: ツールループ 6 回 + ツールなしの 1 回、`ToolHost` トレイト越し)、`testing`(feature `fake`: `ScriptedLlm` と両プロトコルの `FakeProviderServer`)。サーバー側は `ai_hub`(会話・レート制限・提案・24 h トークン予算)、`ai_tools`(`ToolHost` の実装。コマンドキュー・カメラには触れない)、`ai_validate`(提案の検証)、`ai_meter`(応答した呼び出しごとの課金と、プロバイダーのエラー本文を出さない応答)、`ai_api`(`/api/ai/*`、50 §2.5)。ルール解析(10 §7 のログ・AI 解析)は未実装。

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
  - (2026-10-22)テレメトリを自分から何も送ってこない機体(SRn_ が 0)は、10 s を待たず最初の HEARTBEAT から 3 s で要求する。一部でも流れていれば、Mission Planner などの設定を待つため従来どおり 10 s 待って、足りないものだけを要求する。
  - HEARTBEAT が 5 s 以上途切れたら(再起動・リンク断)、新しい接続として最初からやり直す(一度だけ要求するものも再要求)。
  - 一度だけ要求するもの: `POSITION_TARGET_GLOBAL_INT`(GUIDED のときだけ)、`HOME_POSITION`、`NAV_CONTROLLER_OUTPUT`(Plane / Rover は航法中だけ)。`EXTENDED_SYS_STATE`(1 Hz)の `vtol_state` で QuadPlane を通常の固定翼と区別する(QuadPlane の HEARTBEAT は FIXED_WING)。
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

## 8. ビルド・配布(P6 実装、2026-10-18)

- ビルド: `scripts/build-pi.sh` が UI(`npm run build`)を作り、linux/arm64 の `rust:bookworm` コンテナ内で `cargo build --release -p rgcs-server --features embed-ui` を実行する(Apple Silicon ではエミュレーションなし、glibc は bookworm の 2.36 以下)。成果物は `dist/pi/` の `rgcs-server`(UI 埋め込み済みの単一バイナリ、約 19 MB)、`siyi_sim`(検証用)、`rgcs-pi-<version>.tar.gz`(バイナリ + `install.sh` + `rgcs-server.service` + `config.toml.example`)。CI は従来通り `cross` で aarch64 をビルドする。
- UI 埋め込み: `embed-ui` 機能で `ui/dist` を `include_dir` で取り込む。`config.toml` の `ui_dir` があればそちらが優先。ハッシュ付き `assets/` は 1 年キャッシュ、それ以外は `index.html`(no-cache)を返す SPA 配信。
- 配置: バイナリ `/opt/rgcs/bin/rgcs-server`(前版は `rgcs-server.prev`)、設定 `/etc/rgcs/config.toml`、データ `/var/lib/rgcs`(DB・ロゴ・取り出したログ)、ユニット `/etc/systemd/system/rgcs-server.service`、サービスユーザー `rgcs`(`dialout` 所属)。
- Pi セットアップ(初回・更新とも同じ手順):

  ```sh
  scp dist/pi/rgcs-pi-<version>.tar.gz pi@<pi>:
  ssh pi@<pi> 'tar xzf rgcs-pi-<version>.tar.gz && cd rgcs-pi-<version> && sudo ./install.sh'
  # 初回のみ: /etc/rgcs/config.toml の mavlink_url / whep_upstream を機体に合わせて編集し
  sudo systemctl restart rgcs-server
  # ブラウザで http://<pi>:8000 → admin / admin
  ```

- `install.sh` の動作: バイナリ検査(`--version`)→ ユーザー・ディレクトリ作成 → バイナリ差し替え(名前の付け替えで原子的に。中身が違うときだけ前版を `.prev` に保持)→ 設定は無いときだけ雛形から作成(既存は上書きしない)→ `mt11-camera-ui.service`(Python 版)を停止・無効化 → ユニット登録・有効化・再起動 → `/api/health` を待つ。時間内(既定 30 s、1 回の問い合わせは 2 s で打ち切り)に応答しなければ前版に戻して `ROLLED BACK` を表示し終了コード 1。初回導入で失敗した場合は rgcs-server を止めて無効化し、Python 版を元に戻す(`RESTORED`)。手動で戻すときは `sudo ./install.sh --rollback`。何度実行しても同じ結果になる。
- ユニット: `Conflicts=mt11-camera-ui.service`(Python 版を手で起動すると rgcs-server は止まる。MT11 の TCP は 1 本、:8000 も競合するため)、`Restart=always`、`ProtectSystem=strict` + `ReadWritePaths=/var/lib/rgcs`、`NoNewPrivileges`。
- MediaMTX・Rpanion-server は Pi に既存のものを使う(この配布物には含めない)。
- **注意**: アカウント管理(M5)までは開発用ログイン admin/admin が有効で、ログインできれば ARM も可能。`install.sh` は導入後に警告を表示する。:8000 は機体側 LAN / VPN からのみ到達できるようにし、インターネットへ直接公開しない。
- 版の確認: `rgcs-server --version` と `/api/health` の `build` に `<git sha>[-dirty]` が入る(`scripts/build-pi.sh` が埋め込む)。

### 8.1 Docker の Pi 相当環境(配備の事前検証)

実機リハーサルの前に、配備一式を Docker 上で検証する(`deploy/docker/`、開発は従来通りローカル SITL)。

- 構成: `pi`(Debian bookworm arm64 + systemd を PID 1、ユーザー `pi`、Python 版の代役 `mt11-camera-ui.service`、MT11 シミュレーター `127.0.0.1:37260`、FC リンク代役)と、`pi` のネットワーク名前空間を共有する `mediamtx`・`video`(ffmpeg のテストパターンを `rtsp://127.0.0.1:8554/video1` に配信)。実機と同じく全て `127.0.0.1` で繋がる。公開ポートは `18000`(UI/API)と `8189`(WebRTC)。
- FC リンク代役: ホストの ArduCopter SITL(`tcp:5760`)を socat で `udp 127.0.0.1:15555`(Rpanion 相当)または pty `/dev/ttyFC`(シリアル相当、`dialout` 0660)に中継する。
- 操作: `scripts/pi-sim.sh up | down | install | shell | logs | link udp|serial | lte on|off | bench`。ホストの SITL は 1 接続のみなので `scripts/dev.sh` を止めてから使う。
- 受け入れ: `tests/pi/check-build.sh`(aarch64・glibc・`--version`・配布物)、`tests/pi/check-env.sh`(環境)、`tests/pi/accept-deploy.sh`(新規導入と Python 版の置き換え、UDP リンクでの既存 SITL 受け入れ 3 本、更新で設定・データ保持、アーム中の再起動で飛行が 1 件のまま閉じる、シリアル 57600 / 921600 とログ取り出しの有効・無効、壊れた版の自動ロールバック、再起動後の自動起動)、`tests/pi/accept-stack.sh`(観客用映像・カメラ・詳細・飛行日誌の E2E を通常回線と LTE 相当 `netem 80 ms ± 20 ms, 1 % loss` で 2 回)。2026-10-18 時点で全て OK。
- 目安(`pi-sim.sh bench 60`、SITL テレメトリ 10 Hz、WebSocket クライアントなし、Mac の 1 コアまたは 0.25 コアに制限): CPU 0.3 %、メモリ 113 MB(cgroup の MemoryCurrent、ページキャッシュ込み)。UI 接続時の負荷と Pi 4 の正式判定は実機で行う。
- Docker では確かめられないもの(実機リハーサルで確認): 実 UART の速度と 921600 bps でのログ取り出し時間、Pi の CPU・熱・SD カード I/O、実 FC ファームウェア、MT11 本体の制御と RTSP 実映像、実際の LTE / VPN 回線、Rpanion-server 本体との連携。

## 9. 性能目標

| 項目 | 目標 |
|---|---|
| テレメトリ → UI 反映 | 150 ms 以内(LAN) |
| ジンバル速度指令 | ブラウザ→カメラ 100 ms 以内(LAN)、20 Hz 安定 |
| CPU(Pi 4, 1 機 + MT11 + ROI) | `rgcs-server` 15% 以下 |
| メモリ | 150 MB 以下 |
| UI | 20 機ダミーで 10 Hz 更新時に 50 fps 以上(MacBook / 1440×900) |
