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
| GET / PUT | `/api/vehicles/{sysid}/params` | `[{name, value}]` / `{changes: [{name, value}]}` → 書戻し検証結果 |
| GET | `/api/vehicles/{sysid}/messages?since=` | `[{ts, severity, text, acked}]` |
| POST | `/api/vehicles/{sysid}/messages/{id}/ack` | — |
| GET / PUT | `/api/vehicles/{sysid}/mission` | `Mission` / `Mission` → 検証警告 + 書込結果 |
| POST | `/api/vehicles/{sysid}/calibration` | `{kind: accel\|compass\|level\|rc\|esc}` |

`cmd` の列挙: `pause`, `resume`, `rtl`, `land`, `change_alt`, `change_speed`, `set_mode`, `mission_start`, `mission_resume`, `arm`, `disarm`, `other(mav_cmd, params)`。

### 2.3 カメラ
| メソッド | パス | 本文 / 応答 |
|---|---|---|
| GET | `/api/vehicles/{sysid}/camera` | → `{caps: CameraCaps, state: CameraState}` |
| POST | `/api/vehicles/{sysid}/camera/command` | `CameraCommand`(`GimbalRate` は WS 専用 → `409 ws_only`; caps に無い → `409 unsupported_capability`; 未接続 → `503 camera_offline`。監査 target `camera`) |
| GET / PUT | `/api/vehicles/{sysid}/camera/profile` | `CameraProfile`(60 §3)。PUT は部分更新(省略した項目は保持)、`400 validation` はフィールド名入り。保存後にドライバと映像監視を再生成 |
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
| GET / PUT | `/api/settings/app` | `{lang, map_tile_url, map_attribution}`(P1 は GET のみ。`log_dir, tile_cache, terrain` は P4+) |
| GET | `/api/history/params?sysid=&limit=` | `[{ts, operator, sysid, name, from, to}]` |
| GET | `/api/history/audit?limit=` | `[{ts, operator, sysid, command, result}]` |

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

## 3. WebSocket `/ws`

- 1 セッション 1 接続。サーバー → クライアントは JSON テキストフレーム `{ "t": "<type>", ... }`。クライアント → サーバーも同形式。
- 接続直後にサーバーが `snapshot`(全機体の `VehicleState`、全カメラの `caps + state`)を送る。

### 3.1 サーバー → クライアント
| `t` | ペイロード | 周期 |
|---|---|---|
| `snapshot` | `{vehicles: [VehicleState], cameras: [CameraSnapshot{sysid, caps, state}]}` | 接続時 |
| `telemetry` | `{sysid, diff: Partial<VehicleState>}` | 10 Hz(変化分のみ) |
| `camera_state` | `{sysid, state: CameraState}` | 変化時 + 1 Hz(サーバーが再送) |
| `roi_status` | `{sysid, status: RoiStatus}` | 2 Hz(追従中) |
| `video_source` | `{sysid, status: VideoSourceStatus}` | 変化時 |
| `vehicle_message` | `{sysid, id, severity, text, ts}`。機体の STATUSTEXT は原文(50 バイトのチャンクはサーバーで結合)。サーバー生成の `text` は固定コード `comms_delay` / `link_lost` / `link_restored`(UI が翻訳) | 発生時 |
| `command_result` | `{id, sysid, cmd, ok, reason?, ts}` | 完了時 |
| `vehicle_discovered` / `vehicle_lost` | `{sysid}` | 発生時 |
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

- edge は hub へ `wss://hub/edge`(mTLS)で接続し、§3.1 のメッセージをそのまま転送する(`sysid` は hub が名前空間を付与)。
- hub → edge: `{t:'command', ...}`(§2.2 / 2.3 の本文 + hub 側の監査 ID)、`gimbal_rate` / `manual` / `input_hb` の透過転送。
- 映像: hub の `POST …/video/whep` は edge の同 API へ中継。

## 6. 受け入れ条件

- OpenAPI(utoipa)を `/api/openapi.json` で配信し、UI のクライアントはそこから生成する。
- 認証なしの `/api/vehicles` は 401、`/ws` はハンドシェイク拒否。
- `GimbalRate` を REST に送ると 409 `unsupported_capability`。
- WS の `telemetry` が 20 機でも 10 Hz を維持(負荷試験)。
