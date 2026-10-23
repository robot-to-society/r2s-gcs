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
    // 既定は Err(Unsupported("roi"))。caps.roi = Native のドライバだけが実装する(§4.2)
    async fn roi_location(&self, lat: f64, lon: f64, alt_msl: f64) -> Result<(), CameraError>;
    async fn roi_none(&self) -> Result<(), CameraError>;
}
```

全型は `serde::{Serialize, Deserialize}` と `ts_rs::TS` を導出し、UI の型は生成物を使う。

### 1.1 CameraCaps

| フィールド | 型 | 意味 |
|---|---|---|
| `kind` | `None \| Mavlink \| SiyiMt11` | 種別 |
| `gimbal` | `Option<{rate, angle, center, modes: Vec<GimbalMode>, attitude, pitch_range: (f32,f32)}>` | 雲台 |
| `zoom` | `Option<{max: f32, absolute, step, continuous, unit: Times \| Percent}>` | ズーム。`unit`(2026-10-23、省略時 `Times`): `Times` は倍率(×)、`Percent` は 0–100 %(MAVLink カメラ。§2)。UI は `40%` / `1.5×` で表示し、地図の扇は `Percent` のとき倍率 1 で描く |
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

`GimbalRate{yaw:i8,pitch:i8}`(−100..100、+yaw=右、+pitch=上)/ `GimbalAngle{yaw_deg,pitch_deg}` / `GimbalCenter(OneKeyReset|CenterFaceDown|Center|FaceDown)` / `GimbalMode(Lock|Follow|Fpv)` / `ZoomAbsolute(f32)` / `ZoomStep(i8)` / `ZoomSpeed(-1|0|1)` / `ZoomReset` / `Focus(-1|0|1)` / `Photo` / `RecordStart` / `RecordStop` / `VideoMode(VideoMode)` / `ThermalGain(Low|High)` / `ThermalPalette(u8)` / `MeasurePoint{x,y}` / `AiSelectBox{x,y,box_px}` / `AiSelectPoint{x,y}` / `AiCancel` / `Encoding{preset}` / `SyncClock`。

- 確定(2026-10-23): `MeasurePoint` / `AiSelectBox` / `AiSelectPoint` の `x` / `y` は **正規化 0..1**(画素ではない)。ドライバが最新の 0x20 解像度で画素に直すので、「解像度不明なら拒否」(70 §3)は変換と同じ値で 1 か所で判定する。`box_px` は主ストリーム画素の一辺(32–600)。`null` はプロファイルの `ai_box_px` を使う(サーバーが埋める)。
- `MeasureFrame(bool)` / `AiEnable(bool)` / `AiCandidates(bool)` はコマンドにしない(2026-10-23)。0x14 は IR 表示中に毎秒ポーリングし、表示の On / Off は UI 側の `thermal_overlay`。0x55 は選択の直前に毎回送る。0x51 / 0x5F は 5 s ごとに再有効化する(カメラ再起動にも追従)。
- 拒否は `CameraError::Refused(code)` → 409 `{code}`: `rgb_only`(RGB 以外でクリック追跡)、`thermal_only`(IR 以外で点温度)、`stream_unknown`(解像度未取得)、`no_detection`(Ctrl + クリックが直近の検出枠に当たらない)、`clock_sync_off`(時刻同期無効で「今すぐ同期」)、`encoding_rejected`(0x21 の ACK `sta = 0`。`encoding` コマンドは ACK を最大 1 s 待ってから返り、ACK が無ければ送信済みとして成功を返す)。
- `RoiStart` / `RoiStop` は `CameraCommand` にしない(2026-10-22 決定)。開始・停止は REST `POST /api/vehicles/{sysid}/roi/start|stop`(50 §2.3)とサーバーの `RoiHub` だけが扱う。`CameraCaps::supports` はドライバ単位の判定のまま、監査は target `roi` で残す。

ドライバは対応しないコマンドに `CameraError::Unsupported` を返す。サーバーは `caps` と照合して送信前に拒否する(UI が隠していても API から来るため)。

### 1.3 CameraState

`connected`, `last_error`, `firmware{camera,gimbal,zoom}`, `recording: Idle|Recording|NoCard|CardError`, `zoom`, `zoom_max`, `video_mode`, `stream: Option<(w,h)>`, `encoding`, `gimbal: Option<{yaw,pitch,roll,age_ms}>`, `gimbal_mode`, `thermal: Option<{gain, range_c, frame: Option<{max_c,min_c,max_xy,min_xy}>, point: Option<{temp_c,xy,age_ms}>}>`, `track: Option<{status: Tracking|Searching|Lost, rect: NormRect{x,y,w,h}, target, age_ms}>`, `candidates: Vec<Detection{x0,y0,x1,y1,score,class_id,class_name}>`, `ai_ack: Option<{code, seq}>`, `storage: Option<{status,fs,total_gb,free_gb,free_pct}>`, `clock: Option<{camera_unix_us, reading_age_ms, offset_ms, rtt_ms, synced_at_unix_ms, error}>`。映像ソースは `video_source` WS フレーム(50 §3.1)で別に届く。

- `roi` は `CameraState` に入れない(2026-10-22 決定、50 §3.1 が優先)。`RoiStatus` は WS `roi_status` フレームだけで届く(動作中 2 Hz + 停止時に 1 回)。スナップショットには含めず、再接続したクライアントは 0.5 s 以内に知る。非動作中は UI 上「なし」。

座標: サーマルの `xy` / `max_xy` / `min_xy` は **主ストリーム画素**(例 1920×1080、0x12 / 0x14 の値そのまま)で、UI は `stream` で正規化する。追跡枠 `track.rect`(左上原点)と検出枠 `candidates` は **正規化 0..1**(2026-10-23)。0x50 は 1280×720 の固定格子、0x5F は u16 / 65535 で、どちらも主ストリーム画素ではないため。

- 追跡状態: 0x50 status 0 / 4 → `tracking`、1 → `searching`、2 → `lost`、3 → `track` を消す。
- 古い表示は消す(受信時刻から): 全画面温度 3 s、点温度 15 s、追跡枠 1 s、検出枠 0.5 s(履歴は 1.5 s・最大 60 フレーム、Ctrl + クリックは直近 1 s を見る)。250 ms ごとの `expire` が受信と無関係に判定する。
- 切断時は `track` / `candidates` / `thermal.frame` / `thermal.point` / `stream` / `encoding` を消す。`storage` / `clock` / ゲインは最後の値を残す(灰色表示)。
- `ai_ack` は 0x55 / 0x56 の ACK ごとに `seq` が増える。UI は `ok` 以外を操作ログに出す。

## 2. ドライバ

| ドライバ | caps | 備考 |
|---|---|---|
| `siyi::Mt11` | 全部(zoom.max 165、pitch_range (−90, 30)、modes Lock/Follow/FPV、roi Computed) | TCP 37260(状態・設定)+ UDP 37260(0x07 / 0x08 / 0x0E)。1 s ごと 0x00 ハートビート。切断時は 1 s 後に再接続 |
| `mavlink_cam` | `CAMERA_INFORMATION.flags` から photo / record / zoom(`MAV_CMD_SET_CAMERA_ZOOM`)/ focus(`MAV_CMD_SET_CAMERA_FOCUS`)。`GIMBAL_MANAGER_INFORMATION` から gimbal rate / angle / attitude(`GIMBAL_MANAGER_SET_PITCHYAW`、`GIMBAL_DEVICE_ATTITUDE_STATUS`)と pitch_range。video_modes = [Rgb]、roi = Native(`MAV_CMD_DO_SET_ROI_LOCATION` / `DO_SET_ROI_NONE`、マネージャが `CAN_POINT_LOCATION_GLOBAL` と `HAS_YAW_AXIS` の両方を持つときだけ。無ければ None。ジンバル ID で振り分けるのは ArduPilot master(2026-09 以降)だけで、Copter 4.6.x 以前は §4.2 の注意)。thermal / ai / encoding / storage / clock は無し | 自前のソケットは持たず FC リンク(`rgcs-mavlink::MavPort`)で送受信する。映像は設定の RTSP URL(MediaMTX への登録は手作業、下記) |
| `none` | 全て無し | |

`mavlink_cam` の決定(2026-10-23、実装 `crates/rgcs-camera/src/mavlink_cam/`):
- **束縛(`comp_id` の意味)**: `camera_device_id == 0` の `CAMERA_INFORMATION` を `comp_id`(既定 100)から受けたらそれ(MAVLink ネイティブのカメラ)。無ければ任意のコンポーネントからの `camera_device_id == 1`(ArduPilot に繋がったカメラ、compid 1)。コマンドは束縛した compid 宛てで、カメラ ID の引数は `camera_device_id`。ジンバルはカメラの `gimbal_device_id`(≠ 0 のとき)と同じ `gimbal_device_id` の `GIMBAL_MANAGER_INFORMATION`、無ければ最初に見えたマネージャ。1 機につきカメラ 1 台・ジンバル 1 台(CAM2 / MNT2 は範囲外)。
- **情報と周期**: 未束縛の間は 2 s ごとに `MAV_CMD_REQUEST_MESSAGE`(259 / 280、compid 0 宛て)、再接続のたびにもう 1 回。`CAMERA_SETTINGS`(260)/ `CAMERA_CAPTURE_STATUS`(262)1 Hz、`GIMBAL_DEVICE_ATTITUDE_STATUS`(285)10 Hz は 3 s 以上届かないときだけ `SET_MESSAGE_INTERVAL` で要求(最短 5 s 間隔)。束縛済みなら切断中も要求する: ArduPilot は情報を 1 回返すだけで、頼むまで 260 / 262 / 285 を流さない(FC 再起動でも周期は消える)ので、要求した周期が(再)接続の条件になる(SITL で確認、2026-10-23)。接続 = 束縛済みかつ束縛した compid のフレームが 3 s 以内。切断中も束縛と caps は残す(UI は灰色)。caps は情報の到着で変わり、`camera_state` は毎フレーム `caps()` を読み直す(50 §3.1)。これらの要求は機体の HEARTBEAT が 3 s 以内に届いているときだけ出し(リンク断の間は出さない)、FC リンクの送信キューが満杯なら待たずに捨てる(次の周期で再要求。最終レビュー I3、2026-10-23)。キューは機体コマンドと共有なので、リンク断中に要求で埋めると RTL などが詰まる。
- **ズームはパーセント**: MAVLink には倍率も最大値も無いため `ZoomCaps { max: 100, absolute, step, continuous, unit: Percent }`。`state.zoom` は `CAMERA_SETTINGS.zoomLevel`(0–100 %)。絶対値 = `ZOOM_TYPE_RANGE`、`ZoomStep` = RANGE で現在値 ±10 %(ArduPilot は `ZOOM_TYPE_STEP` を DENIED にする)、`ZoomSpeed` = CONTINUOUS −1 / 0 / 1、`ZoomReset` = RANGE 0。
- **ヨーの向き**: `CameraState.gimbal.yaw` と `GimbalAngle.yaw_deg` は SIYI と同じ +左(機体基準)。MAVLink は +右なので姿勢と角度指令のヨーは符号を反転し、速度(+右)は反転しない。`GIMBAL_DEVICE_FLAGS_YAW_IN_EARTH_FRAME` の姿勢は `delta_yaw` で機体基準に直し、それも無ければ `gimbal = None`(扇を出さない)。速度は ±100 → ±90 °/s。
- **モード / センター**: `modes: []`(ArduPilot のロック / フォローはコマンドごと)。`HAS_NEUTRAL` があれば `center`。センター = 角度 (0, 0)、真下 = 角度 (0, pitch 下限)。状態行はモードの代わりに「MAVLink カメラ」(10 §3.3)。
- **ACK**: 写真 / 録画 / ズーム / フォーカスと ROI は `COMMAND_ACK` を (sysid, command) で照合して待つ(1.5 s、IN_PROGRESS は 10 s まで)。**再送しない**(ACK を落としただけで 2 枚撮らないため)。ACCEPTED 以外 → `Refused("camera_rejected")`(409)、ACK 無し → `Io`(503 `camera_error`)。`GIMBAL_MANAGER_SET_PITCHYAW` は ACK が無く、リンクに載った時点で成功。録画状態は ACCEPTED で楽観的に切り替え、`CAMERA_CAPTURE_STATUS.video_status` で上書き。
- **FW**: `firmware_version` の下位 3 バイト → `camera: "major.minor.patch"`。`hfov` は `CAMERA_INFORMATION` の焦点距離とセンサー幅から(ArduPilot は NaN を返すので UI 既定 62°)。
- **リンク上昇時のゼロを送らない**: FC リンクがカメラのリンクなので、上昇時の速度 0 は FC 側の向け先(ミッションの `DO_SET_ROI`、RC、Native ROI)を取り消してしまう。WS ゲートのデッドマン停止は従来どおり。
- **動いていないときの速度 0 は送らない**(2026-10-23、最終レビュー I1): ArduPilot は速度 0 の `GIMBAL_MANAGER_SET_PITCHYAW` でも MAVLink 指向モードに切り替え、ミッションの ROI / RC 指向を取り消す。ドライバは非ゼロ速度を送ってから 0 をまだ送っていないとき、または最後の非ゼロ速度から 2 s 以内のときだけ速度 0 を送り、それ以外は送らずに成功を返す(角度 / センター / ROI の開始・停止で「動いていない」に戻る)。WS ゲートも、その機体に非ゼロ速度を転送してから止めていないときだけ、切断・選択切替でゼロを出す(ページ読み込み・タブを閉じる・機体切替で FC 側の指向を止めない)。MT11 のデッドマン停止・リンク上昇時のゼロ・ROI 停止は従来どおり。
- **映像**: 映像監視はプロファイルの `rtsp_url` を MT11 と同じく疎通確認する。MediaMTX のパス登録は範囲外(`deploy/mediamtx.yml` は `api: no`、パスは固定の `mt11`)。MAVLink カメラの映像を出すには運用者がそのパスの上流を手で RTSP URL に向ける。

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

ポーリング(2026-10-23、`siyi/polls.rs`、接続後 1 s ごとの tick): 0x0A / 0x0D 毎秒、0x14 `[1]` は IR 表示中だけ毎秒、0x20 `[1]` は解像度不明の間は毎秒・既知なら 30 s ごと(stream_type 1 の応答だけ採用)、0x40 / 0x51 `[1]` / 0x5F `[5]` は 5 s ごと、0x49 / 0x37 は 10 s ごと。0x21 の後は `stream` / `encoding` を消し、300 ms 後に 0x20 を読み直す。0x55 → 0x56 は 100 ms 空ける。

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
- 実装上の決定(2026-10-22):
  - AI 追跡との連動(2026-10-23): `AiSelectBox` / `AiSelectPoint` は送信前に ROI を止める(`StopReason::Manual`、監査 reason `ai_tracking`)。`RoiHub::start` は `caps.ai_tracking` があれば先に `AiCancel` を送る(失敗はログのみで開始は止めない)。IR / 2 画面への切替でドライバが 0x56 解除を送る。
  - 手動入力による解除: WS `gimbal_rate` の max(|yaw|, |pitch|) ≥ 5、REST `gimbal_center` / `gimbal_angle` / `gimbal_mode`、カメラプロファイルの PUT(ドライバ再構築)。AI 追跡の開始も解除する(上記)。
  - ROI 中の機体には、WS ゲートが送るゼロ(転送される (0, 0)、デッドマン / 選択切替 / 切断の Zero)を落とす。ジンバルは ROI ループが持つ。デッドマンの `input_state: lost` 応答は出す。
  - 停止は両モードとも必ず速度 0。操作員 / 目標削除 / シャットダウンの停止は即時 1 回 + 2 回再送、手動解除は 1 回だけ(操作員のスティックと競合しないため)。
  - カメラリンクが上がるたび(ドライバの初回接続と毎回の再接続)に速度 0 を 1 回送る。ただし ROI 追従中の機体には送らない(2026-10-23)。切断中に出した停止・手動解除のゼロは届かないため、再接続でジンバルを止める。SIGTERM / SIGINT の終了時は追従中の全機体を停止してから抜ける。
  - 開始も両モードとも必ず速度 0 から(2026-10-23): 即時 1 回 + 2 回再送。開始直後はスティックの停止ゼロが落とされるため、エラー状態(`no_position` など)で操作員の速度が残らないようにする。再送は 0 以外の動作指令(0x07 / 0x0E)が出た周期で打ち切る。
  - `roi_status.error` は固定コード(`no_position`, `position_stale`, `heading_unknown`, `target_too_close`, `no_attitude`, `invalid_angles`, `follow_failed`, `send_failed`, `camera_offline`, `waiting`)で、UI が訳す(`roiErr_*`)。
- 実機での確認事項(2026-10-23): rate モードのゲイン(`pid_kp` / `pid_ki` / `max_speed`)は実機で要確認。シミュレータでは 0 → −45° のステップが −58° まで行き過ぎ、実効的な姿勢遅延は約 0.35 s と見積もられた(設計上の想定は 1 周期 0.1 s)。MT11 の TCP は TCP_NODELAY を設定済み。慣性のある実機では同じ遅延でも行き過ぎが大きくなるため、遅延を測ってからゲインを調整する。
- 制約: 精度は FC のコンパスと GPS に依存。機体のロール / ピッチによるヨー誤差は補正しない(実機確認 2026-09-23: 補正不要)。

### 4.1 RoiStatus
`active_target: Option<id>`, `bearing_deg`, `elevation_deg`, `distance_m`, `yaw_cmd_deg`, `pitch_cmd_deg`, `mode`, `gimbal_yaw_deg`, `gimbal_pitch_deg`, `speed_yaw`, `speed_pitch`, `error: Option<String>`。

### 4.2 Native(2026-10-23、MAVLink カメラ)

- `caps.roi = Native` の機体では、`RoiHub` が計算ループ(`roi_task`)の代わりに `roi_native` タスクを動かす(純粋な状態機械は `roi/native.rs`)。開始 / 停止 / 目標変更 / 手動解除 / シャットダウン / `roi_status` の経路は Computed と同じ。
- 開始と目標座標の変更で `COMMAND_INT` `MAV_CMD_DO_SET_ROI_LOCATION`(frame `MAV_FRAME_GLOBAL` = MSL、x / y = lat / lon × 1e7、z = alt_msl)を送り、動作中は 5 s ごとに再送する(FC の再起動やミッションの `DO_SET_ROI` に黙って負けないため)。**param1 は必ずジンバルのデバイス ID**。0 / NaN は ArduPilot の旧式 ROI で、Copter は**機体ごと**目標に向けてしまう。
- 停止(操作員、手動 |速度| ≥ 5、`gimbal_angle` / `gimbal_center`、プロファイル再読込、スロット未設定、シャットダウン)では `COMMAND_LONG` `MAV_CMD_DO_SET_ROI_NONE`(param1 = デバイス ID)を 1 回、失敗したら 1 回だけ再送。カメラ切断中の停止は即座に非動作にし、ROI_NONE は再接続後に送る。
- **ファームウェアの注意**(2026-10-23、最終レビュー I2): `DO_SET_ROI_LOCATION` / `DO_SET_ROI_NONE` の param1(ジンバル ID)を使って振り分けるのは ArduPilot master(2026-09-21 の `689868534b` 以降)だけで、Copter 4.6.x 以前のリリースには入っていない。古いファームウェアでは param1 は無視され(主マウントに向く)、マウントにヨー軸(パン)が無いと AUTO / GUIDED / RTL などで**機体がヨーして**目標を向き、`DO_SET_ROI_NONE` は Copter の自動ヨーを既定に戻す(ミッションの `CONDITION_YAW` / ROI ヨーも消える)。そのため Native はマネージャが `HAS_YAW_AXIS` を報告するときだけ提供し(ピッチだけのマウントは `roi = None`)、ジンバル ID 付きの Native ROI を安全に使うには Copter 4.6.x より新しいファームウェアが必要とする。実機確認(§8)は `ardupilot-latest`(master)で実施。
- 適用しないもの: `RoiControl`(rate / angle / PID。ROI タブは制御欄を隠す)、速度 0 の送信(ArduPilot が目標を保持する)、姿勢要求。
- WS ゲートは追従中もスティックのゼロを落とす。速度 0 の `SET_PITCHYAW` でも ArduPilot は MAVLink 指令に切り替わり、ROI が終わるため。
- `roi_status`: `mode = null`、方位 / 仰角 / 距離と `yaw_cmd` / `pitch_cmd` は表示用に §4 と同じ式で計算、`gimbal_*` は姿勢から、`speed_*` は `null`。エラーは `no_position` / `position_stale` / `heading_unknown` / `camera_offline` / `send_failed`(位置の拒否・ACK 無し)で、ROI は解除しない。カメラ再接続時は位置をすぐ送り直す。

## 5. 時刻同期・SD・映像ソース

- 時刻同期(MT11): FC の `SYSTEM_TIME`(無ければ 1 Hz で要求)で 0x30。経過時間を足して送る。タイミング: 初回 GPS 時刻、(再)接続、10 分ごと、「今すぐ同期」。GPS 時刻が無い / 5 s 以上古いときは送らない。同期後に 0x40 で読み返し、RTT/2 補正の差を表示(1 s 超は赤)。
  - 実装(2026-10-23): 状態機械は `clock_sync.rs`(`time_sync.py` の移植)でドライバのアクター内にある。GPS 時刻はサーバーが注入する `GpsTime`(`RouterGpsTime`: ルーターの最新 `SYSTEM_TIME` のうち `time_unix_usec > 0` のもの、リンクの壁時計で受信時刻を付ける)。経過 = 壁時計の現在 − 受信時刻で、負なら古い扱い。プロファイル `clock_sync = false` なら注入せず自動同期は止まり、「今すぐ同期」は 409 `clock_sync_off`(UI のトグルは無く API のみ)。
  - 表示する差 `clock.offset_ms` は最後の同期の読み返し(カメラ − GPS、RTT 中点補正)。5 s ごとの 0x40 は `camera_unix_us` の更新だけ。赤: |差| > 1000 ms、または `clock.error`(`no_gps_time` / `gps_time_stale` / `no_readback` / `rejected` = 0x30 をカメラが拒否)。
- SD: 10 s ごと 0x49。空き 10% 未満、または status ≠ OK は赤。
- 映像ソース: `auto` は MT11 → Android → 無ければ 15 s 後に再スキャン。選択中は 3 s ごと確認、2 回連続失敗で切替。固定(`mt11` / `android`)は疎通に関わらずそのソース。Android 表示中はクリック追跡・検出枠・温度表示を無効。

## 6. ジョイスティック(ジンバル用プロファイル)

- 軸機能: `none` / `pan` / `tilt` / `zoom_abs`(軸 −1..1 → 1..最大倍率、0.5 刻み、2 Hz)/ `zoom_speed`(連続ズーム)/ `zoom_step`(±0.2 を越えるたびに 1 段)。各軸に不感帯(0–0.5)、反転、スケール(0.1–2)。
- ボタン機能: `shutter`, `record_toggle`, `center_gimbal`, `thermal_toggle`(RGB → IR → 2 画面を巡回), `thermal_gain_toggle`, `focus_near` / `focus_far`(押下中), `ai_tracking_toggle`(中央 200 px で開始), `gimbal_stop`, `zoom_in_step` / `zoom_out_step` / `zoom_1x`, `mode_lock` / `mode_follow` / `mode_fpv` / `mode_cycle`, `roi_1`…`roi_10`(押すたびに開始 / 停止。別の ROI 動作中なら押した目標に切替), `roi_stop`(動作中だけ停止)。`roi_*` は 2026-10-22、`thermal_gain_toggle`(High ⇄ Low、不明なら High)/ `ai_tracking_toggle`(追跡中は解除、それ以外は中央 200 px)/ `focus_near` / `focus_far`(押下で −1 / +1、離して 0。パッドが消えたときも 0)は 2026-10-23 実装済み。
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
- 2026-10-23 実装済み: サーマル温度・ゲイン・パレット(0x12 / 0x14 / 0x37 / 0x38 / 0x1B、`siyi/thermal.rs`)、AI 追跡(0x50 / 0x51 / 0x55 / 0x56 / 0x5F、`siyi/ai.rs`)、エンコード(0x20 / 0x21、`siyi/ai.rs` のプリセット)、時刻同期(0x30 / 0x40、`clock_sync.rs`)、SD(0x49、`siyi/tf_card.rs`)。ドライバは `siyi/{client,session,apply,exec,polls,expire}.rs` に分割。疑似サーバーは `siyi/sim_media.rs` で同じコマンドに応答し 0x50 / 0x5F を push する。サーバー: `gps_time.rs`、`auto_record.rs`(70 §3)、ROI ↔ AI 連動(§4)、`camera_state` 10 Hz 上限(50 §3.1)。UI: コックピットの重ね描き・クリック操作・AI追跡ボタン(10 §4.2)、カメラ設定「映像」タブと接続タブの SD / 時刻(10 §5)、状態カード・状態行。
- 未実装: Android ソース、0x13(領域温度)。
- 2026-10-23 実装済み: MAVLink カメラ(§2 `mavlink_cam`、`rgcs-mavlink::MavPort`、`rgcs-camera::mavlink_cam`、Native ROI §4.2、UI の接続タブ・状態行・パーセント表示のズーム)。
- GPS ROI(§4、MT11 Computed)は 2026-10-22 実装済み: `rgcs-camera::roi::{geo, pid, controller}`、サーバーの `RoiHub`(機体ごとに 1 タスク、0x07 10 Hz / 0x0E、ROI 中 0x0D を毎ステップ要求)、`roi_targets` / `roi_control`(60 §3.4)、REST(50 §2.3)、UI(カメラ設定の ROI タブ、地図マーカーと視線、コックピットの ROI チップ、状態行の ROI 名)、ジョイスティック `roi_*`。
- ジョイスティック(§6)は pan / tilt 軸とボタン機能(shutter, record_toggle, center_gimbal, thermal_toggle, gimbal_stop, zoom_in_step, zoom_out_step, zoom_1x, mode_*、2026-10-23 に thermal_gain_toggle, ai_tracking_toggle, focus_near, focus_far)を実装。zoom_abs / zoom_speed / zoom_step 軸は未実装。

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
  - 確認結果(2026-10-23、ArduCopter SITL `-I6`、自宅 36.2509, 137.6385, 1505 m、機首 359°、ARM なし):
    - Siyi ZT30 シミュレータ(`MNT1_TYPE 8`、`CAM1_TYPE 4`、`SERIAL5_PROTOCOL 8`、`--serial5=sim:siyi_zt30:`): caps(photo / record / zoom % / focus、pitch_range (−90, 20)、roi native)、FW `1.2.3`、接続中、状態行「MAVLink カメラ | ↔ 0.0° ↕ −35.4°」、接続タブの MAVLink 行。写真 → `IMAGE_START_CAPTURE` p1 1 / p3 1 を compid 1 へ、ACK ACCEPTED。録画開始 / 停止 → ACCEPTED、`recording` が切替。ズーム → `SET_CAMERA_ZOOM` ACCEPTED。速度 → `GIMBAL_DEVICE_ATTITUDE_STATUS` が変わる(+右で MAVLink ヨー +、状態行は −)。`DO_SET_ROI_LOCATION`(`COMMAND_INT`、`MAV_FRAME_GLOBAL`、p1 1)ACCEPTED、5 s ごとに再送、`DO_SET_ROI_NONE` p1 1 ACCEPTED。
    - サーボ雲台(`MNT1_TYPE 1`、ヨー ±180、`CAM1_TYPE 1`、SITL 再起動でカメラ差し替え → caps が写真だけに変わる): 角度 (左 30°, −20°) → 姿勢 MAVLink ヨー −30.0 / ↔ 30.0°、扇は機首の左 30°。ROI(200 m 東、1505 m)→ ↔ −90.7°、扇は東、ROI_NONE で既定姿勢に戻る。ROI 中も機首方位は 358–359° のまま(機体は回らない)。
    - SITL で確かめられないもの: Siyi シミュレータはズーム(SIYI 0x05 / 0x0F)とフォーカスを実装しておらず、ArduPilot がズームを転送すると SITL ごと PANIC で止まる。`zoomLevel` の変化と % 表示の追従は疑似応答(`mavlink_cam/fake.rs`)のテストだけ。Siyi シミュレータの姿勢は角度・ROI の閉ループで発散する(ロール ±100°、ヨーが回り続ける)ため、向きの正しさはサーボ雲台で確認した。この SITL は `CAMERA_CAPTURE_STATUS`(262)を流さず、録画状態は ACK による楽観更新だけ(262 の周期要求が 5 s ごとに続く)。映像(RTSP)は無し。
