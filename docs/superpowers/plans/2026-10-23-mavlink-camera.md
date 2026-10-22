# MAVLink Camera Driver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `mavlink` camera kind's `NoneCamera` placeholder with a real driver (spec 40 §2, row `mavlink_cam`). The work has four parts:
- **Camera:** `CAMERA_INFORMATION.flags` → photo / record / zoom / focus caps, sent as `MAV_CMD_IMAGE_START_CAPTURE`, `MAV_CMD_VIDEO_START_CAPTURE` / `STOP_CAPTURE`, `MAV_CMD_SET_CAMERA_ZOOM` and `MAV_CMD_SET_CAMERA_FOCUS`. State comes from `CAMERA_SETTINGS` (zoom %) and `CAMERA_CAPTURE_STATUS` (recording).
- **Gimbal:** `GIMBAL_MANAGER_INFORMATION` → rate / angle / attitude caps and pitch range. Commands go out as `GIMBAL_MANAGER_SET_PITCHYAW`; attitude comes from `GIMBAL_DEVICE_ATTITUDE_STATUS`.
- **GPS ROI, Native:** `RoiHub` sends `MAV_CMD_DO_SET_ROI_LOCATION` / `MAV_CMD_DO_SET_ROI_NONE` instead of running the computed controller. `video_modes = [Rgb]`. No thermal / AI / encoding / storage / clock.
- **UI:**
  - the camera settings 接続 tab enables `MAVLink カメラ` (コンポーネント ID, RTSP URL, connection / FW status);
  - the status row reads 「MAVLink カメラ | ↔ yaw ↕ pitch」;
  - the camera card shows only the ジンバル and 映像 rows;
  - zoom is shown in percent.

**Architecture:**
- **No socket of its own.** The driver talks through the FC link. `rgcs-mavlink` gets a `MavPort` handle with three parts:
  - a `broadcast` tap of camera / gimbal frames from **any** component (the `Router` drops non-FC components);
  - the existing `outgoing` sender;
  - the existing `acks` broadcast.
- **`MavPort::command`** sends one COMMAND_LONG / COMMAND_INT and waits for its COMMAND_ACK. It sends once and never retries, so a lost ACK never takes a second photo. It reuses the queue's `wait_ack`.
- **Pure protocol modules.** `crates/rgcs-camera/src/mavlink_cam/`, which now depends on `rgcs-mavlink`, holds pure modules with a `MavlinkCamera` actor on top:
  - `binding` (which component and device id is "our" camera / gimbal);
  - `caps`;
  - `attitude` (quaternion → SIYI-convention yaw / pitch);
  - `encode` (`CameraCommand` → frames);
  - `apply` (frame → `Model`).
- **The actor** owns the info requests, the stream requests, the 3 s liveness rule and a `watch<Model>`. Commands read that model and send directly from the caller's task.
- **Dynamic caps.** Caps change when `CAMERA_INFORMATION` / `GIMBAL_MANAGER_INFORMATION` arrive. `cameras::forward` re-reads `camera.caps()` for every frame instead of capturing it once. The driver bumps its state watch when its caps change.
- **Native ROI** runs in its own per-vehicle task, `apps/rgcs-server/src/roi_native.rs`. It speaks the same `roi::Cmd` protocol as `roi_task.rs`, so start / stop / retarget / manual cancel / shutdown and `roi_status` all keep their paths. `RoiHub::dispatch` picks the task from `caps.roi` when it spawns one. The pure state machine is `crates/rgcs-camera/src/roi/native.rs`.
- **Fake responder.** `mavlink_cam/fake.rs` (`cfg(any(test, feature = "sim"))`) plays an ArduPilot-like camera / gimbal manager on the `MavPort` channels. Driver and server tests use it. The live check uses a scratch ArduPilot SITL (`-I6`, tcp:5820) with the SITL Siyi ZT30 mount.

**Tech stack:** Rust (tokio, axum, mavlink 0.19.1 `ardupilotmega` dialect, ts-rs), React 19 + TypeScript (vitest, @testing-library, zod).

**Specs (binding):**
- `docs/spec/40-camera-gimbal.md`: §1 (trait, caps, commands, state), §2 `mavlink_cam` row, §4 (ROI rules that still apply: manual cancel, the zero drop while active, shutdown), §7.1 (MAVLink カメラ listed as 未実装), §7.2 (map fan uses `hfov_deg` and zoom), §8 last line (SITL + gimbal sim → UI by caps).
- `docs/spec/10-screens.md`:
  - §3.3 item 4 (「MAVLink カメラ | 角度」);
  - §4.2 acceptance (「MAVLink カメラでは録画 / 写真 / ズーム / ジンバル行だけ」);
  - §5 接続 (MAVLink: コンポーネント ID, RTSP URL).
- `docs/spec/50-api.md`:
  - §1 error codes;
  - §2.3 `camera/command`, `camera/profile`, `roi/start` (today: "caps.roi が `computed` でない → 409");
  - §3.1 `camera_state` (caps on every frame).
- `docs/spec/60-data-model.md` §3.3: `comp_id` 1–255 (MAVLink カメラ); `rtsp_url` free for MAVLink; §5 the RTSP host rule.
- `docs/spec/70-safety-auth.md` §3: `409 unsupported_capability`; auto record (ARM → `RecordStart`).
- `docs/spec/80-network.md` §2: COMPID 1 autopilot, 100 camera, 154 gimbal.
- Design:
  - `design_base/screenshots/glass_camera_settings_conn.png` (接続 tab layout; MAVLink rows follow the same `.form` + `.inset .kv` pattern);
  - `glass_ops_camera_mavlink.png` (camera strip: record, photo, − 1.5× +, gear; status row 「MAVLink カメラ | ↔ 0.0° ↕ −20.0°」);
  - `glass_cockpit_mavlink.png` (zoom slider bar; card rows ジンバル + 映像 only).
- ArduPilot reference (`~/github/rtos/ardupilot-latest`, read only):
  - `libraries/GCS_MAVLink/MAVLink_routing.cpp:179-264`: commands to compid 1 / 0 are processed locally; an unknown compid is processed locally when not forwarded;
  - `GCS_Common.cpp:5570-5590`: `DO_SET_ROI_LOCATION` with param1 0 / NaN = **legacy vehicle-yaw ROI**; param1 = gimbal id → that mount only;
  - `AP_Camera.cpp:322-381`: `ZOOM_TYPE_STEP` → DENIED; CONTINUOUS / RANGE accepted; focus CONTINUOUS / RANGE / AUTO;
  - `AP_Camera_Backend.cpp:224-251`: `camera_device_id = instance + 1`, `gimbal_device_id`;
  - `AP_Mount.cpp:505-551`: `GIMBAL_MANAGER_SET_PITCHYAW` needs both angles or both rates, in rad / rad/s, `YAW_LOCK` flag = earth frame;
  - `AP_Mount_Backend.cpp:456-480`: `GIMBAL_DEVICE_ATTITUDE_STATUS` from compid 1, `gimbal_device_id = instance + 1`, body-frame quaternion;
  - `Tools/autotest/arducopter.py:8890-8905`: `MountSiyiZT30` (`MNT1_TYPE=8`, `CAM1_TYPE=4`, `SERIAL5_PROTOCOL=8`, `--serial5=sim:siyi_zt30:`, cap flags `0xC3`, fw `0x030201`).

## Global Constraints
- TDD: every test is written and seen failing first.
- Immutable state: never mutate shared objects. In Rust, return new values where the codebase does (`fn tick(&self, …) -> (Self, …)`, `..self.clone()`).
- Files ≤ 400 lines typical, 800 max. Functions < 50 lines.
- UI:
  - single quotes, no semicolons, never run prettier;
  - Lucide icons only (`shared/ui/icons.tsx`);
  - never hand-edit `styles/prototype.css`;
  - no `window.confirm`.
- UI type check: `npx tsc --noEmit -p tsconfig.app.json`, run from `apps/rgcs-server/ui`.
- UI tests: `npx vitest run <paths>`.
- Rust:
  - `export PATH="$HOME/.cargo/bin:$PATH"`;
  - `cargo test -p <crate>`;
  - `cargo clippy --workspace --all-targets -- -D warnings`.
- ts-rs bindings (`apps/rgcs-server/ui/src/shared/api/generated/`) are committed.
- Commit messages are conventional (`feat(...)`) and end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never commit `.claude/`, `auto.crt`, `auto.key`.
- Never send vehicle commands or write vehicle params to the dev stack (ports 5760-5793, 8000, 5173, 14550, 14551, 37260). Live checks run only against a scratch server and a scratch SITL (`-I6`, tcp:5820) whose params are set **only** on that scratch instance (Task 8).
- Never use `pkill` / `killall` / pattern kills. Stop only processes you started, by the PID you recorded (`$!`).

## Fixed values (from the specs, the MAVLink XML and ArduPilot; tests assert these)

| Value | Fixed at | Source |
|---|---|---|
| Payload message ids tapped | 259 CAMERA_INFORMATION, 260 CAMERA_SETTINGS, 262 CAMERA_CAPTURE_STATUS, 280 GIMBAL_MANAGER_INFORMATION, 281 GIMBAL_MANAGER_STATUS, 285 GIMBAL_DEVICE_ATTITUDE_STATUS | common.xml |
| Info requests | `MAV_CMD_REQUEST_MESSAGE` (512), param1 259 / 280, target compid 0 (all), every 2 s until bound, once more on every reconnect edge; fire and forget | ruling 11 |
| Stream requests | `MAV_CMD_SET_MESSAGE_INTERVAL` (511): 260 @ 1 000 000 µs and 262 @ 1 000 000 µs to the camera compid; 285 @ 100 000 µs to the manager compid. Only when the message is > 3 s stale, at most every 5 s | ruling 12, `interval.rs` style |
| Liveness | connected ⇔ a binding exists and a frame from a bound compid arrived ≤ 3 000 ms ago; 250 ms tick | ruling 11 |
| Command ACK | one send, wait `ACK_TIMEOUT` 1.5 s (IN_PROGRESS extends to 10 s); not ACCEPTED → `Refused("camera_rejected")`; timeout → `Io("no COMMAND_ACK")` | ruling 7 |
| Photo | `IMAGE_START_CAPTURE` p1 camera id, p2 0, p3 1 (one image), p4 0 | common.xml |
| Record | `VIDEO_START_CAPTURE` p1 0 (stream), p2 0, p3 camera id; `VIDEO_STOP_CAPTURE` p1 0, p2 camera id | common.xml, `AP_Camera.cpp:426-433` |
| Zoom | `SET_CAMERA_ZOOM` p1 type (1 CONTINUOUS, 2 RANGE), p2 value, p3 camera id. Absolute = RANGE 0–100 %; step = RANGE current ± 10 %; speed = CONTINUOUS −1/0/1; reset = RANGE 0 | ruling 3 / 4 |
| Focus | `SET_CAMERA_FOCUS` p1 1 (CONTINUOUS), p2 dir (−1 near, +1 far, 0 stop), p3 camera id | common.xml |
| Camera id | `camera_device_id` from `CAMERA_INFORMATION` (1 for the first ArduPilot camera; 0 for a native MAVLink camera) | ruling 2 |
| Gimbal rate | `GIMBAL_MANAGER_SET_PITCHYAW` flags 0, pitch / yaw NaN, rates = value / 100 × 90 °/s in rad/s; +yaw right, +pitch up | `MAVLINK_GIMBAL_MAX_RATE_DPS = 90.0` |
| Gimbal angle | same message, rates NaN, pitch clamped to `pitch_range`, MAVLink yaw = **−`yaw_deg`** (CameraCommand yaw is SIYI +left) | ruling 5 |
| Attitude | quaternion ZYX → (roll, pitch, yaw_mav); `state.gimbal.yaw = −yaw_mav` (+left); `age_ms` from the receive time | ruling 5 |
| ROI | `COMMAND_INT` `DO_SET_ROI_LOCATION` (195), frame `MAV_FRAME_GLOBAL` (MSL), p1 = gimbal device id (never 0), x = round(lat·1e7), y = round(lon·1e7), z = alt_msl; release `COMMAND_LONG` `DO_SET_ROI_NONE` (197) p1 = device id; resend location every 5 000 ms while active | ruling 8 |
| Zoom caps | `ZoomCaps { max: 100.0, absolute: true, step: true, continuous: true, unit: Percent }` | ruling 3 |
| Firmware | `firmware_version` byte0.byte1.byte2 → `"major.minor.patch"` (0x030201 → `"1.2.3"`); 0 → no firmware | common.xml |
| hfov | `2·atan(sensor_size_h / (2·focal_length))` when both finite and > 0, else `None` (UI `DEFAULT_HFOV_DEG`) | ruling 15 |

## Rulings (spec conflicts / open questions decided here)
1. **Transport.** The driver gets frames and sends commands through `MavPort` from `rgcs-mavlink`. It never opens its own socket: the camera rides the FC link, and SITL / most links accept one client. `rgcs-camera` adds `rgcs-mavlink` + `mavlink` as dependencies. There is no cycle: `rgcs-mavlink` depends only on `rgcs-core`.
2. **What `comp_id` means.** The driver binds a camera in this order:
   - a `CAMERA_INFORMATION` with `camera_device_id == 0` from compid == `profile.comp_id` (a native MAVLink camera, default 100);
   - otherwise the first one with `camera_device_id == 1` from any compid (an ArduPilot-attached camera, compid 1).
   - Commands target the bound compid with `camera_device_id` as the camera id param.
   - The gimbal binds the `GIMBAL_MANAGER_INFORMATION` whose `gimbal_device_id` equals the camera's `gimbal_device_id` (when ≠ 0), else the first manager seen.
   - Only one camera and one gimbal per vehicle are supported (CAM2 / MNT2 are out of scope).
3. **Zoom is a percentage (spec 40 §1.1 conflict).** MAVLink exposes no multiplier and no maximum. ArduPilot reports `CAMERA_SETTINGS.zoomLevel` as 0–100 % of its range. `ZoomCaps` gains `unit: ZoomUnit (Times | Percent)`, serde default `Times`.
   - MAVLink sets `max: 100` and `Percent`; `state.zoom` is the percentage (0 until known, NaN kept as the last value).
   - The UI shows `40%` instead of `×`, the cockpit slider is linear for Percent, and the map fan uses zoom 1 for Percent.
   - The design's 「1.5×」 is a mock value.
4. **ZoomStep** uses RANGE (current % + 10 × `steps.signum()`), clamped to 0..100, because ArduPilot DENIES `ZOOM_TYPE_STEP`.
5. **Yaw convention.** `CameraState.gimbal.yaw` and `GimbalAngle.yaw_deg` follow the SIYI convention (+left, body frame; spec 40 §3 0x0D, `roi/geo.rs::to_gimbal_angles`). `GimbalRate` +yaw is right.
   - MAVLink yaw is +right (clockwise), so attitude yaw and angle yaw are negated, and rates are not.
   - An attitude with `GIMBAL_DEVICE_FLAGS_YAW_IN_EARTH_FRAME` (64) uses `delta_yaw` when it is finite. Otherwise it sets `gimbal = None`, which hides the fan instead of drawing a wrong one.
6. **Gimbal modes / centre.**
   - `modes: []`: ArduPilot's lock / follow is per command, and the spec row lists only rate / angle / attitude.
   - `center: true` when the manager has `HAS_NEUTRAL` (2). `Center` / `OneKeyReset` → angle (0, 0); `FaceDown` / `CenterFaceDown` → angle (0, `pitch_min`).
   - The status row shows 「MAVLink カメラ」 in place of the mode (spec 10 §3.3 「MAVLink カメラ | 角度」).
7. **ACK policy.**
   - Camera commands (photo, record, zoom, focus) and ROI wait for their COMMAND_ACK, matched on (sysid, command) like the queue.
   - No retry.
   - A non-ACCEPTED result → `409 camera_rejected`, a new code added to spec 50 §1 and translated by the UI `camErr_camera_rejected`.
   - No ACK → `503 camera_error` (the existing `CameraError::Io` mapping).
   - `GIMBAL_MANAGER_SET_PITCHYAW` has no ACK: rate / angle / centre return `Ok` once queued on the link.
8. **ROI Native.**
   - **Conditions.** `caps.roi = Native` only when the bound manager has `CAN_POINT_LOCATION_GLOBAL` (131072), else `None`. `RoiHub::start` accepts `computed | native`, which widens spec 50 §2.3's "computed でない → 409".
   - **Location and release.**
     - p1 is always the gimbal device id: p1 = 0 makes a Copter yaw the **whole vehicle** at the target.
     - The location goes out as `COMMAND_INT` / `MAV_FRAME_GLOBAL`, because `RoiTarget.alt_msl` is MSL and COMMAND_LONG implies relative alt.
     - Stop paths (operator, manual ≥ 5, `gimbal_angle` / `center`, profile reload, slot unset, shutdown) send `ROI_NONE` once, and retry once on failure.
     - A target coordinate change resends the location, and so does each 5 s tick (an FC reboot or a mission `DO_SET_ROI` would otherwise win silently).
   - **What does not apply.**
     - `RoiControl` (rate / angle / PID) does not apply; the ROI tab hides `RoiControlForm` for Native.
     - No zero-speed resends: ArduPilot holds the target.
     - No `request_attitude` is needed.
   - **Status.**
     - `RoiStatus.mode = null`; `bearing / elevation / distance / yaw_cmd / pitch_cmd` come from `look_angles` + `to_gimbal_angles` for display; `gimbal_*` come from the state; `speed_*` are `null`.
     - Errors: `no_position`, `position_stale`, `heading_unknown`, `camera_offline`, `send_failed` (a refused or unacked location). ROI stays active.
   - The WS gate still drops stick zeros while ROI is active: a rate 0 `SET_PITCHYAW` would switch ArduPilot to MAVLink targeting and end the ROI.
9. **Dynamic caps.** `cameras::forward` takes the `Arc<dyn Camera>` and reads `caps()` for each frame. `MavlinkCamera` re-sends its state (`send_replace(next)`) whenever the caps change, so a caps change reaches the WS within the 100 ms gap. Spec 50 §3.1 already carries caps on every frame.
10. **`link_zero` is skipped for `CameraKind::Mavlink`.** The FC link is the camera link. A link-up rate 0 would cancel FC-side targeting (mission `DO_SET_ROI`, RC, native ROI). The deadman zero from the WS gate still applies.
11. **Liveness.** `connected` = bound + a bound-compid frame ≤ 3 s old. On the disconnect edge the driver keeps its bindings, so caps are stable and the UI stays greyed. On each reconnect edge it re-requests both info messages, so a camera swapped after an FC reboot updates its caps. `send` while disconnected → `NotConnected` (503 `camera_offline`).
12. **Streams.** The driver requests 260 / 262 / 285 itself (ruling-table rates), only when stale. So Mission Planner's or the FC's own rates are left alone, as in `interval.rs`.
13. **Profile / video.**
    - For `kind = mavlink` the UI shows only コンポーネント ID and RTSP URL. It sets `host` from the RTSP URL's host when that is an IPv4 literal, so the existing rule (60 §5: the RTSP host must be the camera's address) keeps holding without a server change.
    - The video monitor probes `rtsp_url` as it does for MT11.
    - Registering the URL as a MediaMTX path is **out of scope**: `deploy/mediamtx.yml` has `api: no` and a static `mt11` path. The operator points that path at the MAVLink camera by hand; this is noted in spec 40 §2.
14. **Recording state.** It is set optimistically to `Recording` / `Idle` on an ACCEPTED start / stop, then overridden by `CAMERA_CAPTURE_STATUS.video_status` (1 → Recording, 0 → Idle). Auto record works unchanged; `storage` is `None`, so there is no SD warning.
15. **hfov** comes from `CAMERA_INFORMATION` (fixed-value table). ArduPilot reports NaN, so the UI's default 62° is used.
16. **Acceptance 「録画 / 写真 / ズーム / ジンバル行だけ」 vs. the cockpit design** (which also shows 映像 RTSP 380 ms): the 映像 row stays. It is the video link, not a camera capability. The sentence is read as "no thermal / SD / clock / ROI-control / AI".
17. **Firmware:** `Firmware { camera: "1.2.3", gimbal: "", zoom: "" }`. The MAVLink status box prints `cam 1.2.3` only.

## Review Focus (untested-in-isolation failure modes most likely to bite an operator)
1. **ROI turns the whole aircraft or the wrong mount.**
   - A `DO_SET_ROI_LOCATION` with p1 = 0 / NaN is ArduPilot's legacy vehicle-yaw ROI.
   - The fake asserts p1 = 1, but real behaviour depends on the FC version and on `MNTx` numbering versus the MAVLink gimbal compid 154.
   - Verify live (Task 8): the copter's heading does not change when ROI starts in GUIDED / LOITER.
2. **Yaw mirrored.**
   - SIYI +left versus MAVLink +right touches four places: attitude, angle command, map fan and ROI status.
   - Unit tests cover the signs, but only the live check (target east → status row ↔ −90°, fan pointing east) proves the chain.
3. **A rate frame silently ends FC-side targeting.**
   - Any `SET_PITCHYAW` switches ArduPilot to MAVLink targeting: a stray zero from the joystick loop, a deadman, a reload, or `link_zero` if ruling 10 regresses.
   - Check that every zero path is dropped while ROI is active, and that nothing sends a rate on connect.
4. **Caps stay empty.**
   - Possible causes:
     - the info reply arrives before the driver subscribes;
     - the payload broadcast lags (`RecvError::Lagged` must not end the task);
     - the FC answers `REQUEST_MESSAGE` from compid 1 for a camera bound at 100;
     - `forward` regresses to cached caps.
   - Any of these leaves the UI showing only 「MAVLink カメラ」 with no buttons. The server test asserts the caps change reaches `camera_state`.
5. **ACK cross-talk / double actions.**
   - ACKs are matched on (sysid, command) only:
     - a vehicle-queue command, or a second GCS (Mission Planner) sending the same `MavCmd`, can complete the wrong waiter;
     - a camera at compid 100 ACKs from 100 while ArduPilot ACKs from 1.
   - A retry would take a second photo, so ruling 7 sends once. Confirm no caller wraps `send` in its own retry: auto record retries `RecordStart` only after a failure, which is safe.

---

### Task 1: Core types — zoom unit, ROI hooks on the trait

**Files:**
- Modify:
  - `crates/rgcs-core/src/camera.rs` (`ZoomUnit`, `ZoomCaps.unit`, the `siyi_mt11()` literal);
  - `crates/rgcs-core/src/camera_tests.rs`;
  - `crates/rgcs-core/src/lib.rs` (re-export `ZoomUnit`);
  - `crates/rgcs-camera/src/camera.rs` (trait);
  - `crates/rgcs-camera/src/none.rs` (nothing new; it uses the defaults).
- Regenerated: `apps/rgcs-server/ui/src/shared/api/generated/{ZoomCaps,ZoomUnit}.ts`.
- Modify (TS compile only): every UI `ZoomCaps` literal that tsc reports (tests and `features/detail/DetailPanel.tsx` fixtures if any).

**Interfaces — Produces:**
```rust
// rgcs-core camera.rs — Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS, snake_case
pub enum ZoomUnit { #[default] Times, Percent }
pub struct ZoomCaps { pub max: f32, pub absolute: bool, pub step: bool, pub continuous: bool,
    #[serde(default)] pub unit: ZoomUnit }
// rgcs-camera camera.rs — new defaulted trait methods
async fn roi_location(&self, _lat: f64, _lon: f64, _alt_msl: f64) -> Result<(), CameraError> {
    Err(CameraError::Unsupported("roi"))
}
async fn roi_none(&self) -> Result<(), CameraError> { Err(CameraError::Unsupported("roi")) }
```

- [ ] **Step 1: Write failing tests** (`camera_tests.rs`):
  - `zoom_unit_defaults_to_times`: `serde_json::from_str::<ZoomCaps>(r#"{"max":165,"absolute":true,"step":true,"continuous":true}"#)` → `unit == Times`;
  - `siyi_caps_keep_times`: `CameraCaps::siyi_mt11().zoom.unwrap().unit == ZoomUnit::Times`;
  - `zoom_unit_serializes_snake_case`: `ZoomUnit::Percent` → `"percent"`.
  - In `crates/rgcs-camera/src/none.rs` tests: `none_camera_refuses_roi`: `NoneCamera::default().roi_location(35.0, 139.0, 10.0).await == Err(Unsupported("roi"))`, and the same for `roi_none`.
- [ ] **Step 2:** `cargo test -p rgcs-core camera` and `cargo test -p rgcs-camera none`. Expected: FAIL to compile.
- [ ] **Step 3: Implement.** Then run `cargo test -p rgcs-core` to regenerate the bindings and fix the TS literals tsc reports (add `unit: 'times'`).
- [ ] **Step 4:** `cargo test -p rgcs-core -p rgcs-camera` → PASS. `npx tsc --noEmit -p tsconfig.app.json` → clean.
- [ ] **Step 5:** commit `feat(core): zoom unit and native ROI hooks on the camera trait`.

### Task 2: `MavPort` — payload tap and single-shot commands (`rgcs-mavlink`)

**Files:**
- Create: `crates/rgcs-mavlink/src/port.rs`.
- Modify:
  - `crates/rgcs-mavlink/src/queue.rs` (`wait_ack` becomes `pub(crate)` with a `timeout` argument; behaviour unchanged);
  - `crates/rgcs-mavlink/src/connection.rs` (`LinkChannels.payload`; `receive_loop` publishes `tap(..)`);
  - `crates/rgcs-mavlink/src/lib.rs` (re-exports);
  - `apps/rgcs-server/src/main.rs` (payload channel, `MavPort::new`, `.with_mav_port(...)` added in Task 5; here it only builds the channel and passes it to `LinkChannels`).

**Interfaces — Produces:**
```rust
// port.rs
pub const PAYLOAD_IDS: [u32; 6] = [259, 260, 262, 280, 281, 285];
pub const PAYLOAD_CAPACITY: usize = 256;
#[derive(Debug, Clone)]
pub struct PayloadFrame { pub header: MavHeader, pub message: MavMessage }
pub fn tap(header: &MavHeader, msg: &MavMessage) -> Option<PayloadFrame>;  // Some only for PAYLOAD_IDS
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum PortError { #[error("link closed")] Closed }
#[derive(Clone)]
pub struct MavPort { outgoing: mpsc::Sender<Outgoing>, acks: broadcast::Sender<Ack>, payload: broadcast::Sender<PayloadFrame> }
impl MavPort {
    pub fn new(outgoing: mpsc::Sender<Outgoing>, acks: broadcast::Sender<Ack>, payload: broadcast::Sender<PayloadFrame>) -> Self;
    /// No link: `send` → Err(Closed), `command` → Outcome::LinkClosed (AppState::new default).
    pub fn detached() -> Self;
    pub fn subscribe(&self) -> broadcast::Receiver<PayloadFrame>;
    pub async fn send(&self, message: MavMessage) -> Result<(), PortError>;
    /// One send, no retry; waits ACK_TIMEOUT (IN_PROGRESS extends to IN_PROGRESS_TIMEOUT).
    pub async fn command(&self, sysid: SysId, message: MavMessage, ack_for: MavCmd) -> Outcome;
}
// connection.rs
pub struct LinkChannels { /* existing … */ pub payload: broadcast::Sender<PayloadFrame> }
```

- [ ] **Step 1: Write failing tests** (`port.rs` `mod tests`, `#[tokio::test(start_paused = true)]`):
  - `tap_keeps_only_payload_ids`:
    - `CAMERA_INFORMATION` from compid 100 → `Some` with `header.component_id == 100`;
    - `GIMBAL_DEVICE_ATTITUDE_STATUS` → `Some`;
    - `HEARTBEAT` → `None`;
    - `COMMAND_ACK` → `None`.
  - `command_returns_on_its_ack`:
    - spawn `command(1, COMMAND_LONG(IMAGE_START_CAPTURE), MAV_CMD_IMAGE_START_CAPTURE)`;
    - receive the `Outgoing` and broadcast `Ack { sysid: 1, command: IMAGE_START_CAPTURE, result: ACCEPTED }`;
    - → `Outcome::Accepted`.
  - `command_never_retries`: no ACK → `Outcome::Timeout` after 1.5 s, and the outgoing receiver saw exactly **1** frame (contrast `queue::no_ack_retries_three_times_then_times_out`).
  - `command_ignores_other_sysid_and_reports_refusal`: ACK sysid 2 ACCEPTED, then sysid 1 DENIED → `Outcome::Refused("denied")`.
  - `detached_port_reports_closed`: `MavPort::detached().send(HEARTBEAT)` → `Err(PortError::Closed)`; `command(..)` → `Outcome::LinkClosed`.
  - `connection.rs`: `link_channels_carry_a_payload_sender` (compile-level: build `LinkChannels { payload, .. }` in the existing test helpers).
- [ ] **Step 2:** `cargo test -p rgcs-mavlink port`. Expected: FAIL to compile.
- [ ] **Step 3: Implement.**
  - In `receive_loop`, after `inspector.record`: `if let Some(f) = crate::port::tap(&header, &msg) { let _ = ch.payload.send(f); }`. Never `.await` on the broadcast.
  - `main.rs`: `let (payload_tx, _) = broadcast::channel(rgcs_mavlink::port::PAYLOAD_CAPACITY);` passed to `LinkChannels`.
- [ ] **Step 4:** `cargo test -p rgcs-mavlink` → PASS (queue tests unchanged). `cargo build -p rgcs-server`. clippy.
- [ ] **Step 5:** commit `feat(mavlink): payload frame tap and single-shot command port`.

### Task 3: Pure MAVLink camera protocol (`rgcs-camera::mavlink_cam`)

**Files:**
- Create:
  - `crates/rgcs-camera/src/mavlink_cam/mod.rs`;
  - `binding.rs`, `caps.rs`, `attitude.rs`, `encode.rs`, `apply.rs`;
  - `encode_tests.rs` (`#[path]` from `encode.rs`).
- Modify:
  - `crates/rgcs-camera/Cargo.toml` (`rgcs-mavlink = { workspace = true }`, `mavlink = { workspace = true }`);
  - `crates/rgcs-camera/src/lib.rs` (`pub mod mavlink_cam;`).

**Interfaces — Produces:**
```rust
// binding.rs
pub const AUTOPILOT_CAMERA_DEVICE: u8 = 1;
#[derive(Debug, Clone, PartialEq)]
pub struct CameraBinding { pub compid: u8, pub device_id: u8, pub flags: u32, pub gimbal_device_id: u8,
    pub firmware: Option<String>, pub hfov_deg: Option<f32> }
#[derive(Debug, Clone, PartialEq)]
pub struct GimbalBinding { pub manager_compid: u8, pub device_id: u8, pub cap_flags: u32, pub pitch_range: (f32, f32) }
pub fn bind_camera(current: Option<&CameraBinding>, header: &MavHeader, info: &CAMERA_INFORMATION_DATA, profile_comp_id: u8) -> Option<CameraBinding>;
pub fn bind_gimbal(current: Option<&GimbalBinding>, camera: Option<&CameraBinding>, header: &MavHeader, info: &GIMBAL_MANAGER_INFORMATION_DATA) -> Option<GimbalBinding>;
pub fn attitude_matches(g: &GimbalBinding, header: &MavHeader, status: &GIMBAL_DEVICE_ATTITUDE_STATUS_DATA) -> bool;
pub fn firmware_text(v: u32) -> Option<String>;           // 0 → None
// caps.rs
pub fn mavlink_caps(cam: Option<&CameraBinding>, gimbal: Option<&GimbalBinding>) -> CameraCaps;
// attitude.rs
pub fn quat_to_euler_deg(q: [f32; 4]) -> (f32, f32, f32);  // (roll, pitch, yaw_mav), q = [w, x, y, z]
pub fn to_attitude(s: &GIMBAL_DEVICE_ATTITUDE_STATUS_DATA) -> Option<(f32, f32, f32)>;  // (yaw +left, pitch, roll)
// encode.rs
pub const MAVLINK_GIMBAL_MAX_RATE_DPS: f32 = 90.0;
pub const ZOOM_STEP_PCT: f32 = 10.0;
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Targets { pub sysid: SysId, pub camera: Option<(u8, u8)>, pub gimbal: Option<(u8, u8, (f32, f32))> } // (compid, device), (+pitch range)
#[derive(Debug, Clone, PartialEq)]
pub enum Encoded { Message(MavMessage), Command { message: MavMessage, ack_for: MavCmd } }
pub fn encode(cmd: &CameraCommand, t: &Targets, zoom_pct: f32) -> Result<Vec<Encoded>, CameraError>;
pub fn roi_location(t: &Targets, lat: f64, lon: f64, alt_msl: f64) -> Result<Encoded, CameraError>;
pub fn roi_none(t: &Targets) -> Result<Encoded, CameraError>;
pub fn request_message(sysid: SysId, msg_id: u32) -> MavMessage;                       // target compid 0
pub fn message_interval(sysid: SysId, compid: u8, msg_id: u32, interval_us: u32) -> MavMessage;
// apply.rs
#[derive(Debug, Clone, PartialEq)]
pub struct Model { pub camera: Option<CameraBinding>, pub gimbal: Option<GimbalBinding>,
    pub last_rx_ms: Option<u64>, pub seen_ms: std::collections::BTreeMap<u32, u64>, pub state: CameraState }
impl Model { pub fn new() -> Self; pub fn caps(&self) -> CameraCaps; pub fn targets(&self, sysid: SysId) -> Targets; }
pub fn apply(m: &Model, f: &PayloadFrame, profile_comp_id: u8, now_ms: u64) -> Model;
pub fn liveness(m: &Model, now_ms: u64) -> Model;          // sets state.connected (≤ 3 000 ms), gimbal.age_ms
```
- `mavlink_caps` returns `kind: Mavlink`, `video_modes: [Rgb]`, `thermal / ai_tracking: None`, `encoding_presets: []` and `storage_info / clock_sync: false`. From the camera flags: photo = flags & 2, record = flags & 1, zoom = flags & 64 (ruling-3 caps), focus = flags & 128. From the gimbal:

  | Cap | Value |
  |---|---|
  | `rate` / `angle` | `cap & (32 \| 256) != 0` |
  | `center` | `cap & 2` |
  | `modes` | `[]` |
  | `attitude` | `true` |
  | `pitch_range` | from rad |
  | `roi` | `Native` iff `cap & 131072`, else `None` |

- `Model::new()` uses `state = CameraState { zoom: 0.0, ..CameraState::disconnected(100.0) }`.

- [ ] **Step 1: Write failing tests.**
  - binding:
    - `ardupilot_camera_binds_device_1`: header compid 1, `camera_device_id 1`, flags 0xC3, fw 0x030201 → `CameraBinding { compid: 1, device_id: 1, flags: 0xC3, firmware: Some("1.2.3"), .. }`;
    - `native_camera_needs_profile_comp_id`: compid 100 / device 0 with profile 100 → bound; with profile 101 → `None`;
    - `native_beats_autopilot`: current = autopilot binding; native at profile compid → replaces it; another autopilot device 2 → keeps current;
    - `gimbal_follows_camera_gimbal_id`: camera `gimbal_device_id 1`; managers announcing device 2 then 1 → binds device 1, `manager_compid 1`; `pitch_min −1.5707964`, `pitch_max 0.5235988` → `pitch_range (−90.0, 30.0)` ± 0.01;
    - `attitude_matches_device_or_sender`: status `gimbal_device_id 1` → true; status 0 from header compid 154 with binding device 154 → true; status 2 → false.
  - caps:
    - `full_ardupilot_caps`: flags 0xC3 + manager cap `32|256|2|131072` → photo, record, focus true; zoom `{max 100, absolute, step, continuous, unit Percent}`; gimbal `{rate, angle, center: true, modes: [], attitude, pitch_range (−90, 30)}`; `roi Native`; `video_modes [Rgb]`; `thermal None`;
    - `photo_only_servo_camera`: flags 0x02, no gimbal → photo true, record false, zoom None, focus false, gimbal None, roi None;
    - `no_point_location_no_roi`: manager cap `32|256` → roi None;
    - `hfov_from_sensor`: focal 4.5, sensor_h 6.17 → `Some(68.87 ± 0.01)`; NaN → None.
  - attitude:
    - `yaw_90_right_is_minus_90_left`: q `[0.70710677, 0, 0, 0.70710677]`, flags 0 → yaw −90 ± 0.01, pitch 0;
    - `pitch_down_30`: q `[0.9659258, 0, −0.25881904, 0]` → pitch −30 ± 0.01, yaw 0;
    - `earth_frame_uses_delta_yaw`: flags 64, `delta_yaw 0.5235988` → yaw −30; flags 64 + NaN → `None`.
  - encode (`encode_tests.rs`; targets `{ sysid 1, camera (1, 1), gimbal (1, 1, (−90, 30)) }`):
    - `photo`: `COMMAND_LONG { command: IMAGE_START_CAPTURE, target_system 1, target_component 1, param1 1.0, param2 0.0, param3 1.0, param4 0.0 }`, `ack_for IMAGE_START_CAPTURE`;
    - `record_start_stop`: VIDEO_START p1 0, p2 0, p3 1; VIDEO_STOP p1 0, p2 1;
    - `zoom_absolute_clamps`: 40 → p1 2.0, p2 40.0, p3 1.0; 140 → p2 100.0; −5 → 0.0;
    - `zoom_step_is_range`: steps 1 at 40 → 50.0; steps −1 at 5 → 0.0; steps 3 at 95 → 100.0;
    - `zoom_speed_and_reset`: dir −1 → p1 1.0, p2 −1.0; reset → p1 2.0, p2 0.0;
    - `focus_continuous`: dir 1 → `SET_CAMERA_FOCUS` p1 1.0, p2 1.0, p3 1.0;
    - `gimbal_rate`: `{yaw: 50, pitch: −100}` → `GIMBAL_MANAGER_SET_PITCHYAW { target_component 1, gimbal_device_id 1, flags 0, pitch NaN, yaw NaN, yaw_rate 0.7853982, pitch_rate −1.5707964 }` (± 1e-6), as `Encoded::Message`;
    - `gimbal_angle_negates_yaw_and_clamps_pitch`: `{yaw_deg: 30, pitch_deg: −120}` → yaw −0.5235988, pitch −1.5707964, rates NaN;
    - `center_modes`: Center → (0, 0); FaceDown → pitch −1.5707964;
    - `video_mode_rgb_is_noop`: `Ok(vec![])`;
    - `unsupported`: `GimbalMode`, `ThermalGain`, `AiCancel`, `Encoding`, `SyncClock` → `Err(Unsupported(name))`;
    - `no_camera_binding`: Photo with `camera: None` → `Err(Unsupported("photo"))`;
    - `roi_location_command_int`: `(36.2509, 137.6385, 1600.0)` → `COMMAND_INT { command: DO_SET_ROI_LOCATION, frame: MAV_FRAME_GLOBAL, target_component 1, param1 1.0, x 362_509_000, y 1_376_385_000, z 1600.0, current 0, autocontinue 0 }`;
    - `roi_never_uses_device_0`: gimbal device 0 → `Err(Unsupported("roi"))`;
    - `roi_none`: `COMMAND_LONG DO_SET_ROI_NONE` p1 1.0;
    - `requests`: `request_message(1, 259)` → `REQUEST_MESSAGE` p1 259.0, `target_component 0`; `message_interval(1, 1, 285, 100_000)` → p1 285.0, p2 100000.0.
  - apply:
    - `camera_settings_sets_zoom_percent`: 260 with zoomLevel 40 from the bound compid → `state.zoom 40`; NaN → unchanged;
    - `capture_status_sets_recording`: video_status 1 → `Recording`, 0 → `Idle`;
    - `foreign_component_ignored`: CAMERA_SETTINGS from compid 50 → model unchanged (`last_rx_ms` too);
    - `liveness_3s`: last_rx 1 000, now 4 000 → connected; now 4 001 → not;
    - `attitude_sets_gimbal`: state.gimbal `{yaw −90, pitch 0, roll 0, age_ms 0}`; liveness at +250 ms → `age_ms 250`.
- [ ] **Step 2:** `cargo test -p rgcs-camera mavlink_cam`. Expected: FAIL to compile.
- [ ] **Step 3: Implement.** Quaternion ZYX:
  ```rust
  let roll = (2.0 * (w * x + y * z)).atan2(1.0 - 2.0 * (x * x + y * y));
  let pitch = (2.0 * (w * y - z * x)).clamp(-1.0, 1.0).asin();
  let yaw = (2.0 * (w * z + x * y)).atan2(1.0 - 2.0 * (y * y + z * z));
  ```
- [ ] **Step 4:** `cargo test -p rgcs-camera` → PASS. clippy.
- [ ] **Step 5:** commit `feat(camera): MAVLink camera / gimbal protocol (binding, caps, encode, attitude)`.

### Task 4: Fake responder + `MavlinkCamera` actor

**Files:**
- Create:
  - `crates/rgcs-camera/src/mavlink_cam/fake.rs` (`#[cfg(any(test, feature = "sim"))]`);
  - `crates/rgcs-camera/src/mavlink_cam/driver.rs`;
  - `crates/rgcs-camera/src/mavlink_cam/driver_tests.rs`.
- Modify: `crates/rgcs-camera/src/mavlink_cam/mod.rs`, `crates/rgcs-camera/src/lib.rs` (`pub use mavlink_cam::driver::MavlinkCamera;`).

**Interfaces:**
- Consumes: Tasks 1–3, `MavPort`.
- Produces:
```rust
// fake.rs — an ArduPilot-like camera (compid 1, device 1) + gimbal manager (compid 1, device 1)
#[derive(Debug, Clone)]
pub struct FakeConfig { pub cam_flags: u32, pub cam_compid: u8, pub camera_device_id: u8, pub firmware: u32,
    pub manager_caps: u32, pub gimbal_device_id: u8, pub pitch_range_deg: (f32, f32),
    pub reject: Vec<MavCmd>, pub mute: Vec<MavCmd>, pub stream_unasked: bool }
impl Default for FakeConfig { /* 0xC3, 1, 1, 0x030201, 32|256|2|131072, 1, (−90, 30), [], [], false */ }
pub struct FakeMav { /* port, log, attitude, paused, task */ }
impl FakeMav {
    pub fn start(sysid: SysId, cfg: FakeConfig) -> Self;
    pub fn port(&self) -> MavPort;
    pub fn sent(&self) -> Vec<MavMessage>;              // every frame the driver sent, in order
    pub fn commands(&self) -> Vec<MavCmd>;              // COMMAND_LONG / COMMAND_INT commands only
    pub fn set_paused(&self, paused: bool);             // stop answering / streaming (link loss)
}
// driver.rs
pub const STALE_MS: u64 = 3_000;
pub const INFO_RETRY: Duration = Duration::from_secs(2);
pub const STREAM_RETRY_MS: u64 = 5_000;
pub const TICK: Duration = Duration::from_millis(250);
pub struct MavlinkCamera { /* sysid, comp_id, port, model: watch::Sender<Model>, state: watch::Sender<CameraState>, task */ }
impl MavlinkCamera { pub fn new(sysid: SysId, comp_id: u8, port: MavPort) -> Self; }
#[async_trait] impl Camera for MavlinkCamera {
    fn caps(&self) -> CameraCaps;                  // model.borrow().caps()
    async fn send(&self, cmd: CameraCommand) -> Result<(), CameraError>;
    fn state(&self) -> watch::Receiver<CameraState>;
    async fn connect(&self) -> Result<(), CameraError>;   // spawns the actor (idempotent)
    async fn disconnect(&self);                           // aborts it
    async fn request_attitude(&self) -> Result<(), CameraError>;  // Ok(()) — streamed at 10 Hz
    async fn roi_location(&self, lat: f64, lon: f64, alt_msl: f64) -> Result<(), CameraError>;
    async fn roi_none(&self) -> Result<(), CameraError>;
}
```
- The fake streams:
  - 285 at 10 Hz (or only after a `SET_MESSAGE_INTERVAL`, unless `stream_unasked`);
  - 260 / 262 at 1 Hz.
- It answers `REQUEST_MESSAGE` 259 / 280 with the info frames. `COMMAND_LONG` / `COMMAND_INT` get a `COMMAND_ACK`: ACCEPTED, or DENIED for `reject`, or nothing for `mute`.
- It applies effects:
  - ZOOM RANGE → zoomLevel;
  - VIDEO_START / STOP → `video_status`;
  - SET_PITCHYAW angles → attitude (yaw_mav, pitch).
- Actor loop: `select!` over `port.subscribe()` (`Lagged` → continue), the 250 ms tick (liveness, info / stream requests) and stop. On every model change the actor does both:
  - `state.send_replace(model.state.clone())`;
  - when `caps()` changed, a forced re-send even if the state is equal.
- `send`:
  - not connected → `NotConnected`;
  - `encode` → each `Message` via `port.send` (`Closed` → `Io`), each `Command` via `port.command`, with `Outcome` mapped per ruling 7;
  - on ACCEPTED `RecordStart` / `RecordStop`, the optimistic recording update (ruling 14).

- [ ] **Step 1: Write failing tests** (`driver_tests.rs`, `#[tokio::test(start_paused = true)]`, `FakeMav::start(1, FakeConfig::default())`, `MavlinkCamera::new(1, 100, fake.port())`, `connect()`):
  - `binds_from_the_fake_within_3s`: within 3 s, `caps().photo && caps().record`, `caps().zoom.unwrap().unit == Percent`, `caps().gimbal.unwrap().pitch_range == (−90.0, 30.0)`, `caps().roi == Native`, `state().borrow().connected`, firmware camera `"1.2.3"`.
  - `asks_info_on_compid_0_until_bound`: `fake.sent()` holds `REQUEST_MESSAGE` p1 259 and 280 with `target_component 0`; none after binding over the next 10 s.
  - `requests_attitude_stream_when_missing`: one `SET_MESSAGE_INTERVAL` p1 285, p2 100000.0, `target_component 1`. With `stream_unasked: true` → none.
  - `photo_once`: `send(Photo)` → `Ok`; `fake.commands()` has exactly one `IMAGE_START_CAPTURE`.
  - `rejected_zoom_is_camera_rejected`: `reject: [SET_CAMERA_ZOOM]` → `send(ZoomAbsolute{zoom: 40.0})` → `Err(Refused("camera_rejected"))`.
  - `mute_record_is_io_error`: `mute: [VIDEO_START_CAPTURE]` → after 1.5 s, `Err(Io(_))`, one send.
  - `zoom_and_recording_follow_the_camera`: ZoomAbsolute 40 → `state.zoom == 40.0` within 1.5 s; RecordStart → `recording == Recording` immediately and still after the next 262.
  - `angle_round_trip_keeps_the_sign`: `GimbalAngle{yaw_deg: 30.0, pitch_deg: −20.0}` → after 200 ms, `state.gimbal.yaw` 30 ± 0.1 and pitch −20 ± 0.1 (the fake stored MAVLink yaw −30).
  - `link_loss_disconnects_and_rebinds`:
    - `set_paused(true)` → `connected == false` by 3.25 s, and `send(Photo)` → `Err(NotConnected)`, while caps stay non-empty;
    - `set_paused(false)` → connected again, and `REQUEST_MESSAGE` 259 was sent again after the edge.
  - `roi_location_and_none_wait_for_acks`: both `Ok`; `fake.commands() == [.., DO_SET_ROI_LOCATION, DO_SET_ROI_NONE]`; with `reject: [DO_SET_ROI_LOCATION]` → `Refused("camera_rejected")`.
  - `caps_change_notifies_the_state_watch`: a receiver taken before binding sees `changed()` resolve at binding even when the state fields are equal.
- [ ] **Step 2:** `cargo test -p rgcs-camera mavlink_cam::driver`. Expected: FAIL.
- [ ] **Step 3: Implement.** Keep `driver.rs` ≤ 400 lines: the request schedule is a pure `fn due_requests(m: &Model, last: &Requests, now_ms) -> (Requests, Vec<MavMessage>)` in `apply.rs`, and it gets its own unit tests: 2 s info cadence; 5 s stream retry; nothing while fresh.
- [ ] **Step 4:** `cargo test -p rgcs-camera` → PASS; `cargo test -p rgcs-camera --features sim`. clippy.
- [ ] **Step 5:** commit `feat(camera): MAVLink camera driver and fake ArduPilot responder`.

### Task 5: Server wiring — build the driver, dynamic caps, no link-up zero

**Files:**
- Modify:
  - `apps/rgcs-server/src/cameras.rs` (`set_mav_port`, `build` arm, `forward` signature, `link_zero`);
  - `apps/rgcs-server/src/app.rs` (`AppState.mav: MavPort`, `with_mav_port`);
  - `apps/rgcs-server/src/main.rs` (`MavPort::new(outgoing_tx.clone(), acks_tx.clone(), payload_tx.clone())`);
  - `apps/rgcs-server/tests/common/mod.rs` (`spawn_app_with_fake_mav(cfg) -> (AxumRouter, AppState, FakeMav)`).
- Create: `apps/rgcs-server/tests/mavlink_camera_flow.rs`.

**Interfaces:**
```rust
// cameras.rs
impl CameraManager { pub fn set_mav_port(&self, port: MavPort); }
async fn forward(sysid: SysId, camera: Arc<dyn Camera>, tx: broadcast::Sender<ServerMessage>);  // caps per frame
// build(): (CameraKind::Mavlink, _) => Arc::new(MavlinkCamera::new(profile.sysid, profile.comp_id, port))
//          where port = the installed MavPort or MavPort::detached()
// link_zero(): returns at once for CameraKind::Mavlink (ruling 10); otherwise re-checks
//              `caps().gimbal.rate` on every connected edge instead of once at spawn
// app.rs
impl AppState { pub fn with_mav_port(self, port: MavPort) -> Self; }  // also cameras.set_mav_port(port)
```

- [ ] **Step 1: Write failing tests.**
  - `cameras.rs` unit: `forward_sends_current_caps`: a fake `Camera` whose `caps()` changes from `none()` to `siyi_mt11()` while the state watch is bumped → two frames, caps `none` then `siyi_mt11`.
  - `mavlink_camera_flow.rs`:
    - `mavlink_profile_builds_the_driver`:
      - `PUT /api/vehicles/1/camera/profile` `{kind: "mavlink", comp_id: 100, host: "192.168.144.30", rtsp_url: "rtsp://192.168.144.30:8554/main"}` → 200;
      - within 3 s, `GET /api/vehicles/1/camera` → `caps.kind == "mavlink"`, `caps.photo == true`, `caps.zoom.unit == "percent"`, `caps.roi == "native"`, `state.connected == true`.
    - `caps_reach_the_websocket`: subscribe to `state.tx` before the PUT → a `camera_state` frame with `caps.photo == false` (before binding) is followed by one with `true`.
    - `photo_goes_out_as_image_start_capture`: `POST …/camera/command {cmd: "photo"}` → 200, `fake.commands().contains(IMAGE_START_CAPTURE)`, audit row `camera` / `photo` / `ok`.
    - `thermal_is_unsupported`: `{cmd: "thermal_gain", args: {gain: "high"}}` → 409 `unsupported_capability`.
    - `rejected_zoom_is_409_camera_rejected`: fake `reject: [SET_CAMERA_ZOOM]` → 409 `camera_rejected`; audit reason `camera_rejected`.
    - `no_link_up_zero_for_mavlink`: 3 s after binding, `fake.sent()` has no `GIMBAL_MANAGER_SET_PITCHYAW`.
    - `ws_gimbal_rate_reaches_the_manager`: WS `{"t":"gimbal_rate","sysid":1,"yaw":50,"pitch":0,"seq":1}` → a `SET_PITCHYAW` with `yaw_rate` 0.7853982.
    - `auto_record_starts_on_arm`: seed armed false → true → `VIDEO_START_CAPTURE` sent.
- [ ] **Step 2:** `cargo test -p rgcs-server --test mavlink_camera_flow`. Expected: FAIL.
- [ ] **Step 3: Implement.** `install` passes `camera.clone()` to `forward`. Existing callers / tests of `forward` are updated.
- [ ] **Step 4:** `cargo test -p rgcs-server` → PASS (`camera_flow`, `roi_flow` and `auto_record_flow` unchanged). clippy.
- [ ] **Step 5:** commit `feat(server): run the MAVLink camera driver on the FC link`.

### Task 6: GPS ROI Native — `DO_SET_ROI_LOCATION` / `ROI_NONE`

**Files:**
- Create:
  - `crates/rgcs-camera/src/roi/native.rs` (pure);
  - `apps/rgcs-server/src/roi_native.rs` (task);
  - `apps/rgcs-server/tests/roi_native_flow.rs`.
- Modify:
  - `crates/rgcs-camera/src/roi/mod.rs`;
  - `apps/rgcs-server/src/roi.rs` (`start` accepts `Computed | Native`; `dispatch(sysid, cmd, spawn: Option<RoiMode>)` spawns `roi_task::run` or `roi_native::run`);
  - `apps/rgcs-server/src/lib.rs` (`mod roi_native;`).

**Interfaces — Produces:**
```rust
// roi/native.rs
pub const NATIVE_RESEND_MS: u64 = 5_000;
#[derive(Debug, Clone, PartialEq)]
pub enum NativeOut { Point { lat: f64, lon: f64, alt_msl: f64 }, Release }
#[derive(Debug, Clone, Default, PartialEq)]
pub struct NativeRoi { target: Option<RoiTarget>, last_sent_ms: Option<u64>, error: Option<&'static str> }
impl NativeRoi {
    pub fn start(&self, target: RoiTarget, now_ms: u64) -> (Self, Vec<NativeOut>);
    pub fn stop(&self) -> (Self, Vec<NativeOut>);                       // Release only when active
    pub fn retarget(&self, targets: &[RoiTarget], now_ms: u64) -> (Self, Vec<NativeOut>);
    pub fn tick(&self, now_ms: u64) -> (Self, Vec<NativeOut>);          // Point every NATIVE_RESEND_MS
    pub fn sent(&self, ok: bool) -> Self;                               // error = send_failed / None
    pub fn is_active(&self) -> bool;
    pub fn status(&self, fix: Option<&VehicleFix>, gimbal: Option<&GimbalAttitude>) -> RoiStatus;
}
// apps/rgcs-server/src/roi_native.rs
pub(crate) async fn run(hub: RoiHub, sysid: SysId, gen: u64, cmds: mpsc::UnboundedReceiver<Cmd>);
```
- The task handles every `Cmd`:
  - `Cmd::Configure` → ack only;
  - `Point` → `camera.roi_location`;
  - `Release` → `camera.roi_none`, retried once on `Err`.
- Each send is bounded by a 2 s timeout, because the ACK wait is 1.5 s. This is longer than `SEND_TIMEOUT` (200 ms): the native call waits for an ACK.
- Ticks run every 500 ms: `tick` plus a status broadcast via `hub.broadcast`. The error comes from `vehicle_fix` (router) + `camera_offline`.
- The task retires through `hub.try_retire` when idle, as `roi_task.rs` does.

- [ ] **Step 1: Write failing tests.**
  - `native.rs`:
    - `start_points_once`: `start(t, 0)` → `[Point{lat: t.lat, lon: t.lon, alt_msl: t.alt_msl}]`;
    - `tick_resends_every_5s`: tick 4 999 → `[]`; tick 5 000 → `[Point]`;
    - `stop_releases_only_when_active`: active → `[Release]`, idle → `[]`;
    - `retarget`: same id with a new lat → `[Point(new)]`; slot unset (name "") → `[Release]` and inactive; untouched → `[]`;
    - `status_geometry`: own (35.0, 139.0, 0, hdg 0), target 1 000 m north at the same alt → `bearing 0 ± 0.01`, `distance 1000 ± 1`, `mode None`, `speed_yaw None`;
    - `status_errors`: no fix → `no_position`; `sent(false)` → `send_failed`.
  - `roi_native_flow.rs` (fake + mavlink profile + `seed_pose(1, 35.0, 139.0, …)` + `PUT roi/targets` with roi_1 at 35.009, 139.0, alt 100):
    - `start_sends_roi_location_with_the_gimbal_id`: `POST /api/vehicles/1/roi/start {id: "roi_1"}` → 200; the fake saw `COMMAND_INT DO_SET_ROI_LOCATION`, `param1 1.0`, `frame MAV_FRAME_GLOBAL`, `x 350_090_000`, `z 100.0`; `roi_status.active_target == "roi_1"` and `mode == null`;
    - `stop_sends_roi_none`: `POST roi/stop` → `{stopped: true}`; the fake saw `DO_SET_ROI_NONE` param1 1.0;
    - `manual_stick_releases_first`: WS gimbal_rate yaw 50 → `DO_SET_ROI_NONE` precedes the first `SET_PITCHYAW` in `fake.sent()`; audit `roi` / `stop` / `manual_input`;
    - `stick_zero_is_dropped_while_active`: WS gimbal_rate (0, 0) → no `SET_PITCHYAW`;
    - `resends_every_5s`: two `DO_SET_ROI_LOCATION` 5 s apart (paused time);
    - `refused_location_reports_send_failed`: `reject: [DO_SET_ROI_LOCATION]` → start 200, `roi_status.error == "send_failed"`, still active;
    - `no_point_location_is_unsupported`: `manager_caps: 32|256` → 409 `unsupported_capability`;
    - `computed_still_works`: the existing `roi_flow` / `roi_runtime` tests pass unchanged.
- [ ] **Step 2:** `cargo test -p rgcs-camera roi::native` and `cargo test -p rgcs-server --test roi_native_flow`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** `cargo test -p rgcs-server` → PASS. clippy.
- [ ] **Step 5:** commit `feat(roi): native GPS ROI through DO_SET_ROI_LOCATION for MAVLink gimbals`.

### Task 7: UI — 接続 tab, status row, zoom %, card rows, ROI tab

**Files:**
- Create: `apps/rgcs-server/ui/src/shared/i18n/mavlinkCamera.ts` (ja / en: `mavlinkCamera` 'MAVLink カメラ', `compId` 'コンポーネント ID', `rtspUrl` 'RTSP URL', `camErr_camera_rejected` 'カメラがコマンドを拒否しました', `roiNativeNote` 'ArduPilot がジンバルを目標に向けます'); spread into `shared/i18n/index.ts` like `cameraMedia`.
- Modify:
  - `features/camera-settings/ConnectionTab.tsx` (enable `mavlink`; MAVLink rows; `MavlinkStatusBox`);
  - `features/camera-settings/schema.ts` (`comp_id` 1–255; `hostFromRtsp`);
  - `features/camera/CameraStatusRow.tsx`;
  - `features/camera/format.ts` (`zoomText(zoom, unit = 'times')`);
  - `features/camera/CameraStrip.tsx`;
  - `features/video/CamBar.tsx` + `cockpitView.ts` (`zoomToPos` / `posToZoom` take `unit`; Percent is linear);
  - `features/video/CamCard.tsx`;
  - `features/map/markers.ts` (zoom 1 for Percent);
  - `features/roi/RoiTab.tsx` (hide `RoiControlForm` for `native`, show `roiNativeNote`);
  - `features/camera-settings/CameraSettingsSheet.tsx` (pass `caps.roi` to `RoiTab`).

**Interfaces:**
```ts
// schema.ts
export function hostFromRtsp(url: string): string | null   // IPv4 literal host or null
// format.ts
export function zoomText(zoom: number, unit: ZoomUnit = 'times'): string  // '40%' | '1.5×'
// cockpitView.ts
export function zoomToPos(zoom: number, max: number, unit: ZoomUnit = 'times'): number
export function posToZoom(pos: number, max: number, unit: ZoomUnit = 'times'): number
```

- [ ] **Step 1: Write failing tests.**
  - `ConnectionTab` (in `CameraSettingsSheet.test.tsx`):
    - the `MAVLink カメラ` option is enabled;
    - choosing it shows `コンポーネント ID` (value 100) and `RTSP URL` inputs, and no IP / 制御ポート / 映像ソース;
    - typing `rtsp://192.168.144.30:8554/main` sets the saved draft `host` to `192.168.144.30` and `rtsp_url` to that URL;
    - the status box shows 接続中 and `cam 1.2.3`, and no SD / カメラ時刻 rows.
  - `schema.test.ts`:
    - `comp_id` 0 and 256 → issue path `comp_id`; 154 → ok;
    - `hostFromRtsp('rtsp://10.0.0.5:554/x') === '10.0.0.5'`; `'rtsp://cam.local/x'` → null;
    - a MAVLink draft whose host cannot be derived → issue path `rtsp_url`.
  - `CameraStatusRow.test.tsx`: mavlink caps + gimbal `{yaw: 0, pitch: −20}` → text `MAVLink カメラ`, `↔ 0.0°`, `↕ −20.0°`, and no `Follow` / `—` mode cell.
  - `format.test.ts`: `zoomText(40, 'percent') === '40%'`; `zoomText(1.5) === '1.5×'`.
  - `cockpitView.test.ts`: `zoomToPos(50, 100, 'percent') === ZOOM_SLIDER_MAX / 2`; `posToZoom(ZOOM_SLIDER_MAX, 100, 'percent') === 100`.
  - `Cockpit.test.tsx`:
    - mavlink caps (photo, record, zoom percent, gimbal, no thermal / ai / storage / clock) → card rows ジンバル and 映像 only (no サーマル / SD カード / カメラ時刻 / ROI-control);
    - the zoom value reads `40%`;
    - releasing the slider at the middle sends `{cmd: 'zoom_absolute', args: {zoom: 50}}`.
  - `markers.test.ts`: a Percent camera with `zoom 80` → `hfov === DEFAULT_HFOV_DEG` (zoom treated as 1).
  - `RoiTab.test.tsx`: `roiMode 'native'` → no 制御モード field, and `roiNativeNote` shown; `'computed'` → the form is shown.
  - `CameraStrip.test.tsx`: mavlink caps → record, photo, `− 40% +` and gear only; no video-type segment.
- [ ] **Step 2:** `npx vitest run src/features/camera src/features/camera-settings src/features/video src/features/map src/features/roi`. Expected: FAIL.
- [ ] **Step 3: Implement.** Reuse the existing classes (`.form`, `.in`, `.inset .kv`, `.cam-status`, `.sep`, `.zstep`). No CSS edits.
- [ ] **Step 4:** the same vitest run → PASS; `npx tsc --noEmit -p tsconfig.app.json`; `npm run lint`.
- [ ] **Step 5:** commit `feat(ui): MAVLink camera settings, status row and percent zoom`.

### Task 8: Docs, full checks, live check on a scratch SITL

**Files:**
- Modify:
  - `docs/spec/40-camera-gimbal.md`:
    - §1.1 `ZoomCaps.unit`;
    - §1 trait `roi_location` / `roi_none`;
    - §2 `mavlink_cam` row: binding (ruling 2), percent zoom (3, 4), yaw sign (5), modes / centre (6), ACKs (7), the MediaMTX note (13);
    - §4 a "Native (2026-10-23)" paragraph (ruling 8);
    - §7.1 MAVLink カメラ moves to 実装済み;
    - §8 the live-check line.
  - `docs/spec/10-screens.md`:
    - §3.3 item 4 (「MAVLink カメラ | ↔ ↕」);
    - §4.2 acceptance reading (ruling 16);
    - §5 MAVLink 接続 rows + host from RTSP (ruling 13);
    - the ROI tab note for Native.
  - `docs/spec/50-api.md`:
    - §1 `camera_rejected`;
    - §2.3 `roi/start` accepts `computed | native`, and the `camera/command` ACK semantics.
  - `docs/spec/60-data-model.md` §3.3: `comp_id` meaning (ruling 2).

- [ ] **Step 1: Docs** as listed.
- [ ] **Step 2: Full checks.**
  - `cargo test --workspace`.
  - `cargo clippy --workspace --all-targets -- -D warnings`.
  - `npx tsc --noEmit -p tsconfig.app.json`.
  - `npx vitest run`.
- [ ] **Step 3: Live check on a scratch stack only.**
  - **Hard rules.**
    - Never touch ports 5760-5793 / 8000 / 5173 / 14550 / 14551 / 37260 or the dev SITL's params.
    - Record every PID with `$!` and stop only those PIDs.
    - Work in a fresh scratchpad directory `$S`: SITL writes `eeprom.bin` to its cwd, so the scratch params stay there.
  1. Check the SITL has the gimbal sim: `strings ~/github/rtos/ardupilot-latest/build/sitl/bin/arducopter | grep -c siyi_zt30` ≥ 1.
     - If 0, use the servo fallback in `$S/mount.parm`: `MNT1_TYPE 1`, `MNT1_PITCH_MIN -90`, `MNT1_PITCH_MAX 30`, `SERVO6_FUNCTION 7`, `SERVO7_FUNCTION 6`, `CAM1_TYPE 1`. That fallback has photo only, no zoom.
  2. `$S/mount.parm`: `MNT1_TYPE 8`, `CAM1_TYPE 4`, `SERIAL5_PROTOCOL 8`.
     - From `$S` (cwd), with `run_in_background`: `~/github/rtos/ardupilot-latest/build/sitl/bin/arducopter --model + --speedup 1 --defaults ~/github/rtos/ardupilot-latest/Tools/autotest/default_params/copter.parm,$S/mount.parm --home 36.2509,137.6385,1505,0 -I6 --serial5=sim:siyi_zt30: -w`.
     - Record the PID. It listens on tcp:5820.
  3. Scratch `$S/config.toml`:
     - `listen = "127.0.0.1:8120"`;
     - `mavlink_url = "tcp:127.0.0.1:5820"`;
     - `data_dir = "$S/data"`;
     - `ui_dir` = a fresh `npm run build` output.
     - Start `RGCS_CONFIG=$S/config.toml ./target/debug/rgcs-server` and record its PID.
  4. Log in (`admin` / `admin`, header `X-Requested-With: rgcs`). Then `PUT /api/vehicles/1/camera/profile {kind: "mavlink", comp_id: 100, host: "127.0.0.1", rtsp_url: "rtsp://127.0.0.1:8554/none"}`. Expected within 20 s, with streams after the SITL grace:
     - `GET /api/vehicles/1/camera` → `kind mavlink`, `photo`, `record`, `focus`, `zoom.unit percent`, `gimbal.pitch_range` from the mount params, `roi native`, `connected true`, firmware `1.2.3`;
     - UI on :8120:
       - the status row reads 「MAVLink カメラ | ↔ 0.0° ↕ …」;
       - the camera strip shows record / photo / `− 0% +` / gear;
       - the 接続 tab shows the MAVLink rows and 接続中;
     - zoom: `+` twice → `CAMERA_SETTINGS.zoomLevel` 20 in the inspector, and the strip shows `20%`;
     - photo → inspector TX `COMMAND_LONG 2000` to compid 1 and RX `COMMAND_ACK` ACCEPTED;
     - `gimbal_angle {yaw_deg: 30, pitch_deg: −20}` → the status row shows ↔ 30.0° ↕ −20.0° (left 30°), and the map fan points 30° left of the nose;
     - ROI:
       - set roi_1 200 m east of home at 1505 m MSL and start it;
       - inspector TX `COMMAND_INT 195` with `param1 1`;
       - the status row shows ↔ −90.0° (target to the right), and the fan points east;
       - **the copter's heading stays unchanged**;
       - roi stop → TX `COMMAND_LONG 197`.
  5. Do not arm the scratch SITL. Stop the server PID and the SITL PID (`kill <pid>`), then delete `$S`.
- [ ] **Step 4:** commit `docs: MAVLink camera driver and native ROI implemented`.

## Out of scope
- More than one camera / gimbal per vehicle (CAM2 / MNT2, `camera_device_id` ≥ 2). MAVLink gimbal v2 devices that need a separate manager on the GCS side.
- MediaMTX path registration from the profile (the `mt11` path stays static; MediaMTX `api: no`).
- Camera definition files (`cam_definition_uri`), camera modes, image interval / survey modes, `STORAGE_INFORMATION`, `VIDEO_STREAM_INFORMATION`, `CAMERA_TRACK_*`, thermal range.
- Gimbal lock / follow modes, retract, earth-frame yaw lock, primary-control negotiation (`GIMBAL_MANAGER_SET_ATTITUDE`, `MAV_CMD_DO_GIMBAL_MANAGER_CONFIGURE`).
- Joystick zoom axes (`zoom_abs` / `zoom_speed` / `zoom_step`, still unimplemented for MT11 too).
- Android video source.
