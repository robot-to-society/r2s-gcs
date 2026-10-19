# RGCS 仕様書 50 — HTTP / WebSocket API

- 版: 0.1(2026-10-16)
- 旧設計の Tauri IPC(invoke / event)を HTTP + WS に置き換える。型は `rgcs-core` / `rgcs-camera` から ts-rs で生成

## 1. 共通

- ベース: `http://<host>:8000`。全て JSON(UTF-8)。
- 応答形式:
  ```json
  { "success": true,  "data": { … } }
  { "success": false, "error": { "code": "unsupported_capability", "message": "…", "details": { … } } }
  ```
- エラーコード(抜粋): `unauthorized`(401)/ `locked`(429)/ `validation`(422)/ `not_found`(404)/ `confirm_required`(409)/ `unsupported_capability`(409)/ `camera_disconnected`(503)/ `link_lost`(503)/ `rate_limited`(429)/ `internal`(500)。
- 認証: `POST /api/auth/login` が `HttpOnly; SameSite=Strict; Secure(https 時)` のセッションクッキーを発行。`/api/*`(login 以外)と `/ws` はセッション必須。CSRF はクッキー + `X-Requested-With` ヘッダ必須 + SameSite で防ぐ。
- 操作者 = セッションの `username`。送信系 API は全て `audit_log` に記録。
- レート制限: 機体コマンド 10 req/s/セッション、カメラコマンド 20 req/s、ログイン 5 回失敗で 60 s ロック。

## 2. REST

### 2.1 認証
| メソッド | パス | 本文 / 応答 |
|---|---|---|
| GET | `/api/health` | → `{status, hostname, version, dev_mode}`(未認証で可。ログイン画面の「開発用」バッジ用) |
| POST | `/api/auth/login` | `{username, password}` → `{username, role, dev_mode, hostname}`(5 回失敗で `429 locked`) |
| POST | `/api/auth/logout` | — |
| GET | `/api/auth/me` | → `{username, role, dev_mode, hostname}` |

### 2.2 機体
| メソッド | パス | 本文 / 応答 |
|---|---|---|
| GET | `/api/vehicles` | → `[VehicleSummary]`(sysid, name, type, mode, armed, link, last_rx) |
| GET | `/api/vehicles/{sysid}` | → `VehicleState` |
| POST | `/api/vehicles/{sysid}/command` | `{cmd, args, confirm_token?}` → `{id}`(結果は WS `command_result`) |
| POST | `/api/vehicles/{sysid}/confirm` | `{cmd}` → `{confirm_token, expires_in: 30}`(70 §1) |
| POST | `/api/vehicles/{sysid}/guided` | `{lat, lon, alt_mode: keep\|set, alt_rel?, confirm_token?}` → `{id, warning?: "fence_unknown"}`。`409 mode_required`(GUIDED 以外)/ `409 confirm_required`(機体ごと初回)/ `409 fence_alt`(`FENCE_ENABLE`=1 かつ `FENCE_ALT_MAX` 超)/ `400 invalid` / `503 link_lost`。フェンス値が未取得なら `PARAM_REQUEST_READ` を送って `fence_unknown` 付きで通す |
| GET / PUT | `/api/vehicles/{sysid}/params` | GET: `{entries: [{name, value, index, ptype}], progress}` / PUT: `{changes: [{name, value}], confirm_token}` → `[{name, requested, actual, verified, reason?}]`(要確認 `param_write`、アーム中は `409 vehicle_armed`、各変更の前にインターロック再確認、≤ 50 件、名前 ≤ 16 文字) |
| POST | `/api/vehicles/{sysid}/params/refresh` | 全件取得を開始 → `202 {received, total, complete, downloading}`(実行中なら現状を返す) |
| GET | `/api/vehicles/{sysid}/params/progress` | `{received, total, complete, downloading}`(WS `param_progress` でも 25 件ごと + 完了時に配信) |
| GET | `/api/vehicles/{sysid}/messages?since=` | `[{id, ts, severity, text, acked_by?, acked_at?}]` |
| POST | `/api/vehicles/{sysid}/messages/{id}/ack` | 警告・エラー(STATUSTEXT severity ≤ 4、またはサーバー生成の警告)だけ受け付ける。それ以外は `400 not_ackable`。結果は WS `message_ack` で全クライアントへ。監査 `message_ack` |
| GET | `/api/messages?since=&severity=&sysid=&limit=` | 全体ログ(機体メッセージ + `command_result` + システム)。新しい順、`limit` 既定 500。フッターと履歴シートの初期表示(10 §1) |
| POST | `/api/vehicles/{sysid}/calibration` | `{kind: accel\|compass\|level\|rc\|esc}` |

`cmd` の列挙: `pause`, `resume`, `rtl`, `land`, `change_alt`, `change_speed`, `set_mode`, `mission_start`, `mission_resume`, `arm`, `disarm`, `other(mav_cmd, params)`。

### 2.2.1 ミッション(P3、2026-10-17 追補 §5.2 / §5.9)
| メソッド | パス | 本文 / 応答 |
|---|---|---|
| PUT | `/api/vehicles/{sysid}/mission` | `Mission` → `UploadReport{items, verified, mismatched[], findings[]}`。書込 → 読込 → 一致検証。`409 vehicle_armed` / `409 mission_busy` / `409 mission_invalid`(`data.findings` に致命) / `409 mission_rejected`(MISSION_ACK) / `503 link_lost` / `504 mission_timeout`(1.5 s × 3 回)。監査 target `mission` |
| POST | `/api/vehicles/{sysid}/mission/upload` | `{mission_id}` → 保存済みミッションを同じ手順で書込 |
| GET | `/api/vehicles/{sysid}/mission` | 機体から読込 → `Mission`(`sysid` 入り) |
| GET | `/api/vehicles/{sysid}/mission/progress` | → `MissionProgress{seq, total}` または `null`(`total` = 項目数) |
| GET | `/api/vehicles/{sysid}/mission/known` | サーバーが最後に書込 / 読込した機体のミッション → `Mission` または `null`(再読込した画面の経路 / 進捗表示に使う) |
| GET / POST | `/api/missions` | 一覧 `[MissionSummaryRow]` / `Mission` → `201 Mission`(id 付き)。`name` 1〜64 文字、`items` ≤ 700(`400 validation`) |
| GET / PUT / DELETE | `/api/missions/{id}` | `Mission` / `Mission` → `Mission` / `204` |
| GET | `/api/missions/{id}/export?format=waypoints` | `text/plain`、`Content-Disposition: attachment; filename="<name>.waypoints"`(QGC WPL 110、行 0 = home) |
| POST | `/api/missions/import` | 本文 = `.waypoints` テキスト(≤ 1 MB)、`X-Mission-Name` → 未保存の `Mission`。`400 invalid_waypoints` |
| POST | `/api/missions/validate?sysid=` | `Mission` → `{findings: [Finding{level, code, seq, message}], stats: {distance_m, duration_s, max_alt}}`。`sysid` があれば機体のフェンス値で判定(未取得なら `fence_unknown` を付け `PARAM_REQUEST_READ`) |

`Finding.code`: 致命 `empty` / `first_not_takeoff` / `fence_alt` / `fence_radius` / `jump_target`、警告 `fence_unknown` / `fence_frame_unchecked` / `mixed_frames` / `terrain_frame` / `zero_position` / `no_land_or_rtl` / `long_flight`。

### 2.3 カメラ
| メソッド | パス | 本文 / 応答 |
|---|---|---|
| GET | `/api/vehicles/{sysid}/camera` | → `{caps: CameraCaps, state: CameraState}` |
| POST | `/api/vehicles/{sysid}/camera/command` | `CameraCommand`(`GimbalRate` は WS 専用 → `409 ws_only`; caps に無い → `409 unsupported_capability`; 未接続 → `503 camera_offline`。監査 target `camera`) |
| GET / PUT | `/api/vehicles/{sysid}/camera/profile` | `CameraProfile`(60 §3)。PUT は部分更新(省略した項目は保持)、`400 validation` はフィールド名入り。保存後にドライバと映像監視を再生成。起動時にも保存済み(`none` 以外)の全カメラを自動起動 |
| GET / PUT | `/api/vehicles/{sysid}/roi/targets` | `[RoiTarget]`(10 件固定、id `roi_1..roi_10`) |
| GET / PUT | `/api/vehicles/{sysid}/roi/control` | `RoiControl` |
| POST | `/api/vehicles/{sysid}/roi/start` / `stop` | `{id}` / — |
| GET / PUT | `/api/vehicles/{sysid}/video/source` | `{mode: auto\|mt11}` → `VideoSourceStatus`(P2 は Android 無し。PUT は監査 target `video`) |
| POST | `/api/vehicles/{sysid}/video/whep` | `application/sdp`(≤ 64 KB、ICE 収集完了後の offer、trickle 無し)→ `201 application/sdp`。上流は `config.toml` の `whep_upstream`(既定 `http://127.0.0.1:8889/mt11/whep`)。上流不達は `503 video_unavailable` |
| POST | `/api/vehicles/{sysid}/video/stats` | (P2 では未実装。遅延は UI が `getStats()` から算出) |
| GET | `/api/debug/camera/{sysid}/rx` | → `{counts: {"0x50": n…}, last: {...}, firmware}` |

CSV 取込は UI が解析して `PUT roi/targets`。

### 2.4 設定
| メソッド | パス | 本文 |
|---|---|---|
| GET / PUT | `/api/settings/input/gimbal` | `GimbalInputProfile`(`400 validation` はフィールド名入り、監査 target `settings`) |
| GET / POST | `/api/settings/presentation/tokens` | 一覧(prefix 6 文字のみ、operator 可)/ `{label}` → `{token, url}`(admin、token は一度だけ返る) |
| DELETE | `/api/settings/presentation/tokens/{prefix}` | 無効化(admin) |
| PUT / DELETE | `/api/settings/branding/logo` | 本文 = 画像そのもの(`image/png` / `image/svg+xml`、≤ 1 MB、admin) |
| GET / PUT | `/api/settings/input/vehicle` | `VehicleInputProfile`(M4) |
| GET / PUT | `/api/settings/app` | `{lang, map_tile_url, map_attribution, map: {gimbal_ground_projection}}`(P1 は GET のみ。`log_dir, tile_cache, terrain` は P4+。`map.gimbal_ground_projection` は 2026-10-18 追加、既定 false) |
| GET | `/api/history/params?sysid=&limit=` | `[{id, ts, operator, sysid, name, old_value, new_value, verified}]`(新しい順、limit 既定 100 / 上限 1000) |
| GET | `/api/history/audit?limit=` | `[{ts, operator, sysid, command, result}]` |

- (P8)`GET /api/settings/app` に `basemaps: [{id, label, tiles, attribution, max_zoom, overlay}]` と `mavlink: {gcs_sysid}` を追加。`PUT /api/settings/app {mavlink: {gcs_sysid}}` は管理者のみ(1–255、接続中の機体と同じ値は `400 sysid_in_use`)、監査 `settings/app_settings_put`。
- (P9)`GET /api/settings/app` に `terrain_tiles: string | null`(config.toml `terrain_tiles`、既定 AWS Terrain Tiles の Terrarium、`""` で 3D 無効)。
- (P8)`GET /api/mavlink/inspector` → `{rows: [{dir: rx|tx, sysid, compid, msg_id, name, count, rate_hz, age_ms}], gcs_sysid}`、`GET /api/mavlink/inspector/{dir}/{sysid}/{compid}/{msg_id}` → `{row, fields}`。行は最大 4,096(最も長く届いていない行から捨てる)。
- (P8)`VehicleState` に `cog?`、`nav? {target_bearing, wp_dist}`、`target? {lat, lon, alt}`、`home? {lat, lon, alt}`(不明なら省く。差分では消えたとき `null`)。要求ストリームに NAV_CONTROLLER_OUTPUT 500 ms、POSITION_TARGET_GLOBAL_INT 1 s、HOME_POSITION 5 s を追加。

### 2.5 ログ・AI(M4 / M5)
`POST /api/logs/open {path}`, `GET /api/logs/{id}/series?keys=`, `POST /api/logs/{id}/analyze`, `POST /api/ai/chat {sysid, message}`(ツールは状態取得 / メッセージ一覧 / ログ検索のみ)。

### 2.6 観客用(`/present/*`、2026-10-17 追補 §5.1)
セッションではなく `?t=<token>` で守る(無効 / 失効は `401 invalid_token`)。
| メソッド | パス | 応答 |
|---|---|---|
| GET | `/present/config` | `{sysid?, vehicle_name?, logo, map_tile_url, map_attribution, whep_path}` |
| GET | `/present/vehicle` | 最初の機体 `{sysid, name, lat, lon, hdg, alt_rel, mode, armed, link}` または `null`(2 Hz でポーリング) |
| GET | `/present/logo` | ロゴ画像(`Cache-Control: no-store`、`nosniff`、CSP sandbox) |
| POST | `/present/whep` | 操作者用と同じ中継(観客ごとに別の上流セッション) |

### 2.7 飛行日誌(P5、2026-10-17 追補 §5.5 / §5.6 / §5.9)
記録系は追記のみ: 訂正は `supersedes` 付きの新規行で、一覧・出力は訂正済みの行を隠す。訂正済みの行への PATCH / DELETE / 記事追加は `409 superseded`。
| メソッド | パス | 本文 / 応答 |
|---|---|---|
| GET / PUT | `/api/vehicles/{sysid}/registry` | `VehicleRegistry`(PUT は admin、`VehicleRegistryInput`。監査 `registry_put`) |
| GET / PUT | `/api/users/me/pilot` | `PilotInfo` / `PilotInput`(氏名・技能証明書番号) |
| GET / POST | `/api/inspection/templates` | `[InspectionTemplate]` / `InspectionTemplateInput` → 201(admin) |
| PUT / DELETE | `/api/inspection/templates/{id}` | 置換(version + 1)/ 削除(admin。最後の 1 件は `409 last_template`) |
| GET | `/api/vehicles/{sysid}/inspections/template` | 機体に割り当てた(なければ id 1 の)テンプレート |
| GET / POST | `/api/vehicles/{sysid}/inspections?from=&to=&limit=` | `[InspectionRun]`(新しい順)/ `InspectionRunInput` → 201(結果数はテンプレート項目数と一致、監査 `inspection_save`) |
| GET / POST | `/api/vehicles/{sysid}/flights?from=&to=` | `[Flight]`(離陸順、`flight_minutes` 切り上げ、`total_minutes` = 台帳初期値 + 着陸済み飛行の積算)/ 手入力 `FlightInput` → 201(下書き) |
| PATCH / DELETE | `/api/vehicles/{sysid}/flights/{id}` | `FlightPatch`(下書きはその場で更新、`status: confirmed` で確定(飛行中は 400)。確定済みは訂正行を返す)/ 下書きのみ削除(`409 confirmed`) |
| POST | `/api/vehicles/{sysid}/flights/{id}/squawks` | `FlightSquawkInput` → 201 `FlightSquawk` |
| GET / POST | `/api/vehicles/{sysid}/maintenance?from=&to=` | `[MaintenanceRecord]` / `MaintenanceInput` → 201(`total_minutes` はその時点の積算) |
| GET | `/api/vehicles/{sysid}/logs` | `{fetch_enabled, logs: [FlightLog]}` |
| GET | `/api/vehicles/{sysid}/logs/fc` | 機体内の `[FcLogEntry]`(`503 log_fetch_disabled` / `409 busy` / `504 timeout`) |
| POST | `/api/vehicles/{sysid}/logs/fetch` | `{fc_log_id, flight_id?}` → 202。`LOG_REQUEST_DATA` を 2,880 B ずつ、欠けは先頭から再要求、`data_dir/logs/<sysid>/` に保存、`log_fetch_progress`、監査 `log_fetch`。1 GiB 超は `413 too_large` |
| GET | `/api/vehicles/{sysid}/logs/{id}/file` | `.bin` を添付でストリーム |
| POST | `/api/vehicles/{sysid}/logs/upload?filename=&flight_id=` | 本文 = ファイルそのもの(≤ 1 GiB、超過は `413`)→ 201 `FlightLog` |
| PATCH | `/api/vehicles/{sysid}/logs/{id}` | `{flight_id \| null}`(訂正済みの飛行には不可。監査 `log_attach`) |
| GET | `/api/vehicles/{sysid}/logbook/export?form=1\|2\|3&from=&to=&format=pdf\|csv` | 様式 1 / 2 / 3 を `application/pdf`(Noto Sans JP 同梱、日英見出し、NR 連番)または `text/csv`(BOM + CRLF、日本語見出し)で添付 |

`config.toml` `log_fetch = "auto" | "on" | "off"`(auto: tcp/udp と 921600 bps 以上のシリアルで有効)。

### 2.8 ネットワーク(M5、案、80 §4)
| メソッド | パス | 本文 |
|---|---|---|
| GET | `/api/network` | `NetworkTopology`(現場、機体ごとのノード・COMPID・LTE 状態・経路、メッシュの SNR、ユーザー、外部サービス) |

## 3. WebSocket `/ws`

- 1 セッション 1 接続。サーバー → クライアントは JSON テキストフレーム `{ "t": "<type>", ... }`。クライアント → サーバーも同形式。
- 接続直後にサーバーが `snapshot`(全機体の `VehicleState`、全カメラの `caps + state`)を送る。

### 3.1 サーバー → クライアント
| `t` | ペイロード | 周期 |
|---|---|---|
| `snapshot` | `{vehicles: [VehicleState], cameras: [CameraSnapshot{sysid, caps, state}], video_sources: [{sysid, status}]}` | 接続時 |
| `telemetry` | `{sysid, diff: Partial<VehicleState>}` | 10 Hz(変化分のみ) |
| `camera_state` | `{sysid, caps: CameraCaps, state: CameraState}` | 変化時 + 1 Hz(サーバーが再送。caps を毎回載せるので再読込なしに種別変更が反映される) |
| `roi_status` | `{sysid, status: RoiStatus}` | 2 Hz(追従中) |
| `video_source` | `{sysid, status: VideoSourceStatus}` | 変化時 + 1 Hz(サーバーが再送) |
| `vehicle_message` | `{sysid, id, severity, text, ts}`。機体の STATUSTEXT は原文(50 バイトのチャンクはサーバーで結合)。サーバー生成の `text` は固定コード `comms_delay` / `link_lost` / `link_restored`(UI が翻訳) | 発生時 |
| `command_result` | `{id, sysid, cmd, ok, reason?, ts}` | 完了時 |
| `message_ack` | `{sysid, id, by, ts}` | 確認時 |
| `network_status` | `{diff: Partial<NetworkTopology>}` | 1 Hz(M5、80 §4) |
| `vehicle_discovered` / `vehicle_lost` | `{sysid}` | 発生時 |
| `mission_progress` | `{sysid, progress: {seq, total}}` | `MISSION_CURRENT` の変化時 + 1 Hz(サーバーが再送)。`total` はサーバーが書込 / 読込したミッションの項目数(未知なら機体の `MISSION_CURRENT.total`) |
| `flight_draft_created` | `{sysid, flight: Flight}` | DISARM 時(初回 ARM から最後の DISARM までが 1 飛行。10 分以内の再 ARM は同じ飛行、リンク喪失 10 分で最終受信時刻に着陸扱い) |
| `log_fetch_progress` | `{sysid, progress: {fc_log_id, received, total, done, error?}}` | 64 KB ごとと完了時 |
| `input_state` | `{deadman: ok\|lost}` | 変化時(`input_hb` 1.5 s 途絶で `lost`、サーバーは速度 0 を 1 回送る) |
| `error` | `{code, message}` | 入力拒否時 |

### 3.2 クライアント → サーバー
| `t` | ペイロード | 周期 / 規則 |
|---|---|---|
| `gimbal_rate` | `{sysid, yaw: -100..100, pitch: -100..100, seq}` | ≤20 Hz。25 Hz 超は間引き。caps.gimbal.rate が無ければ `error` |
| `manual` | `{sysid, x, y, z, r, buttons}` | 50 Hz(M4) |
| `input_hb` | `{sysid}` | 1 Hz。1.5 s 途絶で速度 0 / ニュートラル送信、`input_state: lost` |
| `select` | `{sysid}` | 入力対象の切替(サーバーは前の対象に 0 を送る) |

## 4. 型(抜粋、ts-rs 生成)

```ts
type VehicleState = { sysid: number; name: string; kind: 'copter'|'rover'; mode: string; armed: boolean;
  lat: number; lon: number; alt_rel: number; alt_msl: number; hdg: number; ground_speed: number;
  battery: { pct: number; volt: number; current: number }; link: 'ok'|'delay'|'lost'; last_rx_ms: number;
  gps: { fix: number; sats: number; hdop: number }; warn: boolean; unread: number };
type CameraProfile = { kind: 'none'|'mavlink'|'siyi_mt11'; host: string; port: number; rtsp_url: string;
  video_source_mode: 'auto'|'mt11'|'android'; android_url: string; encoding_preset: string;
  thermal_palette: number; thermal_overlay: boolean; ai_box_px: number; clock_sync: boolean; comp_id: number };
type RoiTarget = { id: string; name: string; lat: number; lon: number; alt_msl: number };
type RoiControl = { control_mode: 'rate'|'angle'; rate_hz: number; target_rate_hz: number; smoothing_tau_s: number;
  deadband_deg: number; pid_kp: number; pid_ki: number; pid_kd: number; max_speed: number; yaw_offset_deg: number };
type GimbalInputProfile = { enabled: boolean; device_name: string; max_pan_speed: number; max_tilt_speed: number;
  zoom_step_hz: number; axes: { axis_id: number; function: AxisFn; deadzone: number; invert: boolean; scale: number }[];
  buttons: { button_id: number; function: ButtonFn }[] };
```

## 5. edge ⇄ hub(M5)

- 2026-10-18: 構成を 80 に改めた(クラウドの RGCS Hub は AWS IoT Core を応用し、ノード ⇄ Hub は MQTT)。以下は旧案で、M5 で 80 に合わせて書き直す。

- edge は hub へ `wss://hub/edge`(mTLS)で接続し、§3.1 のメッセージをそのまま転送する(`sysid` は hub が名前空間を付与)。
- hub → edge: `{t:'command', ...}`(§2.2 / 2.3 の本文 + hub 側の監査 ID)、`gimbal_rate` / `manual` / `input_hb` の透過転送。
- 映像: hub の `POST …/video/whep` は edge の同 API へ中継。

## 6. 受け入れ条件

- OpenAPI(utoipa)を `/api/openapi.json` で配信し、UI のクライアントはそこから生成する。
- 認証なしの `/api/vehicles` は 401、`/ws` はハンドシェイク拒否。
- `GimbalRate` を REST に送ると 409 `unsupported_capability`。
- WS の `telemetry` が 20 機でも 10 Hz を維持(負荷試験)。
