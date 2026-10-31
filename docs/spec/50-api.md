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
- エラーコード(抜粋): `unauthorized`(401)/ `locked`(429)/ `validation`(422)/ `not_found`(404)/ `confirm_required`(409)/ `unsupported_capability`(409)/ カメラの拒否 `rgb_only` / `thermal_only` / `stream_unknown` / `no_detection` / `clock_sync_off` / `camera_rejected`(409、§2.3)/ `camera_disconnected`(503)/ `link_lost`(503)/ `rate_limited`(429)/ `internal`(500)。
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
| POST | `/api/vehicles/{sysid}/command` | `{cmd, args, confirm_token?, ai_proposal_id?}` → `{id}`(結果は WS `command_result`)。`ai_proposal_id` は下記 |
| POST | `/api/vehicles/{sysid}/confirm` | `{cmd}` → `{confirm_token, expires_in: 30}`(70 §1) |
| POST | `/api/vehicles/{sysid}/guided` | `{lat, lon, alt_mode: keep\|set, alt_rel?, confirm_token?}` → `{id, warning?: "fence_unknown"}`。`409 mode_required`(GUIDED 以外)/ `409 confirm_required`(機体ごと初回)/ `409 fence_alt`(`FENCE_ENABLE`=1 かつ `FENCE_ALT_MAX` 超)/ `400 invalid` / `503 link_lost`。フェンス値が未取得なら `PARAM_REQUEST_READ` を送って `fence_unknown` 付きで通す |
| GET / PUT | `/api/vehicles/{sysid}/params` | GET: `{entries: [{name, value, index, ptype}], progress}` / PUT: `{changes: [{name, value}], confirm_token}` → `[{name, requested, actual, verified, reason?}]`(要確認 `param_write`、アーム中は `409 vehicle_armed`、各変更の前にインターロック再確認、≤ 50 件、名前 ≤ 16 文字) |
| POST | `/api/vehicles/{sysid}/params/refresh` | 全件取得を開始 → `202 {received, total, complete, downloading}`(実行中なら現状を返す) |
| GET | `/api/vehicles/{sysid}/params/progress` | `{received, total, complete, downloading}`(WS `param_progress` でも 25 件ごと + 完了時に配信) |
| GET | `/api/vehicles/{sysid}/messages?since=` | `[{id, ts, severity, text, acked_by?, acked_at?}]` |
| POST | `/api/vehicles/{sysid}/messages/{id}/ack` | 警告・エラー(STATUSTEXT severity ≤ 4、またはサーバー生成の警告)だけ受け付ける。それ以外は `400 not_ackable`。結果は WS `message_ack` で全クライアントへ。監査 `message_ack` |
| GET | `/api/messages?since=&severity=&sysid=&limit=` | 全体ログ(機体メッセージ + `command_result` + システム)。新しい順、`limit` 既定 500。フッターと履歴シートの初期表示(10 §1) |
| GET | `/api/vehicles/{sysid}/calibration` | `{records: CalibRecord[], session: CalibStatus\|null}`。`records` は種類ごとの最新の実施(ArduPilot は校正日を持たないため RGCS が `calibrations` 表に記録、2026-10-20) |
| POST | `/api/vehicles/{sysid}/calibration` | `{kind: accel\|compass\|level\|rc\|esc, confirm_token?}` → `CalibStatus`。accel = `PREFLIGHT_CALIBRATION` p5=1(6 姿勢、機体の `COMMAND_LONG ACCELCAL_VEHICLE_POS` で進む)/ level = p5=2 / compass = `DO_START_MAG_CAL`(全コンパス、autosave、`MAG_CAL_PROGRESS` / `MAG_CAL_REPORT`)/ rc = `RC_CHANNELS` を 10 Hz で要求し最小・最大を記録 / esc = `ESC_CALIBRATION`=3 を書込(次回起動時に自動校正、要確認 `calib_esc`)。アーム中 `409 vehicle_armed`、実行中 `409 busy`、未接続 404、`503 link_lost`。監査 `calibration` |
| POST | `/api/vehicles/{sysid}/calibration/next` | 加速度計: 要求された姿勢に置いた → `ACCELCAL_VEHICLE_POS`(p1 = 姿勢)。待機中でなければ `409 not_waiting` |
| POST | `/api/vehicles/{sysid}/calibration/cancel` | compass は `DO_CANCEL_MAG_CAL`、rc は `RC_CHANNELS` の間隔を既定(0)へ戻す。`409 not_running` |
| POST | `/api/vehicles/{sysid}/calibration/finish` | rc のみ: 400 µs 以上動いたチャンネルの `RCn_MIN / MAX / TRIM`(TRIM = 終了時の位置)を書込・照合(変更履歴に残る)。動いたチャンネルが無ければ `failed: rc_not_moved` |
| POST | `/api/vehicles/{sysid}/motor-test` | `{motor: 1–12, pct: 0<–100, seconds: 0<–10, count?, confirm_token}` → `{ok, reason?}`。`DO_MOTOR_TEST`(p2=0 スロットル %、`count` > 0 で `motor` から順に `count` 個)。要確認 `motor_test`、アーム中 409。実施は `calibrations` に `motor` として記録 |

`cmd` の列挙: `pause`, `resume`, `rtl`, `land`, `change_alt`, `change_speed`, `set_mode`, `mission_start`, `mission_resume`, `takeoff(alt_rel)`, `arm`, `disarm`, `other(mav_cmd, params)`。`other` で送れる MAV_CMD は 70 §1(`422 not_allowed`)。

`ai_proposal_id`(2026-10-24、AI の提案カードの「実行」): 提案(§2.5)が存在し、呼び出したユーザーのもので、`pending`、`(sysid, cmd)` が一致し、期限内(120 s)であること。確認トークンの検査より先に見る。`404 proposal_not_found` / `403 forbidden`(他人の提案)/ `409 proposal_mismatch` / `409 proposal_expired` / `409 proposal_used`(実行済み・却下済み)。いずれも監査に `rejected`。受け付けた時点で `executed` にし(1 回だけ)、値域・確認・事前チェック・キューで拒否されたら `pending` に戻す。監査の `args` は `{"ai_proposal_id":"p-…","args":…,"cmd":"…"}`。

`takeoff`(2026-10-23、要確認): `alt_rel` はホーム相対 m、有限の 1〜1000(外れは `400 invalid`)。ARM 済みのみ(DISARM 中は `409 rejected` "arm first")、Rover / その他は `422 not_allowed`。機体ごとの送り方: Copter と QuadPlane は GUIDED でなければ先に `DO_SET_MODE` GUIDED、ACK 後に `COMMAND_LONG` `MAV_CMD_NAV_TAKEOFF`(param7 = `alt_rel`)。固定翼(VTOL でない Plane)は NAV_TAKEOFF を受け付けないので TAKEOFF モード(custom mode 13)へ切替え、`TKOFF_ALT` まで上昇(`alt_rel` は使わず、パラメータも書かない)。各段の ACK を待ち、どちらかの失敗をそのまま `command_result` の理由にする。

### 2.2.1 ミッション(P3、2026-10-17 追補 §5.2 / §5.9)
| メソッド | パス | 本文 / 応答 |
|---|---|---|
| PUT | `/api/vehicles/{sysid}/mission` | `Mission` → `UploadReport{items, verified, mismatched[], findings[]}`。書込 → 読込 → 一致検証。書込が済むと機体の書込記録を消す(内容そのものの書込はどの保存済みプランの版とも言えないため、2026-10-31)。`409 mission_busy` / `409 mission_invalid`(`data.findings` に致命) / `409 mission_rejected`(MISSION_ACK) / `503 link_lost` / `504 mission_timeout`(1.5 s × 3 回)。監査 target `mission` |
| GET / PUT | `/api/vehicles/{sysid}/fence` | PUT `{zones: FenceZone[]}` → `UploadReport`。`FenceZone` = `{kind: "polygon", inclusion, vertices: [{lat, lon}]}` / `{kind: "circle", inclusion, center, radius}`。`MAV_MISSION_TYPE_FENCE` で書込(ホームなし、ポリゴンは頂点を連続で 5001 / 5002 + param1 = 頂点数、円は 5003 / 5004 + param1 = 半径 m)→ 読込 → 一致検証。`409 fence_invalid`(頂点 3〜255、半径 > 0、緯度経度の範囲。`data.findings`)。GET `{zones}`(リターンポイント 5000 は Copter が使わないので読み飛ばす)。監査 target `fence` |
| GET | `/api/vehicles/{sysid}/fence/params` | `FenceParams{enabled, alt_max, alt_max_on, zones_on}`(キャッシュから。未取得の項目は機体に問い合わせて最大 ~1 s 待つ。`alt_max_on` = FENCE_TYPE bit 0、`zones_on` = bit 2) |
| GET / PUT | `/api/vehicles/{sysid}/rally` | PUT `{points: [{lat, lon, alt}]}`(alt はホーム相対 m。整数 m に丸める = ArduPilot int16)→ `UploadReport`。`MAV_MISSION_TYPE_RALLY`、5100。`409 rally_invalid`(緯度経度の範囲、±10000 m)。GET `{points}`。監査 target `rally` |
| POST | `/api/vehicles/{sysid}/mission/upload` | `{mission_id}` → 保存済みミッションを同じ手順で書込。照合まで成功すると機体の書込記録(`plan_assignments.written_*` = プラン id・版 `updated_at`・時刻・人)を付け、読み戻しが合わなければ記録を消す。どちらも `assignments` フレームを流す(2026-10-31、§2.2.2) |
| GET | `/api/vehicles/{sysid}/mission` | 機体から読込 → `Mission`(`sysid` 入り) |
| GET | `/api/vehicles/{sysid}/mission/progress` | → `MissionProgress{seq, total}` または `null`(`total` = 項目数) |
| GET | `/api/vehicles/{sysid}/mission/known` | サーバーが最後に書込 / 読込した機体のミッション → `Mission` または `null`(再読込した画面の経路 / 進捗表示に使う) |
| GET / POST | `/api/missions` | 一覧 `[MissionSummaryRow]` / `Mission` → `201 Mission`(id 付き)。`name` 1〜64 文字、`items` ≤ 700(`400 validation`) |
| GET / PUT / DELETE | `/api/missions/{id}` | `Mission` / `Mission` → `Mission` / `204` |
| GET | `/api/missions/{id}/export?format=waypoints` | `text/plain`、`Content-Disposition: attachment; filename="<name>.waypoints"`(QGC WPL 110、行 0 = home) |
| POST | `/api/missions/import` | 本文 = `.waypoints` テキスト(≤ 1 MB)、`X-Mission-Name` → 未保存の `Mission`。`400 invalid_waypoints` |
| POST | `/api/missions/validate?sysid=` | `Mission` → `{findings: [Finding{level, code, seq, message}], stats: {distance_m, duration_s, max_alt}}`。`sysid` があれば機体のフェンス値で判定(未取得なら `fence_unknown` を付け `PARAM_REQUEST_READ`) |

`Finding.code`: 致命 `empty` / `first_not_takeoff` / `fence_alt` / `fence_radius` / `jump_target`、警告 `fence_unknown` / `fence_frame_unchecked` / `mixed_frames` / `terrain_frame` / `zero_position` / `no_land_or_rtl` / `long_flight` / `param_ignored`(ArduPilot の AP_Mission が保存しない、または値を変えて保存する非ゼロのパラメータ。`seq` は該当項目、`message` にコマンド名とパラメータ番号、`param` に `{index, sent, stored}`(index は MAVLink の 1–7、UI はこれで「どのパラメータが何として保存されるか」を表示する)。他のコードには `param` は付かない。機体種別が不明なときは全ビルドで失われるものだけ。予測は `rgcs_core::as_stored`、アップロードの照合も同じ予測と比較する)。

### 2.2.2 フライトプラン(2026-10-31)
画面の「フライトプラン」は API の保存済みミッション(`/api/missions`)そのもので、`id` がプラン ID。`DELETE /api/missions/{id}` は `204`(本文なし)、無ければ `404 not_found`。2026-10-20 に足したブリーフィング(`/api/briefings`、名前付きのミッションの組)は 2026-10-31 に廃止した(マイグレーション `0014_drop_briefings.sql` で表ごと削除。保存済みの組は移行しない)。

機体ごとのプランの割当(2026-10-31、割当モード spec 10 §6.6、表は spec 60 §3.12)。1 プランを複数機に割り当てられ、1 機には 1 プラン。

| メソッド | パス | 本文 / 応答 |
|---|---|---|
| GET | `/api/assignments` | → `[Assignment{sysid, plan_id \| null, assigned_by \| null, assigned_at \| null, written: Written{plan_id, plan_updated_at, at, by} \| null}]`(行のある機体だけ、sysid 昇順。時刻は unix ms) |
| PUT | `/api/assignments/{sysid}` | `{plan_id: number \| null}`(null で外す)→ `Assignment`。行が無ければ作る。書込記録はそのまま残す。無いプランは `404 not_found`。監査 target `assignment`(`assign` / `unassign`、args `{plan_id}`)。変更のたびに全行を `assignments` フレームで流す |

- プランを削除すると、それを割り当てていた行は `plan_id = NULL` になる(書込記録は履歴として残る)。
- 書込記録を付けるのは保存済みプランの書込(`POST …/mission/upload {mission_id}`)が照合まで成功したときだけ。内容そのものの書込(`PUT …/mission`)や読み戻し不一致では記録を消す。フェンス・ラリーの書込は記録に触れない。

### 2.2.4 ドコモ LTE エリア(2026-10-31、実験・社内評価用)
ドコモ公開のサービスエリア地図タイルを、画面で選んだ矩形ごとにサーバーが取得・保存し、同一オリジンで配る(設計 `docs/superpowers/specs/2026-10-31-docomo-lte-overlay-design.md`)。すべてログイン必須。取得は手動だけ。取得元は config.toml `lte_tile_url`。
| メソッド | パス | 本文 / 応答 |
|---|---|---|
| GET | `/api/lte/areas` | → `[LteArea{id, name, south, west, north, east, status: idle \| fetching \| ready \| partial \| failed, tiles_total, tiles_ok, tiles_failed, fetched_at \| null, data_modified \| null, last_error \| null, created_at}]`(id 昇順、時刻は unix ms。取得中は UI が 1 秒ごとに読み直して進捗を出す) |
| POST | `/api/lte/areas/estimate` | `{south, west, north, east}` → `LteEstimate{tiles}`(ズーム 8–14 の枚数。上限判定は UI)。矩形が不正なら `400 bad_rect` |
| POST | `/api/lte/areas` | `{name, south, west, north, east}` → `LteArea`(`fetching`)。裏で取得を始める。`400 bad_name`(1–60 文字)/ `bad_rect` / `too_many_tiles`(3000 枚超、何も取得しない) |
| POST | `/api/lte/areas/{id}/refresh` | → `LteArea`(`fetching`、カウンタは 0 から)。取得中は `409 busy`、無ければ `404 not_found` |
| DELETE | `/api/lte/areas/{id}` | → `204`。他の範囲が覆わないタイルも消す。取得中は `409 busy` |
| GET | `/api/lte/tiles/{z}/{x}/{y}.gif` | 保存済みタイル(`image/gif`、`Cache-Control: private, max-age=3600`)。無いときは透明 GIF(`200`、`private, no-cache`)でエラーにしない。範囲外の z / x / y(z > 22 など)は `404` |

- 矩形: `-85 < south < north < 85`、`-180 <= west < east <= 180`。
- 取得: サーバー全体で同時 2 本、間隔 100 ms、タイムアウト 10 s、リダイレクトなし、512 KiB 上限。受け入れるのは 200・`image/gif`・GIF87a/89a・256×256 だけ。失敗は短いコード(`http_<status>` / `html` / `not_gif` / `bad_size` / `too_large` / `timeout` / `connect` / `redirect`)で `last_error` に残し、保存済みタイルは消さない。URL と本文はログに出さない。
- 終了時: 失敗なし `ready`、一部失敗 `partial`、全部失敗 `failed`。サーバー再起動で `fetching` のまま残った行は `partial`(取得済みあり)か `idle` に戻し、`last_error = interrupted`。

### 2.2.3 測量カメラ(2026-10-21)
写真測量(サーベイグリッド)の計画に使う共有カメラ一覧。セッション認証は `/api/missions` と同じ。組込みカメラ `Sony α7R IV 35mm`(センサー 35.7 × 23.8 mm、9504 × 6336 px、焦点距離 35 mm、シャッター 1/1000 s、最小間隔 1.0 s)を初期データとして持つ。
| メソッド | パス | 本文 / 応答 |
|---|---|---|
| GET | `/api/survey-cameras` | `[SurveyCamera{id, name, sensor_w_mm, sensor_h_mm, image_w_px, image_h_px, focal_mm, shutter_s, min_interval_s, builtin}]`(組込みが先、次に名前順) |
| POST | `/api/survey-cameras` | `SurveyCamera{id: null, ...}` → `201 SurveyCamera`(id 付き。クライアントの `builtin: true` は無視され常に `false`) |
| PUT | `/api/survey-cameras/{id}` | `SurveyCamera` → `SurveyCamera` |
| DELETE | `/api/survey-cameras/{id}` | → `{deleted: true}` |

エラー: `400 invalid`(名前 1〜80 文字、数値はすべて有限で 0 より大きい、`shutter_s` ≤ 1。メッセージ入り)、`404 not_found`、`409 builtin`(組込みカメラの PUT / DELETE)。書込みは監査 target `survey_camera`(command `create` / `update` / `delete`)。

### 2.3 カメラ
| メソッド | パス | 本文 / 応答 |
|---|---|---|
| GET | `/api/vehicles/{sysid}/camera` | → `{caps: CameraCaps, state: CameraState}` |
| POST | `/api/vehicles/{sysid}/camera/command` | `CameraCommand`(`GimbalRate` は WS 専用 → `409 ws_only`; 範囲外(正規化座標 0..1、`box_px` 32–600 など)→ `400 validation`; caps に無い → `409 unsupported_capability`; 未接続 → `503 camera_offline`; カメラ側の拒否 → `409` + 固定コード `rgb_only` / `thermal_only` / `stream_unknown` / `no_detection` / `clock_sync_off` / `camera_rejected`(40 §1.2、UI は `camErr_<code>` で訳す)。MAVLink カメラ(2026-10-23、40 §2)は写真 / 録画 / ズーム / フォーカスの `COMMAND_ACK` を待ってから返る(再送なし): ACCEPTED → 成功、それ以外 → `409 camera_rejected`、ACK 無し → `503 camera_error`。ジンバル(`SET_PITCHYAW`)は ACK が無く、リンクに載った時点で成功。`ai_select_box` の `box_px: null` はプロファイルの `ai_box_px` で埋める。`ai_select_box` / `ai_select_point` は送信前に ROI を止める。監査 target `camera`(拒否は reason にコード)) |
| GET / PUT | `/api/vehicles/{sysid}/camera/profile` | `CameraProfile`(60 §3)。PUT は部分更新(省略した項目は保持)、`400 validation` はフィールド名入り。接続の項目(`kind` / `host` / `port` / `rtsp_url` / `comp_id` / `video_source_mode` / `android_url` / `clock_sync`)が変わったときだけ、保存後にドライバと映像監視を再生成する(2026-10-23)。映像タブの項目(`encoding_preset` / `thermal_palette` / `thermal_overlay` / `ai_box_px` / `auto_record`)は保存だけで、カメラへの反映は UI が続けて送るコマンド(10 §5)。起動時にも保存済み(`none` 以外)の全カメラを自動起動 |
| GET / PUT | `/api/vehicles/{sysid}/roi/targets` | `[RoiTarget]`(10 件固定、id `roi_1..roi_10` の順)。PUT は全件置換、不正は `400 validation`(`targets[i].lat` などフィールド名入り)。追従中のスロットを未設定にすると ROI 停止、座標変更は追従継続。監査 target `roi` / command `targets` |
| GET / PUT | `/api/vehicles/{sysid}/roi/control` | `RoiControl`(PUT は全項目、部分更新なし)。不正は `400 validation`。追従中は即時反映。監査 `roi` / `control` |
| POST | `/api/vehicles/{sysid}/roi/start` | `{id}` → `RoiTarget`。未知の id → `404 not_found`、未設定(名前なし or 0,0)→ `409 roi_target_unset`、caps.roi が `computed` / `native` のどちらでもない → `409 unsupported_capability`、カメラ未接続 → `503 camera_offline`。`native`(2026-10-23、40 §4.2)は `DO_SET_ROI_LOCATION` の ACK を待ってから応答する。監査 `roi` / `start`(拒否も `rejected` で記録) |
| POST | `/api/vehicles/{sysid}/roi/stop` | — → `{stopped: bool}`(停止前に非追従なら false)。監査 `roi` / `stop` |
| GET / PUT | `/api/vehicles/{sysid}/video/source` | `{mode: auto\|mt11}` → `VideoSourceStatus`(P2 は Android 無し。PUT は監査 target `video`) |
| POST | `/api/vehicles/{sysid}/video/whep` | `application/sdp`(≤ 64 KB、ICE 収集完了後の offer、trickle 無し)→ `201 application/sdp`。上流は `config.toml` の `whep_upstream`(既定 `http://127.0.0.1:8889/mt11/whep`)。上流不達は `503 video_unavailable` |
| POST | `/api/vehicles/{sysid}/video/stats` | (P2 では未実装。遅延は UI が `getStats()` から算出) |
| GET | `/api/debug/camera/{sysid}/rx` | → `{counts: {"0x50": n…}, last: {...}, firmware}`(未実装。使う UI が無いため移植しない、2026-10-23) |

CSV 取込は UI が解析して `PUT roi/targets`。

ROI 開始 / 停止は REST のみ(`CameraCommand` ではない)。手動入力による ROI 解除(spec 40 §4):
- WS `gimbal_rate` の max(|yaw|, |pitch|) ≥ 5 → 解除してから転送。監査 operator `joystick`、`roi` / `stop`、reason `manual_input`。5 未満と速度 0(デッドマン停止を含む)は追従中は破棄。
- `camera/command` の `gimbal_center` / `gimbal_angle` / `gimbal_mode` → 送信前に解除。監査 `roi` / `stop`、reason `manual_command`(要求者)。
- `camera/profile` PUT → 保存済みプロファイルから変わったときだけ、ドライバ再生成の前に停止。監査 `roi` / `stop`、reason `profile_reload`(要求者)。変わらなければドライバも ROI もそのまま(2026-10-23)。UI の保存も接続欄が変わったときだけ PUT する。

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
`POST /api/logs/open {path}`, `GET /api/logs/{id}/series?keys=`, `POST /api/logs/{id}/analyze`(未実装)。

AI チャット(2026-10-24 実装、提案のみ、70 §4)。ログイン済みの全ユーザー。会話・提案は本人だけが見える。

| メソッド | パス | 本文 / 応答 |
|---|---|---|
| GET | `/api/ai/status` | → `AiStatus {configured, provider: anthropic\|openai_compat\|null, model, reason: "disabled"\|"no_api_key"\|null, budget_left}`(`budget_left` は直近 24 h の残りトークン、無制限なら `null`)。キーは返さない |
| POST | `/api/ai/chat` | `AiChatRequest {sysid, message, conversation_id?}` → `AiChatReply {conversation_id, reply, tool_runs: [AiToolRun {tool, sysid, ok, error, ts}], status_card: AiStatusCard {sysid, name, last_rx_age_ms, video: live\|checking\|down\|none}\|null, proposals: [AiProposal {id, sysid, vehicle_name, command, reason, requires_confirm, created_ms, expires_ms}], truncated, ts}`。ストリーミングなし |
| POST | `/api/ai/proposals/{id}/dismiss` | → `{id, status: "dismissed"}`。監査 `target = 'ai'`、`dismiss_proposal`。`404 proposal_not_found` / `403 forbidden` / `409 proposal_expired` / `409 proposal_used` |

- `message` は空白以外 1〜2 000 文字(`400 invalid`)。AI へはその前に `[対象機体: <機体名> (sysid N)]` を付けて送る。未知の `sysid` は `404 not_found`。
- 会話: id は uuid v4、メモリ上だけ(再起動で消える)、追記のみ(古い発言を削らない)。20 往復、履歴 20 万文字、または履歴の再送コストが `max_tokens_per_chat` の 1/3(既定 20 000 トークン)以上で `409 conversation_full`(LLM は呼ばない)。再送コストは前回の最後の呼び出しの入力+出力トークン(報告がなければ 4 文字 = 1 トークンで見積もり)。これで 1 回の質問には上限内で少なくとも 3 回の呼び出し(ツール 2 往復+回答)が残り、途中で打ち切られて課金だけされる質問が続くことはない(2026-10-25)、無操作 30 分で破棄、サーバー全体で 64 件(最も古く使われたものから破棄)。知らない id は `404 conversation_not_found`(UI は id なしで 1 回送り直す)、他人の会話は `403 forbidden`。失敗・タイムアウトした質問は会話に残さない。本文のない応答(`content: []` や空文字)は「(応答が空でした)」に置き換えて保存・返却し、空の発言は履歴に入れない(2026-10-25)。UI は会話中の最後の項目がエラーなら「新しい会話」を出す。
- エラー: `503 ai_unconfigured`(最初に判定)/ `429 rate_limited`(ユーザーごと 60 s に 6 回、`error.retry_after_s` と `Retry-After` ヘッダー)/ `429 ai_budget`(直近 24 h のトークン上限 `daily_token_budget`)/ `409 ai_busy`(同じユーザーの質問が回答中)/ `504 ai_timeout`(質問全体 90 s、または 1 回の呼び出し 30 s)/ `502 ai_refused`(「AI が応答を拒否しました」)/ `502 ai_provider_error`。
- `ai_provider_error` の文言はサーバーが決めたものだけ: `AI provider error (HTTP <status>)` / `AI provider unreachable` / `unexpected AI provider response`。プロバイダーのエラー本文(キー・URL を含み得る)はクライアントにもログにも出さない(2026-10-25)。
- トークンは応答のあった LLM 呼び出しごとに、その時点で `daily_token_budget` から引く。失敗・タイムアウトした質問、途中でクライアントが切断した質問も、応答済みの呼び出し分は数える(2026-10-25)。1 回の質問の合計が `max_tokens_per_chat`(60 000)を超えたら打ち切って `truncated: true`(「上限に達したため途中で終了しました」)。
- ツール: `get_vehicle_status {sysid}`、`list_vehicles {}`、`list_recent_messages {sysid?, limit 1〜50(既定 20)}`、`search_log {query 1〜100 文字, sysid?, since?(unix ms)}`(保存済みメッセージログ `messages` の大文字小文字を区別しない部分一致、30 件まで。DataFlash / tlog は対象外)、`propose_command {sysid, command, reason}`(1 応答 3 件まで)。ツール結果の JSON は 8 000 文字まで(`"truncated": true`)。機体由来の文字列は `untrusted_text` の値として渡す。ツールを使う呼び出しは 6 回まで、7 回目はツールなしで回答させる。実行するツール呼び出しは 1 応答で 8 件、1 回の質問で 16 件まで。超えた分は実行も監査もせず `is_error` の `{"error":"too_many_tool_calls"}` を返す(2026-10-25)。

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

### 2.8 ネットワーク(2026-10-23 実装、スタンドアロン分。80 §4.1)
| メソッド | パス | 本文 |
|---|---|---|
| GET | `/api/network` | `NetworkTopology`。ログイン中なら誰でも(operator / admin) |

```ts
type NetworkTopology = { server: ServerNode; links: MavLinkInfo[]; vehicles: NetVehicle[];
  clients: ClientSession[]; media: MediaServer; unconfigured: ('hub'|'lte'|'mesh'|'gateway'|'ntrip'|'node')[];
  at_unix_ms: number };
type ServerNode = { hostname: string; version: string; build: string; listen: string;
  role: 'standalone'|'edge'|'hub'; uptime_s: number; started_unix_ms: number };
type MavLinkInfo = { id: string /* "link0" */; url: string; kind: 'udpin'|'udpout'|'tcp'|'serial';
  connected: boolean; connected_since_unix_ms: number | null; reconnects: number; last_error: string | null;
  rx_msgs_per_s: number; rx_bytes_per_s: number /* 推定 */; loss_pct: number; last_rx_age_ms: number | null;
  systems: { sysid: number; vehicle: boolean; components: NetComponent[] }[] };
type NetComponent = { compid: number; kind: 'autopilot'|'camera'|'gimbal'|'companion'|'gcs'|'other';
  mav_type: number | null; rx_msgs_per_s: number; loss_pct: number; last_rx_age_ms: number };
type NetVehicle = { sysid: number; name: string; kind: 'copter'|'rover'|'plane'|'other'; link: 'ok'|'delay'|'lost'; link_id: string;
  heartbeat_age_ms: number | null; components: NetComponent[];
  camera: { kind: CameraKind; transport: 'tcp_udp'|'via_fc'; endpoint: string; connected: boolean;
    firmware: string | null; last_error: string | null } | null;
  video: { source: VideoSource; probe_ok: boolean; scanning: boolean; whep_path: string } | null };
type MediaServer = { whep_upstream: string /* userinfo 除去 */; reachable: boolean | null /* 初回の確認前は null */ };
type ClientSession = { id: number; username: string; role: Role; addr: string | null /* TCP の相手 ip:port */;
  browser: 'Edge'|'Firefox'|'Chrome'|'Safari'|'Other'; connected_since_unix_ms: number };
```

- 率は 1 s 単位で直近 5 s(進行中の秒を除く)。ロス = 欠け ÷(受信 + 欠け)× 100、欠け 128 以上は数えずに同期し直す(80 §4.1)。
- M5 の項目(現場、ノード、LTE、経路、メッシュの SNR、ユーザー、外部サービス、80 §4.2)は追加的に足し、その分を `unconfigured` から外す。

### 2.9 AI 緊急介入・外的要因(実験機能、2026-10-26。設計 v0.4、70 §4.1)

応答は共通の封筒(`{success, data}` / `{success: false, error: {code, message}}`)。admin とある操作は他のロールで `403 forbidden`。

| メソッド | パス | 本文 / 応答 |
|---|---|---|
| GET | `/api/guard/settings` | → `GuardSettings {enabled, consent: {monitoring, external_data, auto_ops, by, at_ms}, toilet_bowl: l0\|l1\|l2\|l3, countdown_s, takeover_wait_s, params}`(ログイン済み) |
| PUT | `/api/guard/settings` | admin。`{enabled?, consent?: {monitoring, external_data, auto_ops}, toilet_bowl?, countdown_s? (3..=15), takeover_wait_s? (10..=120), params? (null = 既定値)}` → `GuardSettings`。`400 consent_required`(同意 1 なしで有効化)/ `400 auto_ops_consent_required`(同意 3 なしで L2 / L3)/ `400 validation`。無効化で同意は消え、カウントダウン中なら取り消しになる。監査 `enable` / `disable` / `set_level` / `set_guard_params` |
| GET | `/api/guard/alerts` | → `[GuardAlert]` 有効な警告(機体順、新しい画面向け) |
| POST | `/api/guard/alerts/{id}/cancel` | ログイン済みの誰でも。→ `GuardAlert`(phase `cancelled`)。`404 not_found` / `409 not_cancellable`(カウントダウン中でない)。監査 `cancel` |
| GET | `/api/guard/decisions?sysid=&limit=` | admin。→ `[{id, ts, sysid, alert_id, event, phase, level, flight_id, record}]`(新しい `limit` 件を古い順、既定 100 / 上限 500)。`record` は `rgcs_guard::DecisionRecord`(再生できる) |
| GET | `/api/env/factors` | → `EnvSummary {cell, factors: [EnvFactor {kind, level, unit, value, primary, readings: [EnvReading {source, class, value, at_ms, fresh, note}], disagree}], missing, unavailable, notes, ts}` |
| GET | `/api/env/sources` | → `[EnvSourceStatus {id, label, enabled, needs_key, key_configured, key_hint, uses_location, interval_s, timeout_ms, last_ok_ms, last_error, next_due_ms, terms}]`。キーは末尾 4 文字(`…ab12`)だけ |
| PUT | `/api/env/sources/{id}` | admin。`{enabled?, interval_s? (60..=86 400), timeout_ms? (1 000..=30 000)}` → `EnvSourceStatus`。`400 validation` / `404 not_found`。監査 `env_source_put` |
| POST | `/api/env/sources/{id}/fetch` | admin。今すぐ取得 → `EnvSourceStatus`。`409 guard_disabled`(実験機能オフ)/ `409 consent_required`(同意 2 なし)/ `404 not_found` |
| GET / PUT | `/api/env/settings` | `EnvSettings {rounding_deg (0.01 \| 0.05 \| 0.1), copter, quadplane, plane: EnvThresholds}`。PUT は admin、どれかを丸ごと。監査 `env_settings_put` |

- 取得元の ID: `open_meteo`, `jma_amedas`, `swpc_kp`, `swpc_kp_1m`, `swpc_kp_forecast`, `swpc_alerts`, `gfz_kp`, `openweathermap`。読み値の `source` にはほかに `vehicle`(機体の WIND・GNSS)、`wmm`(偏角)、`sun`(日没まで)。
- 取得エラー(`last_error`): `timeout`, `unreachable`, `http_<status>`, `redirect`, `parse`, `too_large`, `no_key`, `no_location`。
- 外部の接続先は `config.toml` の `[env.endpoints]`(`open_meteo`, `open_meteo_customer`, `jma`, `swpc`, `gfz`, `owm`)で差し替えられる(試験用の偽サーバー向け)。キーは `[env] openweathermap_api_key_env` / `open_meteo_api_key_env` が指す環境変数から。

## 3. WebSocket `/ws`

- 1 セッション 1 接続。サーバー → クライアントは JSON テキストフレーム `{ "t": "<type>", ... }`。クライアント → サーバーも同形式。
- 接続直後にサーバーが `snapshot`(全機体の `VehicleState`、全カメラの `caps + state`)を送る。

### 3.1 サーバー → クライアント
| `t` | ペイロード | 周期 |
|---|---|---|
| `snapshot` | `{vehicles: [VehicleState], cameras: [CameraSnapshot{sysid, caps, state}], video_sources: [{sysid, status}]}` | 接続時 |
| `telemetry` | `{sysid, diff: Partial<VehicleState>}` | 10 Hz(変化分のみ) |
| `camera_state` | `{sysid, caps: CameraCaps, state: CameraState}` | 変化時 + 1 Hz(サーバーが再送。caps を毎回載せるので再読込なしに種別変更が反映される)。変化時の送信は機体ごとに最大 10 Hz(100 ms 間隔、連続した変化の最後の状態は必ず送る。0x50 / 0x5F の push はカメラ側で最大 30 Hz のため、2026-10-23) |
| `roi_status` | `{sysid, status: RoiStatus}` | 2 Hz(追従中) |
| `video_source` | `{sysid, status: VideoSourceStatus}` | 変化時 + 1 Hz(サーバーが再送) |
| `vehicle_message` | `{sysid, id, severity, text, ts}`。機体の STATUSTEXT は原文(50 バイトのチャンクはサーバーで結合)。サーバー生成の `text` は固定コード `comms_delay` / `link_lost` / `link_restored`(UI が翻訳) | 発生時 |
| `command_result` | `{id, sysid, cmd, ok, reason?, ts}` | 完了時 |
| `message_ack` | `{sysid, id, by, ts}` | 確認時 |
| `network_status` | `{topology: NetworkTopology}`(差分でなく全体、2026-10-23) | 1 Hz(受信者がいない周期は送らない。`snapshot` には含めず、画面は開いたときに `GET /api/network`。80 §4.1) |
| `vehicle_discovered` / `vehicle_lost` | `{sysid}` | 発生時 |
| `mission_progress` | `{sysid, progress: {seq, total}}` | `MISSION_CURRENT` の変化時 + 1 Hz(サーバーが再送)。`total` はサーバーが書込 / 読込したミッションの項目数(未知なら機体の `MISSION_CURRENT.total`) |
| `mission_transfer` | `{sysid, transfer: {phase: write\|verify\|done\|failed, done, total}}` | ミッション書込中(`PUT .../mission`)。write は機体が要求した項目数、verify は読み戻した項目数(`total` = 項目数 + ホーム)、最後に done か failed |
| `flight_draft_created` | `{sysid, flight: Flight}` | DISARM 時(初回 ARM から最後の DISARM までが 1 飛行。10 分以内の再 ARM は同じ飛行、リンク喪失 10 分で最終受信時刻に着陸扱い) |
| `log_fetch_progress` | `{sysid, progress: {fc_log_id, received, total, done, error?}}` | 64 KB ごとと完了時 |
| `calibration` | `{sysid, status: CalibStatus}` | 校正セッションの変化ごと(開始・姿勢要求・コンパス進捗・RC 入力・終了) |
| `input_state` | `{deadman: ok\|lost}` | 変化時(`input_hb` 1.5 s 途絶で `lost`、サーバーは速度 0 を 1 回送る) |
| `error` | `{code, message}` | 入力拒否時 |
| `guard_alert` | `{alert: GuardAlert {id, sysid, vehicle_name, event: "toilet_bowl", phase: alerting\|countdown\|executing\|executed\|cancelled\|taken_over\|unanswered\|refused\|cleared, level, confidence, signs {a, b, c, turn_deg, radius_m, compass_var}, deadline_ms?, action_mode?, rc_stale, kp_raised, sound, text, ts}}` | 状態が変わるたび + カウントダウン中は 1 Hz で再送(2026-10-26、§2.9)。`cleared` で画面から消す |
| `env_summary` | `{summary: EnvSummary}` | 外的要因の総合結果が変わるたび(取得・機体の WIND / GNSS) |
| `assignments` | `{rows: [Assignment]}`(差分でなく全体、§2.2.2) | 割当の変更・書込記録の付与 / 消去のたび(2026-10-31)。`snapshot` には含めず、画面は `snapshot` を受けるたび(接続・再接続)に `GET /api/assignments` で読み直す |

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
