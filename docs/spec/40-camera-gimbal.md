# RGCS 仕様書 40 — カメラ・ジンバル(抽象化と SIYI MT11 ドライバ)

- 版: 0.1(2026-10-16)
- 出典: `/Users/tsuyoshi/github/rtos/siyi-mt11-cameracontrol`(Python 版、README と `app/*.py`)。移植の正解データはその `tests/`
- クレート: `crates/rgcs-camera`

## 1. 抽象(trait)

```rust
#[async_trait]
pub trait Camera: Send + Sync {
    fn caps(&self) -> CameraCaps;
    async fn send(&self, cmd: CameraCommand) -> Result<(), CameraError>;
    fn state(&self) -> watch::Receiver<CameraState>;
    async fn connect(&self) -> Result<(), CameraError>;
    async fn disconnect(&self);
}
```

全型は `serde::{Serialize, Deserialize}` と `ts_rs::TS` を導出し、UI の型は生成物を使う。

### 1.1 CameraCaps

| フィールド | 型 | 意味 |
|---|---|---|
| `kind` | `None \| Mavlink \| SiyiMt11` | 種別 |
| `gimbal` | `Option<{rate, angle, center, modes: Vec<GimbalMode>, attitude, pitch_range: (f32,f32)}>` | 雲台 |
| `zoom` | `Option<{max: f32, absolute, step, continuous}>` | ズーム |
| `focus` | `bool` | 手動フォーカス |
| `photo` / `record` | `bool` | 静止画 / 録画 |
| `video_modes` | `Vec<Rgb \| Thermal \| SideBySide>` | 映像タイプ |
| `thermal` | `Option<{gains: Vec<Low\|High>, palettes: Vec<u8>, point_temp, frame_temp, range_c: {high:(-20,150), low:(0,550)}}>` | サーマル |
| `ai_tracking` | `Option<{box_select, point_select, candidates}>` | AI 追跡 |
| `encoding_presets` | `Vec<EncodingPreset>` | 主ストリームのエンコード |
| `storage_info` / `clock_sync` | `bool` | SD カード情報 / 時刻同期 |
| `roi` | `Computed \| Native \| None` | GPS ROI の実現方式 |

**UI 規則**: `caps` に無い機能は非表示(無効化ではない)。`kind: None` ならカメラ帯・操作バー・状態カードを出さず、「カメラ未設定 | 設定する」だけを出す。

### 1.2 CameraCommand

`GimbalRate{yaw:i8,pitch:i8}`(−100..100、+yaw=右、+pitch=上)/ `GimbalAngle{yaw_deg,pitch_deg}` / `GimbalCenter(OneKeyReset|CenterFaceDown|Center|FaceDown)` / `GimbalMode(Lock|Follow|Fpv)` / `ZoomAbsolute(f32)` / `ZoomStep(i8)` / `ZoomSpeed(-1|0|1)` / `ZoomReset` / `Focus(-1|0|1)` / `Photo` / `RecordStart` / `RecordStop` / `VideoMode(VideoMode)` / `ThermalGain(Low|High)` / `ThermalPalette(u8)` / `MeasurePoint{x,y}` / `MeasureFrame(bool)` / `AiEnable(bool)` / `AiSelectBox(StreamBox)` / `AiSelectPoint{x,y}` / `AiCancel` / `AiCandidates(bool)` / `Encoding(EncodingPresetId)` / `SyncClock` / `RoiStart(RoiTargetId)` / `RoiStop`。

ドライバは対応しないコマンドに `CameraError::Unsupported` を返す。サーバーは `caps` と照合して送信前に拒否する(UI が隠していても API から来るため)。

### 1.3 CameraState

`connected`, `last_error`, `firmware{camera,gimbal,zoom}`, `recording: Idle|Recording|NoCard|CardError`, `zoom`, `zoom_max`, `video_mode`, `stream: Option<(w,h)>`, `encoding`, `gimbal: Option<{yaw,pitch,roll,age_ms}>`, `gimbal_mode`, `thermal: Option<{gain, range_c, frame: Option<{max_c,min_c,max_xy,min_xy}>, point: Option<{temp_c,xy,age_ms}>}>`, `track: Option<{state: Tracking|Lost|Searching, box}>`, `candidates: Vec<Detection>`, `storage: Option<{status,fs,total_gb,free_gb,free_pct}>`, `clock: Option<{camera_unix_us, offset_ms, rtt_ms, synced_at}>`, `roi: RoiStatus`, `video_source: {mode, source, scanning, probe_ok}`。

座標(`box`, `xy`, `max_xy`)は **主ストリーム画素**(例 1920×1080)。UI は `stream` で正規化する。

## 2. ドライバ

| ドライバ | caps | 備考 |
|---|---|---|
| `siyi::Mt11` | 全部(zoom.max 165、pitch_range (−90, 30)、modes Lock/Follow/FPV、roi Computed) | TCP 37260(状態・設定)+ UDP 37260(0x07 / 0x08 / 0x0E)。1 s ごと 0x00 ハートビート。切断時は 1 s 後に再接続 |
| `mavlink_cam` | `CAMERA_INFORMATION.flags` から photo / record / zoom(`MAV_CMD_SET_CAMERA_ZOOM`)/ focus(`MAV_CMD_SET_CAMERA_FOCUS`)。`GIMBAL_MANAGER_INFORMATION` から gimbal rate / angle / attitude(`GIMBAL_MANAGER_SET_PITCHYAW`、`GIMBAL_DEVICE_ATTITUDE_STATUS`)。video_modes = [Rgb]、roi = Native(`MAV_CMD_DO_SET_ROI_LOCATION` / `DO_SET_ROI_NONE`)。thermal / ai / encoding / storage / clock は無し | 映像は設定の RTSP URL を MediaMTX のパスに登録 |
| `none` | 全て無し | |

## 3. SIYI プロトコル(MT11)

- フレーム: `55 66 | ctrl(1) | len(2 LE) | seq(2 LE) | cmd(1) | data | crc16(2 LE)`。CRC は CRC-16/CCITT(poly 0x1021, init 0)。受信は `55 66` を探索して長さ分揃うまでバッファ、CRC 不一致は破棄。
- **送信禁止**: `0x48`(SD フォーマット)は `send_cmd` / `send_udp_cmd` の最下層で拒否する(`FORBIDDEN_CMD_IDS`)。SD 情報は `0x49`。

| CMD | 方向 / 周期 | 対応 |
|---|---|---|
| 0x00 | TX 1 Hz | ハートビート(内部) |
| 0x01 | TX 接続時 / RX | `state.firmware`(各 u32 の下位 3 バイト = patch, minor, major) |
| 0x05 / 0x06 | TX | `ZoomSpeed` / `Focus` |
| 0x07 (UDP) | TX ≤20 Hz | `GimbalRate` |
| 0x08 (UDP) | TX | `GimbalCenter` |
| 0x0A / 0x0B | TX 1 Hz / RX | 録画状態(`0x0A` の data[3]、`0x0B` feedback 5 = 録画開始、6 = 停止) |
| 0x0C func 0 / 2 | TX | `Photo` / 録画トグル(状態を見て Start / Stop を実現) |
| 0x0C func 3 / 4 / 5, 0x19 | TX / RX | `GimbalMode` / 現在モード |
| 0x0D | TX 10 Hz(ROI 中)/ 1 Hz | `state.gimbal`(yaw は台座基準 + 左、pitch は水平基準 + 上、0.1°) |
| 0x0E (UDP) | TX | `GimbalAngle`(pitch −90..30 にクランプ) |
| 0x0F / 0x18 | TX / RX | `ZoomAbsolute`(int + 0.1 刻み)/ 現在倍率 |
| 0x10 / 0x11 | TX / RX | 映像タイプ(rgb = (0,2), thermal = (2,0), side_by_side = (3,2)、応答の別表記も同じ名前へ) |
| 0x12 / 0x14 | TX / RX | 点温度 / 全画面最高・最低(uint16/100 ℃、600 ℃ 超は負値として解釈) |
| 0x1B | TX | `ThermalPalette`(0,2..11) |
| 0x20 / 0x21 | TX / RX | エンコード取得(stream_type 1 = main)/ 設定。設定後は解像度不明になるので 0x20 を再取得するまでクリック追跡を止める |
| 0x30 / 0x40 | TX / RX | UTC 設定(unix µs)/ カメラ時刻 |
| 0x37 / 0x38 | TX / RX | サーマルゲイン取得 / 設定(0 = Low, 1 = High) |
| 0x49 | TX 10 s / RX | SD: status(0 未挿入 / 1 マウント失敗 / 2 OK / 3 残量少 / 4 読取専用 / 5 読取エラー)、fs、total / free(GB×100) |
| 0x50 / 0x51 | RX / TX | 追跡枠 push / push の有効化 |
| 0x55 / 0x56 | TX / RX | AI モード有効化 / 枠選択・点選択・解除(ACK コードを `ai_select_result`) |
| 0x5F | TX / RX | 検出枠 push の有効化 / 検出枠(直近 1.5 s、最大 60 フレーム保持) |

### 3.1 映像タイプと追跡の関係
- クリック追跡は RGB 表示時のみ。IR / 2 画面へ切替えると追跡は解除。
- Ctrl + クリックは直近 1 s の検出枠で当たり判定し、同一物体の最新位置を 0x56 点指定で送る。検出枠が届いていない FW(0x5F 非対応)はクリック位置をそのまま点指定。
- エンコード変更直後(解像度未取得)は追跡開始を拒否し UI に理由を返す。

## 4. GPS ROI(Computed)

- 入力: 機体位置(`GLOBAL_POSITION_INT` lat / lon / alt MSL / hdg)、目標(lat / lon / alt MSL)、ジンバル姿勢(0x0D)。
- 目標計算 2 Hz(`target_rate_hz`): 方位角 = bearing(機体 → 目標)、仰角 = atan2(目標高 − 機体高, 水平距離)。ヨー指令 = 機首方位 − 方位角 + ヨー補正(台座基準、+ 左)、ピッチ指令 = 仰角。
- **rate モード(既定)**: 10 Hz で実角度との差 → 不感帯 → PID → 0x07 速度(`max_speed` でクランプ)。目標は `smoothing_tau_s` の一次遅れで平滑化。
- **angle モード**: 目標が不感帯以上動いたときだけ 0x0E(最大 `target_rate_hz`)。
- 規則(Python 版の確定仕様):
  - 開始時に Follow(0x0C func 4)、追従中は 5 s ごとに再送。
  - 目標まで 3 m 未満、位置が 2 s 以上更新なし、機首方位不明(hdg = 65535)のときは指令を止めエラーを `roi_status.error` に出す(ROI は自動解除しない)。
  - 停止、手動操作、位置 / 姿勢途絶時は **必ず速度 0** を送る。
  - 手動パン / チルト(|速度| ≥ 5)、センター、AI 追跡開始で ROI 解除。ROI 開始で AI 追跡解除。
  - 真後ろ付近は ±190° まで同じ側を維持して一周を防ぐ。
- 制約: 精度は FC のコンパスと GPS に依存。機体のロール / ピッチによるヨー誤差は補正しない(実機確認 2026-09-23: 補正不要)。

### 4.1 RoiStatus
`active_target: Option<id>`, `bearing_deg`, `elevation_deg`, `distance_m`, `yaw_cmd_deg`, `pitch_cmd_deg`, `mode`, `gimbal_yaw_deg`, `gimbal_pitch_deg`, `speed_yaw`, `speed_pitch`, `error: Option<String>`。

## 5. 時刻同期・SD・映像ソース

- 時刻同期(MT11): FC の `SYSTEM_TIME`(無ければ 1 Hz で要求)で 0x30。経過時間を足して送る。タイミング: 初回 GPS 時刻、(再)接続、10 分ごと、「今すぐ同期」。GPS 時刻が無い / 5 s 以上古いときは送らない。同期後に 0x40 で読み返し、RTT/2 補正の差を表示(1 s 超は赤)。
- SD: 10 s ごと 0x49。空き 10% 未満、または status ≠ OK は赤。
- 映像ソース: `auto` は MT11 → Android → 無ければ 15 s 後に再スキャン。選択中は 3 s ごと確認、2 回連続失敗で切替。固定(`mt11` / `android`)は疎通に関わらずそのソース。Android 表示中はクリック追跡・検出枠・温度表示を無効。

## 6. ジョイスティック(ジンバル用プロファイル)

- 軸機能: `none` / `pan` / `tilt` / `zoom_abs`(軸 −1..1 → 1..最大倍率、0.5 刻み、2 Hz)/ `zoom_speed`(連続ズーム)/ `zoom_step`(±0.2 を越えるたびに 1 段)。各軸に不感帯(0–0.5)、反転、スケール(0.1–2)。
- ボタン機能: `shutter`, `record_toggle`, `center_gimbal`, `thermal_toggle`(RGB → IR → 2 画面を巡回), `thermal_gain_toggle`, `focus_near` / `focus_far`(押下中), `ai_tracking_toggle`(中央 200 px で開始), `gimbal_stop`, `zoom_in_step` / `zoom_out_step` / `zoom_1x`, `mode_lock` / `mode_follow` / `mode_fpv` / `mode_cycle`, `roi_1`…`roi_10`(押すたびに開始 / 停止), `roi_stop`。
- 速度: `yaw = pan × max_pan_speed`、`pitch = tilt × max_tilt_speed`(既定 30 / 20)。20 Hz、非ゼロのときだけ送信し、ゼロに戻った瞬間に 1 回 0 を送る。
- ROI 中は |速度| < 5 の入力をノイズとして無視する。
- 対象は「選択中の機体」のカメラ。機体を切替えたら 0 を送ってから切替える。

## 7. Python → Rust 移植表

| Python | Rust | 正解データ |
|---|---|---|
| `camera_protocol.py`(crc16 / make_packet / _parse_buffer / parse_*) | `siyi/frame.rs`, `siyi/parse.rs`, `siyi/client.rs` | `tests/test_camera_protocol.py` |
| `ai_tracking.py`(click_to_stream_box, pick_detection, ENCODING_PRESETS) | `siyi/ai.rs` | `test_ai_tracking.py`, `tests/js/video_geometry.test.mjs` |
| `thermal.py` | `siyi/thermal.rs` | `test_thermal.py`, `test_probe_thermal.py` |
| `tf_card.py` | `siyi/tf_card.rs` | `test_tf_card.py` |
| `time_sync.py` | `clock_sync.rs` | `test_time_sync.py` |
| `geo.py`, `gimbal_pid.py`, `roi_controller.py` | `roi/geo.rs`, `roi/pid.rs`, `roi/controller.rs` | `test_geo.py`, `test_gimbal_pid.py`, `test_roi_controller.py` |
| `roi_config.py` | `rgcs-store::roi`(検証) | `test_roi_config.py` |
| `video_source.py`, `video_probe.py` | `rgcs-video/source.rs`, `probe.rs` | `test_video_source.py`, `tests/js/video_source.test.mjs` |
| `mavlink_source.py` | `rgcs-mavlink/interval.rs` | `test_mavlink_source.py` |
| `static/app.js`(processAxes / handleButtonPress) | UI `features/gimbal-joystick/{mapping,loop}.ts` | 新規 vitest(Python の挙動から書き起こす) |
| `scripts/probe_*.py` | `rgcs-cli siyi probe` | 実機 |

移植手順: Python テストのケースを Rust の `#[test]`(または vitest)に 1:1 で書き写し、先に赤を確認してから実装する(TDD)。

## 7.1 P2 の実装範囲(2026-10-17)

- `crates/rgcs-camera`: `siyi/frame.rs`(CRC / パケット / 受信パーサ)、`siyi/encode.rs`、`siyi/parse.rs`、`siyi/client.rs`(tokio アクター: TCP ハートビート 1 Hz、0x0A / 0x0D ポーリング 1 Hz、接続時 0x01 / 0x18 / 0x10 / 0x19、UDP 0x07 / 0x08 / 0x0E、切断 1 秒後に再接続、接続タイムアウト 3 秒、3 秒無応答で切断扱い(電源断は FIN が来ないため)、切断中のコマンドは即 `NotConnected`、姿勢の `age_ms` は最後の 0x0D からの経過)、`siyi/sim.rs`(疑似サーバー、`cargo run -p rgcs-camera --features sim --example siyi_sim`)、`none.rs`。
- 実装済みコマンド: `GimbalRate` / `GimbalAngle` / `GimbalCenter` / `GimbalMode` / `ZoomAbsolute` / `ZoomStep` / `ZoomSpeed` / `ZoomReset` / `Focus` / `Photo` / `RecordStart` / `RecordStop` / `VideoMode`。録画はカメラの状態を見てトグルを 1 回だけ送る。
- 未実装(デモ後): サーマル温度(0x12 / 0x14 / 0x37 / 0x38 / 0x1B)、AI 追跡(0x50 / 0x51 / 0x55 / 0x56 / 0x5F)、エンコード(0x20 / 0x21)、時刻同期(0x30 / 0x40)、SD(0x49)、ROI、MAVLink カメラ、Android ソース。
- ジョイスティック(§6)は pan / tilt 軸とボタン機能(shutter, record_toggle, center_gimbal, thermal_toggle, gimbal_stop, zoom_in_step, zoom_out_step, zoom_1x, mode_*)を実装。zoom_abs / zoom_speed / zoom_step 軸は未実装。

## 7.2 地図上の撮影方向(2026-10-18 デザイン、10 §3.1)

- 対象: `caps.gimbal_rate` を持ち、ジンバル姿勢(ヨー / ピッチ)が取れている機体。
- 方位: `bearing = (heading − gimbal.yaw + 360) mod 360`(視線と同じ規約)。
- 水平画角: `hfov = 2·atan(tan(hfov₁ / 2) / zoom)`。`hfov₁` は 1 倍時の水平画角で、カメラ種別ごとの値を `CameraCaps` に持たせる(プロトタイプは 62° 固定)。垂直画角は 16:9 から求める。
- 2D: 機体マーカーから扇。長さ `48 + 64·cos(pitch)` px(下を向くほど短い)。ピッチ −80° 以下は機体を囲む点線の輪(真下)。
- 3D: 機体の空中位置(ホーム標高 + 相対高度)から中心と 4 隅の光線で四角錐を描き、先端(既定 120 m)に半透明の面。上を向いていても表示する。
- 地面に投影(`app_settings` の `map.gimbal_ground_projection`、既定オフ): 4 隅の光線を DSM / DEM と交わるまで 15 m 刻みで進め、二分探索で詰める(最大 1.5 km)。4 隅とも当たれば地面に撮影範囲を塗る(2D・3D)。1 本でも当たらなければ(水平線より上)先端の面の表示に戻す。2D で地形が無いときはホーム標高の平面とみなす。
- 選択機は濃く、他の機体は薄く描く。

## 8. 受け入れ条件

- MT11 疑似サーバー(`tests/siyi-sim`、Python 版の応答を再現)に対して全 CMD の送受信が通る。
- 実機: ズーム / 録画 / 写真 / 映像タイプ / モード / センター / 温度 / 追跡 / エンコード / SD / 時刻同期が Python 版と同じ挙動。`siyi probe --yaw 90 --pitch -30` の基準確認が通る。
- ROI: 疑似 FC(`fake_vehicle` 相当)で目標を向き続け、停止・途絶時に速度 0 が送られる(ログで確認)。
- MAVLink カメラ(SITL + ジンバルシミュレータ)で caps に応じた UI になる。
