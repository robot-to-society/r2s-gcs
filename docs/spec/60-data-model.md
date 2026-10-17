# RGCS 仕様書 60 — データモデル・永続化

- 版: 0.1(2026-10-16)
- ストア: SQLite(`sqlx`、WAL)。ファイル `/var/lib/rgcs/rgcs.db`。マイグレーションは `crates/rgcs-store/migrations/*.sql`(`sqlx migrate`)
- 検証: Rust 側は `TryFrom`(範囲・形式)、UI 側は zod。両者は ts-rs 生成型 + 本書の範囲表から導き、乖離をテストで検出する

## 1. 方針

- 設定は全て DB(ファイル編集を不要にする)。`config.toml` は起動に必要な最小限(リッスン、MAVLink URL、データディレクトリ、役割)だけ。
- 機体に紐づく設定は `sysid` キー。スタンドアローン版では sysid は 1 つだが、構造は多機体。
- 監査系(`audit_log`, `param_history`)は追記のみ。削除 API を持たない。
- 時刻は UTC の ISO 8601 文字列(`TEXT`)で保存し、表示時にローカルへ。

## 2. テーブル一覧

| テーブル | 役割 | 由来 |
|---|---|---|
| `users` | ログインユーザー | 新規(ログイン = オペレータ) |
| `sessions` | セッション(tower-sessions) | 新規 |
| `audit_log` | 送信操作の記録 | 旧設計 |
| `param_history` | パラメータ変更履歴 | 旧設計 |
| `vehicles` | 既知の機体の表示名・種別 | 旧設計 |
| `camera_profiles` | 機体ごとのカメラ設定 | 新規(Python 版 `camera.host` + 環境変数) |
| `roi_targets` | ROI プリセット | Python 版 `roi_config.json.targets` |
| `roi_control` | ROI 制御パラメータ | Python 版 `roi_config.json` |
| `gimbal_input_profile` | ジンバル用ジョイスティック | Python 版 `joystick_config.json` |
| `vehicle_input_profile` | 機体操作用ジョイスティック(M4) | 旧設計 `input_profiles` |
| `app_settings` | 言語・保存先など | 旧設計 |
| `missions` | 保存ミッション(P3) | 旧設計 |
| `inspection_templates` / `inspection_template_items` | 日常点検テンプレート(P5) | 追補 §5.5 |
| `inspection_runs` / `inspection_results` | 日常点検の実施記録 = 様式 2(P5) | 追補 §5.5 |
| `flights` / `flight_squawks` | 飛行記録 = 様式 1 と不具合記事(P5) | 追補 §5.6 |
| `maintenance_records` | 点検整備記録 = 様式 3(P5) | 追補 §5.6 |
| `flight_logs` | 取り出した DataFlash の保管(P5) | 追補 §5.6 |
| `presentation_tokens` | 観客用画面の提示トークン(P2) | 追補 §5.1 |

## 3. 定義

### 3.1 users / sessions
```sql
CREATE TABLE users (
  username      TEXT PRIMARY KEY,          -- 1..32, [A-Za-z0-9_.-]
  password_hash TEXT NOT NULL,             -- argon2id
  role          TEXT NOT NULL CHECK (role IN ('operator','admin')),
  created_at    TEXT NOT NULL,
  disabled      INTEGER NOT NULL DEFAULT 0
);
```
- 初期シード: `admin` / `admin`(role admin)。起動時にこのペアでログインできる状態なら `dev_mode = true` を `/api/auth/me` に返し、UI は「開発用」バッジを出す。
- `sessions` は tower-sessions の SQLite ストア標準スキーマ。有効期限 12 h、操作で延長。

### 3.2 audit_log / param_history
```sql
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY, ts TEXT NOT NULL, operator TEXT NOT NULL,
  sysid INTEGER, target TEXT NOT NULL,     -- 'vehicle' | 'camera' | 'settings'
  command TEXT NOT NULL, args TEXT,        -- JSON
  result TEXT NOT NULL,                    -- 'ok' | 'rejected' | 'failed' | 'timeout'
  reason TEXT
);
CREATE TABLE param_history (
  id INTEGER PRIMARY KEY, ts TEXT NOT NULL, operator TEXT NOT NULL, sysid INTEGER NOT NULL,
  name TEXT NOT NULL, old_value REAL, new_value REAL NOT NULL, verified INTEGER NOT NULL
);
```
`operator` はセッションの `username`。

### 3.3 camera_profiles
| 列 | 型 | 既定 | 範囲 / 形式 |
|---|---|---|---|
| `sysid` | INTEGER PK | — | |
| `kind` | TEXT | `none` | `none` / `mavlink` / `siyi_mt11` |
| `host` | TEXT | `192.168.144.25` | IPv4 ドットアドレス(ホスト名不可、RTSP URL 生成に使う) |
| `port` | INTEGER | 37260 | 1–65535 |
| `rtsp_url` | TEXT | `rtsp://{host}:8554/video1` | `rtsp://` で始まる。MT11 は `{host}` 展開、MAVLink は任意 |
| `comp_id` | INTEGER | 100 | 1–255(MAVLink カメラ) |
| `video_source_mode` | TEXT | `auto` | `auto` / `mt11` / `android` |
| `android_url` | TEXT | `http://127.0.0.1:8080` | 空で Android ソース無効 |
| `encoding_preset` | TEXT | `h264_1080p` | `h264_720p` / `h264_1080p` / `h264_4k` / `h265_1080p` / `h265_4k` |
| `thermal_palette` | INTEGER | 3 | 0, 2–11 |
| `thermal_overlay` | INTEGER | 1 | bool |
| `ai_box_px` | INTEGER | 100 | 32–600 |
| `clock_sync` | INTEGER | 1 | bool |
| `auto_record` | INTEGER | 1 | bool(ARM で録画開始、DISARM で停止) |
| `updated_at` | TEXT | | |

### 3.4 roi_targets / roi_control
| 列 | 型 | 既定 | 範囲 |
|---|---|---|---|
| `sysid`, `id` | PK | | `id` は `roi_1`..`roi_10` 固定 |
| `name` | TEXT | `''` | ≤64 文字。空 = 未設定(UI・マーカーに出ない) |
| `lat` / `lon` | REAL | 0 | −90..90 / −180..180 |
| `alt_msl` | REAL | 0 | −500..9000(海抜 m) |

| 列(roi_control) | 既定 | 範囲 |
|---|---|---|
| `control_mode` | `rate` | `rate` / `angle` |
| `rate_hz` | 10 | 0 < x ≤ 50 |
| `target_rate_hz` | 2 | 0.2–10 |
| `smoothing_tau_s` | 0.8 | 0–10 |
| `deadband_deg` | 0.3 | 0–5 |
| `pid_kp` / `pid_ki` / `pid_kd` | 2.0 / 0.2 / 0 | 0–50 / 0–20 / 0–10 |
| `max_speed` | 60 | 1–100 |
| `yaw_offset_deg` | 0 | −180..180 |

(範囲は Python 版 `RoiConfig` と同一。)

### 3.5 gimbal_input_profile(単一行 `id = 1`)
| 列 | 既定 | 範囲 |
|---|---|---|
| `enabled` | 0 | bool |
| `device_name` | `''` | Gamepad API の `id` 前方一致 |
| `max_pan_speed` / `max_tilt_speed` | 30 / 20 | 1–100 |
| `zoom_step_hz` | 2.0 | 0.5–10 |
| `axes` | JSON | `[{axis_id 0–15, function ∈ AxisFn, deadzone 0–0.5, invert, scale 0.1–2}]`、`axis_id` 重複不可 |
| `buttons` | JSON | `[{button_id 0–31, function ∈ ButtonFn}]`、重複不可 |

`AxisFn` / `ButtonFn` は 40 §6 の一覧。未知の機能名は 422。

### 3.6 vehicle_input_profile(M4)
`enabled`, `device_name`, `mode`(`manual_control` / `rc_override`), `axes`(roll / pitch / throttle / yaw)、`buttons`(arm_hold / rtl_hold / mode_x…)、`rate_hz` 50。

### 3.7 app_settings(key-value)
`lang`(`ja` / `en`)、`log_dir`、`tile_cache_path`、`terrain_path`、`units`(metric 固定)。

### 3.8 vehicles / missions
- `vehicles(sysid PK, name, kind, first_seen, last_seen, notes)`。表示名は `UAV-xx` 既定、UI で変更可。
- `missions(id PK, name, sysid, default_alt, default_frame, speed, items JSON, created_at, updated_at)`。

### 3.9 P2 で追加した表(2026-10-17)
- `camera_profiles`: §3.3 の通り(マイグレーション `0002_camera.sql`)。`rtsp_url` のホストは `{host}` かカメラの IP そのものに限る(プローブを他ホストに向けさせない)。
- `gimbal_input_profile(id = 1, json, updated_at)`: `GimbalInputProfile` を JSON で 1 行。
- `presentation_tokens(token PK, label, created_by, created_at, revoked_at)`: 32 桁 16 進。一覧は先頭 6 文字だけを返す。

## 4. 検証の二重化

- サーバー: `impl TryFrom<CameraProfileInput> for CameraProfile` 等で範囲を検査し、違反は `422 validation` に `details: {field, reason}`。
- UI: `schemas/*.ts` に zod スキーマ。保存ボタン押下前に同じ範囲で赤表示。
- テスト: `crates/rgcs-store/tests/ranges.rs` が本書の表を読み込んで境界値を往復させ、UI 側は `schemas.test.ts` が同じ表を使う(表は `docs/spec/ranges.json` として両方から参照、本書の表と差分が出たら CI で落とす)。

## 5. マイグレーション方針

- 追加のみ(列の削除・型変更は新テーブル + コピー)。
- Python 版からの取込: 初回起動時に `/home/pi/siyi-mt11-cameracontrol/app/roi_config.json` と `joystick_config.json` があれば `roi_targets` / `roi_control` / `gimbal_input_profile` に取り込み、ログに記録する(1 回限り、`app_settings.imported_python = 1`)。
- バックアップ: `rgcs-cli db backup` で `.db` をコピー(WAL チェックポイント後)。

## 6. 受け入れ条件

- 全テーブルの境界値テストが通る(両側)。
- Python 版の設定ファイルを置いた Pi で初回起動すると、ROI プリセットと軸割当が UI に出る。
- `audit_log` に DELETE / UPDATE の経路が無い(コードレビュー項目)。
