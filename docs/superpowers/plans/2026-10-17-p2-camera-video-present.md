# P2 — Camera, video and the audience view Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The operator sees the MT11 video and a camera strip in the detail panel, drives the gimbal with a gamepad and the strip (zoom / record / photo / video type / center / mode), and a token-protected `/present` page shows video + mini-map + logo that keeps playing whatever the operator does.

**Architecture:** Three new crates mirror spec 30 §2: `rgcs-camera` (SIYI frame codec and tokio client ported from the Python app with its golden tests, a `Camera` trait, a `none` driver, and an MT11 simulator for tests), `rgcs-video` (RTSP DESCRIBE probe, source monitor, WHEP relay to MediaMTX) and `rgcs-input` (pure gate: rate limit, range check, deadman). `rgcs-server` owns a `CameraManager` (one driver per sysid from `camera_profiles`), broadcasts `camera_state` / `video_source` / `input_state`, relays WHEP and serves the audience endpoints under `/present/*` guarded by a presentation token instead of a session. The UI adds `features/camera`, `features/camera-settings`, `features/gimbal-joystick`, `shared/video/whep.ts` and a second root `PresentApp` chosen by pathname before the auth gate.

**Tech Stack:** Rust stable (tokio, axum 0.8, sqlx SQLite, `reqwest` for the WHEP upstream), React 19 + TypeScript + Vite, maplibre-gl 5, WebRTC WHEP in the browser, MediaMTX (pass-through; dev: `brew install mediamtx` + ffmpeg `testsrc`), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-17-year-end-demo-design.md` §2 (anti-goal: the audience video never stops), §5.1, §5.3, §7-1; `docs/spec/40-camera-gimbal.md` §1–3, §6, §7; `docs/spec/10-screens.md` §3.3 items 2–4, §5 (接続 / 操作 tabs only); `docs/spec/30-architecture.md` §3, §5, §6; `docs/spec/50-api.md` §2.3, §2.4, §3; `docs/spec/60-data-model.md` §3.3; `docs/spec/70-safety-auth.md` §2, §3. Python reference: `~/github/rtos/siyi-mt11-cameracontrol/app/camera_protocol.py`, `tests/test_camera_protocol.py`, `app/static/app.js` (`processAxes`, `handleButtonPress`), `app/video_probe.py`, `deploy/mediamtx.yml`.

## Global Constraints

- Everything in the P1 plan's Global Constraints still applies (immutability, file/function size, TDD, `cargo fmt/clippy -D warnings/test`, `npm run lint/typecheck/test`, ts-rs regeneration, design tokens, CSRF header, dev stack via `scripts/dev.sh`).
- Python tests are the oracle: every `tests/test_camera_protocol.py` case that touches a P2 command is copied 1:1 as a Rust `#[test]` and watched fail first (spec 40 §7).
- SIYI wire format (40 §3): `55 66 | ctrl(1) | len(2 LE) | seq(2 LE) | cmd(1) | data | crc16(2 LE)`, CRC-16/CCITT poly 0x1021 init 0 over everything before the CRC. `0x48` is refused at the lowest send layer of both TCP and UDP (`CameraError::Forbidden`).
- MT11 caps (40 §2): zoom max 165, pitch range (−90, 30), modes Lock/Follow/FPV, video modes Rgb/Thermal/SideBySide, roi Computed. TCP + UDP port 37260, heartbeat `0x00` with data `00` every 1 s, reconnect 1 s after a drop.
- Video type codes (40 §3): rgb = (0,2), thermal = (2,0), side_by_side = (3,2); replies (1,2) → rgb, (2,1) → thermal, (4,2) → side_by_side; anything else → `custom`.
- Input safety (70 §2): `gimbal_rate` ≤ 20 Hz from the browser, server drops above 25 Hz, |value| > 100 → `error` and ignored; `input_hb` 1 Hz, 1.5 s silence → rate 0 + `input_state: lost`; `select` sends 0 to the previous target first; the browser sends 0 and stops on `visibilitychange` hidden.
- Joystick (40 §6): yaw = pan × max_pan_speed (default 30), pitch = tilt × max_tilt_speed (default 20); send only non-zero, one zero when returning to zero; axis deadzone 0–0.5, invert, scale 0.1–2.
- Camera safety (70 §3): a command not in `caps` → `409 unsupported_capability`; `GimbalRate` over REST → `409 ws_only`.
- Video (30 §5): no transcoding; MediaMTX WHEP upstream default `http://127.0.0.1:8889/mt11/whep`; the relay forwards the SDP body (≤ 64 KB, `application/sdp`) and returns the answer with status 201; the browser gathers ICE candidates before posting (no trickle, no PATCH).
- Audience page (addendum §5.1): video + mini-map + logo only, read-only, no session, token `t=` (32 hex, revocable), separate WHEP session, last frame held on loss with a small "再接続中" badge, logo PNG/SVG ≤ 1 MB stored under `data_dir/branding/`.
- Deferred by the addendum, not in this plan: thermal temperatures, AI tracking, ROI, encoding presets, SD / clock sync, auto-record, Android source, the cockpit view (10 §4.2), the video grid (10 §4.1), ROI / 映像 tabs of the settings sheet, MAVLink camera driver.

## Review Focus

1. **Camera power-cycled mid-session** — `connected` must turn false within 2 s of the TCP drop, the strip shows 切断, and the client reconnects by itself ~1 s after the camera is back; queued gimbal rates during the outage are dropped, not replayed. Test in Task 3 (`client.rs`: `reconnects_after_the_sim_restarts` using the simulator).
2. **Gamepad unplugged while the stick is deflected** — the server deadman sends rate 0 within 1.5 s and the UI sends one 0 on `gamepaddisconnected`. Tests in Task 6 (`gate.rs: hb_silence_sends_zero_once`) and Task 8 (`loop.test.ts: disconnect sends zero and stops`).
3. **Revoked or wrong token on `/present`** — a neutral "無効なリンク" screen, never the login form, and no request loop. Test in Task 12 (`PresentApp.test.tsx: invalid token renders the notice and stops polling`).
4. **MediaMTX unreachable while `/present` is open** — the last frame stays on screen, the badge appears after 1 s, reconnection succeeds later without a reload. Test in Task 7 (`whep.test.ts: upstream failure keeps the stream element and schedules a retry`).
5. **Record button double-click** — `RecordStart` while already recording is a no-op on the wire and the UI disables the button until the next `camera_state`. Tests in Task 3 (`client.rs: record_start_is_idempotent`) and Task 9 (`CameraStrip.test.tsx: record toggle is disabled while pending`).

---

### Task 1: Camera domain types in `rgcs-core`

**Files:**
- Create: `crates/rgcs-core/src/camera.rs`
- Modify: `crates/rgcs-core/src/lib.rs` (export), `crates/rgcs-core/src/ws.rs` (new frames), `apps/rgcs-server/ui/src/shared/api/types.ts` (re-exports after regeneration)

**Interfaces:**
- Produces (all `Serialize, Deserialize, TS, Clone, PartialEq`; enums `rename_all = "snake_case"`):
  - `enum CameraKind { None, Mavlink, SiyiMt11 }`
  - `enum VideoMode { Rgb, Thermal, SideBySide }`, `enum GimbalMode { Lock, Follow, Fpv }`, `enum CenterMode { OneKeyReset, CenterFaceDown, Center, FaceDown }`
  - `struct GimbalCaps { rate: bool, angle: bool, center: bool, modes: Vec<GimbalMode>, attitude: bool, pitch_range: (f32, f32) }`
  - `struct ZoomCaps { max: f32, absolute: bool, step: bool, continuous: bool }`
  - `struct CameraCaps { kind: CameraKind, gimbal: Option<GimbalCaps>, zoom: Option<ZoomCaps>, focus: bool, photo: bool, record: bool, video_modes: Vec<VideoMode> }` with `CameraCaps::none()` and `CameraCaps::siyi_mt11()` (values from Global Constraints) and `fn supports(&self, cmd: &CameraCommand) -> bool`.
  - `#[serde(tag = "cmd", content = "args")] enum CameraCommand { GimbalRate { yaw: i8, pitch: i8 }, GimbalAngle { yaw_deg: f32, pitch_deg: f32 }, GimbalCenter { mode: CenterMode }, GimbalMode { mode: GimbalMode }, ZoomAbsolute { zoom: f32 }, ZoomStep { steps: i8 }, ZoomSpeed { dir: i8 }, ZoomReset, Focus { dir: i8 }, Photo, RecordStart, RecordStop, VideoMode { mode: VideoMode } }` and `fn name(&self) -> &'static str` (snake_case tag).
  - `enum RecordingState { Idle, Recording, NoCard, CardError }`
  - `struct GimbalAttitude { yaw: f32, pitch: f32, roll: f32, #[ts(type="number")] age_ms: u64 }`
  - `struct Firmware { camera: String, gimbal: String, zoom: String }`
  - `struct CameraState { connected: bool, last_error: Option<String>, firmware: Option<Firmware>, recording: RecordingState, zoom: f32, zoom_max: f32, video_mode: Option<VideoMode>, gimbal: Option<GimbalAttitude>, gimbal_mode: Option<GimbalMode>, stream: Option<(u16, u16)> }` with `CameraState::disconnected(zoom_max: f32)`.
  - `struct CameraSnapshot { sysid: SysId, caps: CameraCaps, state: CameraState }`
  - `enum VideoSource { Mt11, None }`, `enum VideoSourceMode { Auto, Mt11 }`, `struct VideoSourceStatus { mode: VideoSourceMode, source: VideoSource, scanning: bool, probe_ok: bool, whep_path: String }`
  - `enum Deadman { Ok, Lost }`
  - `ServerMessage` gains `CameraState { sysid, state: CameraState }`, `VideoSource { sysid, status: VideoSourceStatus }`, `InputState { deadman: Deadman }`; `Snapshot` gains `cameras: Vec<CameraSnapshot>`.

- [ ] **Step 1: Failing tests in `camera.rs`** — `siyi_caps_match_spec` (zoom.max 165, pitch_range (−90, 30), modes [Lock, Follow, Fpv], video_modes [Rgb, Thermal, SideBySide], photo && record, roi not modelled); `none_caps_support_nothing` (`supports` false for every variant); `supports_checks_the_right_cap` (ZoomSpeed needs `zoom.continuous`, GimbalCenter needs `gimbal.center`, VideoMode needs the mode listed); `command_json_shape` (`{"cmd":"gimbal_rate","args":{"yaw":10,"pitch":-5}}` round-trips; `{"cmd":"photo"}`).
- [ ] **Step 2: Run** `cargo test -p rgcs-core camera` → FAIL (module missing).
- [ ] **Step 3: Implement `camera.rs`, wire `ws.rs` + `lib.rs`.** Existing `ws.rs` tests must still pass; update the `snapshot` test fixture with `cameras: vec![]`.
- [ ] **Step 4: Run** `cargo test -p rgcs-core` → PASS; bindings regenerated under `ui/src/shared/api/generated/` (`CameraCaps.ts`, `CameraCommand.ts`, `CameraState.ts`, `CameraSnapshot.ts`, `VideoSourceStatus.ts`, `Deadman.ts`, …); add re-exports to `types.ts`; `npm run typecheck` still green (fix `App.test.tsx` snapshot fixtures: `cameras: []`).
- [ ] **Step 5: Commit** — `feat(core): camera caps / command / state types and camera_state, video_source, input_state frames`.

---

### Task 2: `rgcs-camera` crate — SIYI frame codec and parsers (golden-tested)

**Files:**
- Create: `crates/rgcs-camera/Cargo.toml` (deps: rgcs-core, tokio, thiserror, tracing, serde; dev: tokio test-util), `src/lib.rs`, `src/error.rs`, `src/siyi/mod.rs`, `src/siyi/frame.rs`, `src/siyi/encode.rs`, `src/siyi/parse.rs`
- Modify: root `Cargo.toml` members + `[workspace.dependencies] rgcs-camera`

**Interfaces:**
- Produces: `pub enum CameraError { Forbidden(u8), Unsupported(&'static str), NotConnected, Io(String), Protocol(String) }`.
- `frame.rs`: `pub fn crc16_ccitt(data: &[u8]) -> u16`; `pub fn make_packet(cmd: u8, data: &[u8], ctrl: u8, seq: u16) -> Vec<u8>`; `pub const FORBIDDEN_CMDS: &[u8] = &[0x48]`; `pub fn check_allowed(cmd: u8) -> Result<(), CameraError>`; `pub struct Frame { pub cmd: u8, pub payload: Vec<u8> }`; `pub struct Parser { buf: Vec<u8> }` with `pub fn push(&mut self, bytes: &[u8]) -> Vec<Frame>` (sync to `55 66`, wait for `10 + len`, drop on CRC mismatch, keep going).
- `encode.rs` (pure, return the `data` bytes; the client wraps them): `heartbeat() -> [u8;1]` (`00`); `gimbal_rate(yaw: i8, pitch: i8) -> [u8;2]`; `gimbal_angle(yaw_deg: f32, pitch_deg: f32) -> [u8;4]` (×10, i16 LE, pitch clamped −90..30); `center(mode: CenterMode) -> [u8;1]` (1..4); `gimbal_mode(mode: GimbalMode) -> [u8;1]` (Lock 3, Follow 4, Fpv 5 — CMD 0x0C); `photo() -> [u8;1]` (0x0C func 0); `record_toggle() -> [u8;1]` (0x0C func 2); `zoom_absolute(zoom: f32, max: f32) -> [u8;2]` (int, tenths; 9.96 → (10,0)); `zoom_speed(dir: i8) -> [u8;1]` (0x05: 1 in, 0 stop, −1 → 0xFF); `focus(dir: i8) -> [u8;1]` (0x06); `video_mode(mode: VideoMode) -> [u8;2]`.
- `parse.rs`: `firmware(payload) -> Option<Firmware>` (12 bytes; each u32 LE → `v{major}.{minor}.{patch}` from bytes [2],[1],[0]); `attitude(payload) -> Option<(f32,f32,f32)>` (6 × i16 LE ÷ 10: yaw, pitch, roll); `zoom(payload) -> Option<f32>` (int + tenths); `video_mode(payload) -> Option<VideoMode>` or `Err(custom)` → use `enum VideoModeReply { Known(VideoMode), Custom(u8,u8) }`; `record_status(payload) -> Option<RecordingState>` (0x0A data[3]: 0 Idle, 1 Recording, 2 NoCard, 3 CardError); `record_feedback(payload) -> Option<RecordingState>` (0x0B: 5 → Recording, 6 → Idle, else None); `gimbal_mode(payload) -> Option<GimbalMode>` (0x19: 0 Lock, 1 Follow, 2 Fpv).

- [ ] **Step 1: Golden tests (from the Python suite), all failing:**

```rust
// frame.rs
#[test] fn packet_matches_sdk_example_yaw30_pitch20() { assert_eq!(make_packet(0x0E, &gimbal_angle(30.0, 20.0), 1, 0), hex("55 66 01 04 00 00 00 0E 2C 01 C8 00 59 17")); }
#[test] fn packet_matches_sdk_example_yaw0_pitch_minus90() { /* "55 66 01 04 00 00 00 0E 00 00 7C FC 4F A4" */ }
#[test] fn parser_splits_two_frames_and_skips_garbage() { /* b"zz" + packet(0x5F,[5,0,1,2],seq1) + packet(0x5F,[5,0],seq2) → 2 frames, payload lens 4 and 2 */ }
#[test] fn parser_drops_bad_crc_and_resyncs() { /* flip one byte of frame 1, frame 2 intact → 1 frame */ }
#[test] fn parser_waits_for_a_partial_frame() { /* first 7 bytes → 0 frames; rest → 1 */ }
#[test] fn format_sd_is_refused() { assert_eq!(check_allowed(0x48), Err(CameraError::Forbidden(0x48))); assert!(check_allowed(0x49).is_ok()); }
// encode.rs
#[test] fn gimbal_angle_rounds_to_tenths_and_clamps() { assert_eq!(gimbal_angle(60.54, 0.0), [0x5D,0x02,0,0]); assert_eq!(gimbal_angle(0.0,45.0), gimbal_angle(0.0,30.0)); assert_eq!(gimbal_angle(0.0,-120.0), gimbal_angle(0.0,-90.0)); }
#[test] fn gimbal_mode_bytes() { assert_eq!(gimbal_mode(GimbalMode::Follow), [0x04]); assert_eq!(gimbal_mode(GimbalMode::Fpv), [0x05]); assert_eq!(gimbal_mode(GimbalMode::Lock), [0x03]); }
#[test] fn zoom_absolute_int_and_tenths() { assert_eq!(zoom_absolute(2.5,165.0), [2,5]); assert_eq!(zoom_absolute(9.96,165.0), [10,0]); assert_eq!(zoom_absolute(0.2,165.0), [1,0]); assert_eq!(zoom_absolute(999.0,165.0), [165,0]); }
#[test] fn video_mode_pairs() { assert_eq!(video_mode(VideoMode::Rgb), [0,2]); assert_eq!(video_mode(VideoMode::Thermal), [2,0]); assert_eq!(video_mode(VideoMode::SideBySide), [3,2]); }
#[test] fn gimbal_rate_clamps_to_i8_range() { assert_eq!(gimbal_rate(100,-100), [100u8 as u8, 0x9C]); }
// parse.rs
#[test] fn firmware_sdk_example() { let p=[0x01,0x00,0x01,0x89,0x0A,0x01,0x00,0x8A,0,0,0,0]; assert_eq!(firmware(&p), Some(Firmware{camera:"v1.0.1".into(), gimbal:"v0.1.10".into(), zoom:"v0.0.0".into()})); assert_eq!(firmware(&[1,2]), None); }
#[test] fn attitude_tenths() { /* <hhhhhh 905,-300,5,0,0,0> → (90.5,-30.0,0.5); 2 bytes → None */ }
#[test] fn zoom_reply() { assert_eq!(zoom(&[2,5]), Some(2.5)); }
#[test] fn video_mode_replies() { /* (0,2)/(1,2) → Rgb, (2,0)/(2,1) → Thermal, (3,2)/(4,2) → SideBySide, (9,9) → Custom */ }
#[test] fn record_status_and_feedback() { assert_eq!(record_status(&[0,0,0,1]), Some(RecordingState::Recording)); assert_eq!(record_status(&[0,0,0,2]), Some(RecordingState::NoCard)); assert_eq!(record_feedback(&[5]), Some(RecordingState::Recording)); assert_eq!(record_feedback(&[6]), Some(RecordingState::Idle)); assert_eq!(record_feedback(&[1]), None); }
#[test] fn gimbal_mode_replies() { /* 0 Lock, 1 Follow, 2 Fpv, 7 None */ }
```

- [ ] **Step 2: Run** `cargo test -p rgcs-camera` → FAIL to compile (crate empty).
- [ ] **Step 3: Implement `frame.rs`, `encode.rs`, `parse.rs`** (each ≤ 200 lines).
- [ ] **Step 4: Run** `cargo test -p rgcs-camera` → all PASS.
- [ ] **Step 5: Commit** — `feat(camera): SIYI frame codec, encoders and parsers ported with the Python golden tests`.

---

### Task 3: `rgcs-camera` — `Camera` trait, MT11 tokio client, `none` driver, simulator

**Files:**
- Create: `crates/rgcs-camera/src/camera.rs` (trait + handle), `src/none.rs`, `src/siyi/client.rs`, `src/siyi/sim.rs` (feature `sim`, also `cfg(test)`), `crates/rgcs-camera/examples/siyi_sim.rs`
- Modify: `crates/rgcs-camera/Cargo.toml` (`[features] sim = []`, `[[example]] siyi_sim required-features = ["sim"]`)

**Interfaces:**
- Produces: `#[async_trait] pub trait Camera: Send + Sync { fn caps(&self) -> CameraCaps; async fn send(&self, cmd: CameraCommand) -> Result<(), CameraError>; fn state(&self) -> watch::Receiver<CameraState>; async fn connect(&self) -> Result<(), CameraError>; async fn disconnect(&self); }` (use the `async-trait` crate).
- `pub struct NoneCamera;` — caps `none()`, `send` → `Unsupported`, state constant `disconnected(0.0)`.
- `pub struct SiyiMt11 { .. }` with `SiyiMt11::new(host: Ipv4Addr, port: u16) -> Self`; `connect()` spawns: reader task (TCP, `Parser`, updates `watch`), heartbeat task (0x00 every 1 s; on send error → `connected=false`, reconnect after 1 s), poll task (0x0A and 0x0D every 1 s; 0x01, 0x18, 0x10, 0x19 right after each (re)connect); UDP socket for `0x07`, `0x08`, `0x0E`. `send()` maps: `GimbalRate` → UDP 0x07; `GimbalAngle` → UDP 0x0E; `GimbalCenter` → UDP 0x08; `GimbalMode` → TCP 0x0C then request 0x19; `ZoomAbsolute`/`ZoomStep`/`ZoomReset` → TCP 0x0F then request 0x18 (ZoomStep uses `state.zoom ± steps`, ZoomReset → 1.0); `ZoomSpeed` → 0x05; `Focus` → 0x06; `Photo` → 0x0C func 0; `RecordStart`/`RecordStop` → 0x0C func 2 only when `state.recording` differs (idempotent), then request 0x0A; `VideoMode` → 0x11 then request 0x10. Sequence numbers increment per packet. Sends while disconnected return `NotConnected` immediately (no queueing).
- `sim.rs`: `pub struct SimServer { pub addr: SocketAddr, pub received: mpsc::UnboundedReceiver<(Transport, u8, Vec<u8>)> }` with `SimServer::start() -> SimServer` (TCP + UDP on an ephemeral port, same number for both) and `SimServer::stop()`; replies: 0x01 → SDK firmware example; 0x0A → `[0,0,0,record_sta]`; 0x0C func 2 toggles `record_sta` and replies 0x0B 5/6; 0x18 → current zoom (set by 0x0F); 0x10/0x11 → current pair; 0x19 → current mode (set by 0x0C 3/4/5); 0x0D → `[905,-300,5,0,0,0]`; 0x00 → nothing. `enum Transport { Tcp, Udp }`.
- `examples/siyi_sim.rs`: `cargo run -p rgcs-camera --features sim --example siyi_sim -- --port 37260` runs the simulator forever and logs every frame (used by `scripts/dev.sh --siyi-sim`).

- [ ] **Step 1: Failing tests in `client.rs`** (tokio, simulator):
  - `connect_requests_firmware_zoom_mode_and_reports_connected` — after `connect()`, `state().changed()` yields `connected == true`, `firmware == Some(v1.0.1/v0.1.10/v0.0.0)`, `zoom_max == 165.0`; sim received `[0x01, 0x18, 0x10, 0x19]` in any order within 1 s.
  - `gimbal_rate_goes_over_udp_and_center_too` — `send(GimbalRate{yaw:30,pitch:-10})` → sim received `(Udp, 0x07, [30, 0xF6])`; `GimbalCenter{mode: OneKeyReset}` → `(Udp, 0x08, [1])`.
  - `zoom_step_uses_current_zoom_then_rereads` — state zoom 2.0 (sim) → `ZoomStep{steps:1}` → `(Tcp, 0x0F, [3,0])` then `(Tcp, 0x18, [])`, and state.zoom becomes 3.0.
  - `record_start_is_idempotent` — `RecordStart` twice while sim reports recording after the first → exactly one `0x0C [2]` on the wire (Review Focus 5).
  - `video_mode_switch_rereads_mode` — `VideoMode{mode: Thermal}` → `(Tcp,0x11,[2,0])` then `(Tcp,0x10,[])` and state.video_mode == Some(Thermal).
  - `reconnects_after_the_sim_restarts` — stop the sim: within 2 s `connected == false` and `send(GimbalRate..)` returns `Err(NotConnected)`; start a new sim on the same port: within 2 s `connected == true` again (Review Focus 1). Use `tokio::time::pause` where the client's timers allow; otherwise real time with ≤ 3 s budget.
  - `format_sd_can_never_be_sent` — no `CameraCommand` maps to 0x48; a direct `raw_send(0x48)` test hook returns `Forbidden`.
  - `none_camera_rejects_everything`.
- [ ] **Step 2: Run** → FAIL (types missing).
- [ ] **Step 3: Implement `camera.rs`, `none.rs`, `client.rs` (split into `client.rs` ≤ 400 lines + `io.rs` for the socket tasks if needed), `sim.rs`, the example.**
- [ ] **Step 4: Run** `cargo test -p rgcs-camera --features sim` → PASS; `cargo clippy --workspace --all-targets --all-features -- -D warnings` clean.
- [ ] **Step 5: Commit** — `feat(camera): Camera trait, SIYI MT11 tokio client (gimbal / zoom / record / photo / video mode / mode / center) and simulator`.

---

### Task 4: Camera profiles in the store + `CameraManager` + camera REST + `camera_state` frames

**Files:**
- Create: `crates/rgcs-store/migrations/0002_camera.sql` (`camera_profiles` exactly as 60 §3.3; `gimbal_input_profile(id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL, updated_at TEXT NOT NULL)`; `presentation_tokens(token TEXT PRIMARY KEY, label TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, revoked_at TEXT)`), `crates/rgcs-store/src/camera_profiles.rs`
- Create: `apps/rgcs-server/src/cameras.rs` (manager), `apps/rgcs-server/src/camera_api.rs` (handlers), `apps/rgcs-server/tests/camera_flow.rs`
- Modify: `apps/rgcs-server/src/app.rs` (state field `cameras: CameraManager`, routes), `src/ws.rs` (snapshot includes cameras), `src/main.rs`, `tests/common/mod.rs` (`spawn_app` builds a manager with `CameraFactory::Sim(addr)` when a `SimServer` is passed)

**Interfaces:**
- Store: `struct CameraProfile { sysid: SysId, kind: CameraKind, host: String, port: u16, rtsp_url: String, comp_id: u8, video_source_mode: VideoSourceMode, android_url: String, encoding_preset: String, thermal_palette: u8, thermal_overlay: bool, ai_box_px: u16, clock_sync: bool, auto_record: bool }` (`TS`, defaults from 60 §3.3 via `CameraProfile::default_for(sysid)`); `Store::camera_profile(sysid) -> Result<CameraProfile>` (default when absent); `Store::put_camera_profile(&CameraProfile) -> Result<()>`; `impl TryFrom<CameraProfileInput> for CameraProfile` validating host IPv4, port 1..=65535, `rtsp_url` starts with `rtsp://`, `ai_box_px` 32..=600, `thermal_palette ∈ {0, 2..=11}`.
- Manager: `pub struct CameraManager { .. }` (`Clone`); `CameraManager::new(store: Store, tx: broadcast::Sender<ServerMessage>, factory: CameraFactory)`; `enum CameraFactory { Real, Sim(SocketAddr) }` (Sim ignores host/port and connects to the simulator — tests only, behind `cfg(any(test, feature = "sim"))` in the server too); `async fn ensure(&self, sysid) -> CameraHandle` (spawns the driver from the profile on first use; a `watch` forwarder broadcasts `ServerMessage::CameraState` on every change and at least every 1 s); `async fn reload(&self, sysid)` (disconnect + respawn after a profile PUT); `fn snapshot(&self) -> Vec<CameraSnapshot>`; `async fn send(&self, sysid, cmd: CameraCommand) -> Result<(), CameraError>` (checks `caps.supports(&cmd)` first → `Unsupported`).
- REST (50 §2.3): `GET /api/vehicles/{sysid}/camera` → `{caps, state}`; `POST /api/vehicles/{sysid}/camera/command` body `CameraCommand` → `200 {}`; `GimbalRate` → `409 ws_only`; unsupported → `409 unsupported_capability`; not connected → `503 camera_offline`; audited as `target: "camera", command: cmd.name()`; `GET/PUT /api/vehicles/{sysid}/camera/profile` (PUT validates → `400 validation` with the field name, saves, `reload`).
- WS snapshot now carries `cameras: manager.snapshot()`.

- [ ] **Step 1: Failing store tests** (`camera_profiles.rs`): default profile for an unknown sysid has `kind None`, host `192.168.144.25`, port 37260; put/get round-trip; `TryFrom` rejects host `camera.local` and port 0 with the field name.
- [ ] **Step 2: Failing integration tests** (`tests/camera_flow.rs`, simulator started per test):
  - `camera_endpoint_reports_none_until_a_profile_is_saved` — GET camera → caps.kind none; PUT profile `{kind:"siyi_mt11", host:"127.0.0.1", port:<sim>}` → 200; GET camera within 2 s → caps.kind siyi_mt11, state.connected true, firmware present.
  - `commands_are_capability_checked_and_audited` — with kind none: `POST command {cmd:"photo"}` → 409 unsupported_capability; with MT11: `{cmd:"photo"}` → 200 and sim received `(Tcp, 0x0C, [0])`, audit row command "photo", target "camera"; `{cmd:"gimbal_rate",args:{yaw:1,pitch:1}}` → 409 ws_only.
  - `snapshot_and_camera_state_frames` — connect a WS client (use `tokio-tungstenite` dev-dep against a bound `TcpListener`, or exercise `ws::snapshot()` + the broadcast receiver directly): snapshot `cameras[0].sysid == 1`; after `POST command zoom_absolute 3.0` a `camera_state` frame with `zoom == 3.0` arrives within 2 s.
  - `profile_validation_errors_name_the_field` — PUT with port 0 → 400 `validation`, message contains `port`.
- [ ] **Step 3: Run** → FAIL. **Step 4: Implement** store module + migration, `cameras.rs` (≤ 300 lines), `camera_api.rs`, routes, snapshot. **Step 5: Run** `cargo test --workspace --features rgcs-server/sim` → PASS (add `sim` passthrough feature in `apps/rgcs-server/Cargo.toml`: `sim = ["rgcs-camera/sim"]`, and make `tests/` require it via `required-features`).
- [ ] **Step 6: Commit** — `feat(server): camera profiles, CameraManager, camera REST and camera_state frames`.

---

### Task 5: `rgcs-video` — RTSP probe, source monitor, WHEP relay

**Files:**
- Create: `crates/rgcs-video/Cargo.toml` (deps: rgcs-core, tokio, reqwest `{default-features=false, features=["rustls-tls"]}`, thiserror, tracing, url), `src/lib.rs`, `src/probe.rs`, `src/source.rs`, `src/whep.rs`
- Create: `apps/rgcs-server/src/video_api.rs`, `apps/rgcs-server/tests/video_flow.rs`
- Modify: `apps/rgcs-server/src/config.rs` (+ `whep_upstream: String` default `http://127.0.0.1:8889/mt11/whep`, `video_probe_timeout_ms: u64` default 2000), `app.rs` (routes, `video: VideoMonitor`), `deploy/config.toml.example`, `deploy/mediamtx.yml` (copy of the Python one with the `mt11` path), `.dev/` dev config via `scripts/dev.sh` (`--video` flag, see Task 13)

**Interfaces:**
- `probe.rs`: `pub fn rtsp_request_uri(url: &str) -> Result<(String, u16, String), ProbeError>` (same validation as Python: no whitespace/control chars, `rtsp://`, host required, default port 554, rebuilt URI); `pub async fn probe_rtsp(url: &str, timeout: Duration) -> bool` (DESCRIBE, status 2xx or 401 → true).
- `source.rs`: `pub struct SourceMonitor` with `SourceMonitor::spawn(rtsp_url: String, mode: VideoSourceMode, probe: ProbeFn, timings: Timings { check: 3 s, rescan: 15 s, timeout }) -> (SourceMonitor, watch::Receiver<VideoSourceStatus>)`; `fn set_mode(&self, mode)`; pure transition `pub fn next_status(prev: &VideoSourceStatus, probe_ok: bool, consecutive_failures: u32) -> VideoSourceStatus` (auto: Mt11 while ok, switch to None after 2 consecutive failures; forced Mt11: always Mt11 with `probe_ok` informative). `whep_path` is `"mt11"`.
- `whep.rs`: `pub struct WhepRelay { client: reqwest::Client, upstream: Url }`; `pub async fn offer(&self, sdp: &[u8]) -> Result<WhepAnswer, WhepError>` (POST `application/sdp`, expect 201, body ≤ 256 KB → `WhepAnswer { sdp: String }`; 4xx/5xx → `WhepError::Upstream(status)`, connect failure → `WhepError::Unreachable`); `pub const MAX_OFFER_BYTES: usize = 64 * 1024`.
- REST (50 §2.3): `POST /api/vehicles/{sysid}/video/whep` (session required; body `application/sdp` ≤ 64 KB → `201` `application/sdp` answer; upstream down → `503 video_unavailable`; too large → `413`); `GET/PUT /api/vehicles/{sysid}/video/source` → `VideoSourceStatus` / `{mode}`; WS `video_source` on change.

- [ ] **Step 1: Failing unit tests** — `probe.rs`: `rtsp_request_uri_rebuilds_and_defaults_port` (`rtsp://192.168.144.25:8554/video1` → host, 8554, same URI; `rtsp://cam/x` → port 554; `http://x` → Err; `rtsp://a b` → Err); `probe_rtsp_true_on_200_and_401_false_on_404_and_refused` (spawn a tokio `TcpListener` that replies a canned status line). `source.rs`: `auto_switches_to_none_after_two_failures_and_back_on_success`, `forced_mt11_stays_mt11` (pure `next_status`). `whep.rs`: `offer_forwards_sdp_and_returns_the_answer` (axum test server as upstream: assert content-type and body echo), `upstream_5xx_maps_to_upstream_error`, `unreachable_upstream_maps_to_unreachable`.
- [ ] **Step 2: Failing integration tests** (`video_flow.rs`): `whep_relay_requires_a_session_and_caps_the_body` (401 without cookie; 413 for 65 KB body); `whep_relay_returns_503_when_mediamtx_is_down` (upstream = closed port → 503 `video_unavailable`); `whep_relay_passes_the_answer_through` (axum fake upstream returning 201 `v=0...` → same body, status 201).
- [ ] **Step 3: Run** → FAIL. **Step 4: Implement.** **Step 5: Run** → PASS. **Step 6: Commit** — `feat(video): RTSP probe, source monitor and WHEP relay to MediaMTX`.

---

### Task 6: `rgcs-input` — gate (rate limit, range, deadman) wired into the WebSocket

**Files:**
- Create: `crates/rgcs-input/Cargo.toml`, `src/lib.rs`, `src/gate.rs`
- Modify: `apps/rgcs-server/src/ws.rs` (per-session gate; `handle_client` becomes `async fn handle_client(gate: &mut SessionGate, app: &AppState, text: &str, now_ms: u64) -> Vec<ServerMessage>`), `apps/rgcs-server/tests/input_flow.rs` (new)

**Interfaces:**
- `gate.rs` (pure, immutable): `pub struct Gate { target: Option<SysId>, last_rate_ms: Option<u64>, last_hb_ms: Option<u64>, deadman: Deadman }`; `pub const MAX_RATE_HZ_MS: u64 = 40` (25 Hz → one frame per 40 ms); `pub const DEADMAN_MS: u64 = 1500`; `pub enum Action { Forward { sysid: SysId, yaw: i8, pitch: i8 }, Zero { sysid: SysId }, Reply(ServerMessage) }`; `pub fn on_gimbal_rate(&self, sysid, yaw: i16, pitch: i16, now_ms) -> (Gate, Vec<Action>)` (|v| > 100 → `Reply(Error{code:"validation"})` and no forward; faster than 40 ms since last → dropped silently; otherwise `Forward`; records `last_hb_ms = now` too since a rate frame proves liveness); `pub fn on_hb(&self, sysid, now_ms) -> (Gate, Vec<Action>)` (if deadman was Lost → `Reply(InputState{Ok})`); `pub fn on_select(&self, sysid, now_ms) -> (Gate, Vec<Action>)` (`Zero` to the previous target when different); `pub fn tick(&self, now_ms) -> (Gate, Vec<Action>)` (hb older than 1500 ms and deadman Ok → `Zero{target}` + `Reply(InputState{Lost})`, once).
- Server: `SessionGate` wraps `Gate` + a 500 ms ticker inside `session()`; `Forward`/`Zero` → `app.cameras.send(sysid, GimbalRate{..})` (errors from an absent/unsupported camera are logged, not replied); on socket close → `Zero` to the current target.

- [ ] **Step 1: Failing unit tests** (`gate.rs`): `out_of_range_is_rejected_with_validation_error`; `frames_faster_than_25hz_are_dropped`; `hb_silence_sends_zero_once_and_reports_lost_then_ok_on_next_hb` (Review Focus 2); `select_sends_zero_to_the_previous_target`.
- [ ] **Step 2: Failing ws test** (`ws.rs` unit, async): `handle_client` with a `CameraManager` backed by the simulator: `gimbal_rate` frame → sim receives `(Udp, 0x07, [yaw, pitch])`; `{"t":"gimbal_rate","sysid":1,"yaw":200,"pitch":0,"seq":1}` → reply `error validation`. Update the P1 test `joystick_frames_are_refused_for_now` to its new meaning (`input_hb` without a camera → no reply).
- [ ] **Step 3: Run** → FAIL. **Step 4: Implement.** **Step 5: Run** `cargo test --workspace --features rgcs-server/sim` → PASS. **Step 6: Commit** — `feat(input): gimbal rate gate with range check, 25 Hz limit, deadman and select; wired into /ws`.

---

### Task 7: UI — WHEP player with last-frame hold and reconnect

**Files:**
- Create: `apps/rgcs-server/ui/src/shared/video/whep.ts`, `whep.test.ts`, `state.ts`, `state.test.ts`, `stats.ts`, `stats.test.ts`, `index.ts`

**Interfaces:**
- `state.ts` (pure): `type PlayerPhase = 'idle' | 'connecting' | 'playing' | 'reconnecting' | 'stopped'`; `interface PlayerState { phase; attempt: number; holdFrame: boolean; lastError: string | null }`; transitions `start(s)`, `connected(s)`, `failed(s, error)`, `stopped(s)`; `backoffMs(attempt)` = `min(5000, 1000 * 2 ** attempt)`; `holdFrame` is true from the first `connected` onwards and never cleared by failures (the `<video>` keeps its last frame until a new track plays).
- `stats.ts` (pure): `latencyMs(report: ReadonlyArray<{ type: string; kind?: string; jitterBufferDelay?: number; jitterBufferEmittedCount?: number; currentRoundTripTime?: number; nominated?: boolean }>) -> { rtt: number | null; jitter: number | null }` (video inbound-rtp: jitter = delay / emittedCount × 1000; nominated candidate-pair RTT × 1000).
- `whep.ts`: `class WhepPlayer { constructor(video: HTMLVideoElement, url: string, opts?: { pc?: () => RTCPeerConnection; fetchImpl?: typeof fetch; headers?: Record<string,string>; onState?: (s: PlayerState) => void; onStats?: (l: { rtt; jitter }) => void }); start(): void; stop(): void; getState(): PlayerState }` — flow: new PC (`recvonly` video+audio transceivers), createOffer, setLocalDescription, wait `icegatheringstate === 'complete'` (or 2 s), POST SDP (`content-type: application/sdp` + opts.headers), 201 → setRemoteDescription; `ontrack` → `video.srcObject = stream` only then (hold); `oniceconnectionstatechange` `failed|disconnected` or fetch failure → `failed()` + timer with `backoffMs`; `stop()` closes PC and clears timers (does not clear `srcObject`); stats polled every 1 s while playing.

- [ ] **Step 1: Failing tests** — `state.test.ts` (transitions, backoff caps at 5 s, `holdFrame` sticky); `stats.test.ts` (sample report → rtt 42 ms, jitter 80 ms; no video rtp → nulls); `whep.test.ts` with a `FakeRTCPeerConnection` (records `createOffer`/`setLocalDescription`, exposes `fireIceComplete()`, `fireTrack(stream)`, `fireIceState(state)`) and a fetch stub: `posts the offer after ice gathering and applies the answer`; `attaches the stream only on track and keeps it on failure` (after `fireIceState('failed')`, `video.srcObject` unchanged, state `reconnecting`, a timer is scheduled — use `vi.useFakeTimers`; Review Focus 4); `upstream 503 schedules a retry with backoff`; `stop closes the connection and cancels the retry`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. **Step 5: Commit** — `feat(ui): WHEP player with ICE-complete offer, last-frame hold, backoff reconnect and latency stats`.

---

### Task 8: UI — gamepad → gimbal (mapping, loop, profile API)

**Files:**
- Create: `apps/rgcs-server/ui/src/features/gimbal-joystick/profile.ts` (zod schema + defaults), `mapping.ts`, `mapping.test.ts`, `loop.ts`, `loop.test.ts`, `useGimbalJoystick.ts`, `api.ts`, `index.ts`
- Server: `apps/rgcs-server/src/input_api.rs` (`GET/PUT /api/settings/input/gimbal` storing the JSON profile; PUT validates with the same rules), `crates/rgcs-store/src/input_profile.rs`; test in `apps/rgcs-server/tests/settings_flow.rs` (extend)

**Interfaces:**
- `profile.ts`: `AxisFunction = 'none' | 'pan' | 'tilt'` (zoom functions deferred), `ButtonFunction = 'none' | 'shutter' | 'record_toggle' | 'center_gimbal' | 'thermal_toggle' | 'gimbal_stop' | 'zoom_in_step' | 'zoom_out_step' | 'zoom_1x' | 'mode_lock' | 'mode_follow' | 'mode_fpv' | 'mode_cycle'`; `GimbalInputProfile = { device_id: string | null; axes: { axis: number; fn: AxisFunction; deadzone: number /*0–0.5*/; invert: boolean; scale: number /*0.1–2*/ }[]; buttons: { button: number; fn: ButtonFunction }[]; max_pan_speed: number /*1–100, default 30*/; max_tilt_speed: number /*default 20*/ }`; `DEFAULT_PROFILE` (axis 0 pan, axis 1 tilt invert, deadzones 0.08; buttons: 0 record_toggle, 1 shutter, 2 center_gimbal, 3 thermal_toggle).
- `mapping.ts` (pure): `applyDeadzone(v, dz)` (linear rescale outside dz, 0 inside); `axesToRates(axes: readonly number[], p: GimbalInputProfile): { yaw: number; pitch: number }` (rounded ints, clamped ±100); `buttonEdges(prev: readonly boolean[], now: readonly boolean[], p): ButtonFunction[]` (rising edges only).
- `loop.ts`: `class GimbalLoop { constructor(deps: { send: (m: ClientMessage) => boolean; onButton: (fn: ButtonFunction) => void; readGamepad: () => { axes: readonly number[]; buttons: readonly boolean[] } | null; now: () => number }); start(profile, sysid): void; setTarget(sysid | null): void; setProfile(profile): void; tick(): void; stop(): void }` — `tick` every 50 ms: rates non-zero → send `gimbal_rate` (seq++); zero after non-zero → send one zero; `input_hb` every 1000 ms while a target exists; `setTarget` sends zero to the old target then `select`; `stop()` / `readGamepad() === null` (disconnected) → one zero and no further frames.
- `useGimbalJoystick(selectedSysid)`: effect that owns a `GimbalLoop` fed by `navigator.getGamepads()` and `vehicleStore.send`, listens to `gamepadconnected/disconnected` and `visibilitychange` (hidden → `setTarget(null)`), routes button functions to `sendCameraCommand` (Task 9's api).
- `vehicleStore.send(msg: ClientMessage): boolean` (exposes the WS client's `send`).

- [ ] **Step 1: Failing tests** — `mapping.test.ts`: deadzone rescale (`applyDeadzone(0.5, 0.08)` ≈ 0.4565), invert/scale/max speed → `axesToRates([0.5, -1], DEFAULT)` = `{yaw: 14, pitch: 20}`, clamp at ±100, rising edges only. `loop.test.ts` (fake clock): `sends non-zero rates at 20 Hz and a single zero afterwards`; `sends input_hb once per second only while a target is set`; `setTarget sends zero to the old target then select`; `disconnect sends zero and stops` (Review Focus 2); `visibility hidden path = setTarget(null) sends zero`.
- [ ] **Step 2: Server failing test** (`settings_flow.rs`): GET gimbal profile → defaults; PUT with `max_pan_speed: 500` → 400 validation; PUT valid → GET returns it.
- [ ] **Step 3: Run** → FAIL. **Step 4: Implement** (UI + server). **Step 5: Run** both suites → PASS. **Step 6: Commit** — `feat: gamepad gimbal control (mapping, 20 Hz loop, deadman heartbeat) and the gimbal input profile API`.

---

### Task 9: UI — camera store, video thumbnail, camera strip and status row in the detail panel

**Files:**
- Create: `apps/rgcs-server/ui/src/features/camera/store.ts` (+test), `api.ts` (+test), `VideoThumb.tsx` (+test), `CameraStrip.tsx` (+test), `CameraStatusRow.tsx` (+test), `format.ts` (+test), `index.ts`
- Modify: `features/vehicles/reducer.ts` (snapshot `cameras`, `camera_state`, `video_source`, `input_state` → `VehiclesState.cameras: ReadonlyMap<SysId, CameraSnapshot>`, `videoSources`, `deadman`), `features/detail/DetailPanel.tsx` (camera section), `app/Shell.tsx` (joystick hook, deadman pill in footer), `shared/i18n` keys, `styles/app.css`

**Interfaces:**
- `api.ts`: `getCamera(sysid): Promise<{caps, state}>`; `sendCameraCommand(sysid, cmd: CameraCommand): Promise<void>`; `whepUrl(sysid) = `/api/vehicles/${sysid}/video/whep``.
- `format.ts`: `zoomText(z) → "2.5×"`, `angleText(a) → "−30.0°"`, `recDuration(startedAt, now) → "01:23"`.
- `<VideoThumb sysid status={VideoSourceStatus} recording onMaximize? />` — 16:9 `.feed` with `<video muted autoplay playsinline>` driven by `WhepPlayer` (headers `X-Requested-With: rgcs`) when `status.source !== 'none'`; "映像未接続" otherwise; `.pill-rec` with duration while recording; a `.hint` "再接続中" when phase is `reconnecting`.
- `<CameraStrip caps state pending onCommand(cmd) onSettings />` — rendered only when `caps.kind !== 'none'`: record toggle (`.rec-btn`, `.on` + blinking dot when recording; disabled while `pending`), photo, zoom `−` / `.big` value / `+` (`ZoomStep ±1`), video type `.seg.n3` only when `video_modes.length > 1`, gear → `onSettings`. Buttons not in caps are not rendered (spec 40 §1.1 rule).
- `<CameraStatusRow caps state onSetup />` — "カメラ未設定 | 設定する" for kind none; else `Lock | ↔ 12.3° ↕ −30.0°` with 切断 when `!connected`.
- Reducer: `cameraFor(state, sysid)`; `pendingCommands` lives in the camera store: `markPending(sysid, name)` cleared by the next `camera_state` for that sysid or after 3 s.

- [ ] **Step 1: Failing tests** — reducer (`snapshot cameras populate the map`, `camera_state replaces one entry immutably`, `input_state updates deadman`); `CameraStrip.test.tsx` (`renders nothing for kind none`; `hides the video type segment when only rgb`; `zoom + sends ZoomStep 1`; `record toggle sends RecordStart when idle and RecordStop when recording`; `record toggle is disabled while pending` — Review Focus 5); `CameraStatusRow.test.tsx`; `VideoThumb.test.tsx` (mock `WhepPlayer`: starts when source mt11, shows 映像未接続 when none, shows 再接続中 when reconnecting); `format.test.ts`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement + wire into `DetailPanel` (sections: video thumb, strip, status row, then telemetry) and `Shell` (`useGimbalJoystick(selected)`, footer deadman pill "ジョイスティック切断" when lost).** **Step 4: Run** → PASS; `npm run lint/typecheck`. **Step 5: Commit** — `feat(ui): camera strip, video thumbnail (WHEP) and camera status row in the detail panel; joystick wired to the selected vehicle`.

---

### Task 10: UI — camera settings sheet (接続 / 操作 tabs)

**Files:**
- Create: `features/camera-settings/CameraSettingsSheet.tsx` (+test), `ConnectionTab.tsx`, `InputTab.tsx`, `schema.ts` (zod: profile + input profile), `index.ts`
- Modify: `app/modal.ts` (`{ kind: 'camera-settings'; sysid }`), `Shell.tsx`, i18n

**Interfaces:**
- `<CameraSettingsSheet sysid profile inputProfile onSave(profile, inputProfile) onCancel dict />` — 440 px `.g-strong.sheet`, tabs `.seg.n2` 接続 / 操作; 接続: kind select (なし / SIYI MT11 — MAVLink listed but disabled "準備中"), host, port, rtsp (read-only, `rtsp://{host}:8554/video1`), connection status line from the camera store (connected, firmware); 操作: device select (from `navigator.getGamepads()` ids, "自動"), axis table (axis / 機能 / 不感帯 / 反転) for the first 4 axes, button table for the first 8 buttons, max pan / tilt speed inputs, "ジンバルをセンター" button (sends `GimbalCenter OneKeyReset`). Invalid values are red and block save (zod).
- Save → `PUT camera/profile` then `PUT /api/settings/input/gimbal`; results as footer pills (`cmd_camera_settings` label).

- [ ] **Step 1: Failing tests** — `schema.test.ts` (host must be IPv4; port range; deadzone ≤ 0.5); `CameraSettingsSheet.test.tsx` (`kind none hides host/port`; `invalid port shows red and keeps save disabled`; `save calls onSave with both profiles`; `center button sends GimbalCenter`).
- [ ] **Step 2–4: RED → implement → GREEN.** **Step 5: Commit** — `feat(ui): camera settings sheet (connection and joystick tabs)`.

---

### Task 11: Audience endpoints — presentation tokens, logo, `/present/*`

**Files:**
- Create: `crates/rgcs-store/src/presentation.rs`, `apps/rgcs-server/src/present_api.rs`, `apps/rgcs-server/src/branding.rs`, `apps/rgcs-server/tests/present_flow.rs`
- Modify: `app.rs` (routes), `auth.rs` (`AdminUser` extractor = `AuthUser` with role admin), `config.rs` (nothing), `ws.rs` (nothing)

**Interfaces:**
- Store: `create_presentation_token(label, created_by) -> Result<String>` (32 hex from `uuid::Uuid::new_v4().simple()`), `list_presentation_tokens() -> Vec<PresentationToken { token_prefix: String /* first 6 */, label, created_at, revoked_at }>`, `revoke_presentation_token(token_prefix)`, `presentation_token_valid(token) -> bool` (exists, not revoked).
- Admin REST (session + admin): `GET/POST /api/settings/presentation/tokens` (`POST {label}` → `{token, url: "/present?t=<token>"}`), `DELETE /api/settings/presentation/tokens/{prefix}`; `PUT /api/settings/branding/logo` (raw body, `content-type` `image/png` or `image/svg+xml`, ≤ 1 MB → `data_dir/branding/logo.png|svg`, replaces; `413` over limit, `415` other types), `DELETE …/logo`.
- Public, token-guarded (`?t=` query, `401 invalid_token` otherwise; no cookies read): `GET /present/config` → `{ sysid: Option<SysId> /* lowest connected */, vehicle_name, logo: bool, map_tile_url, map_attribution, whep_path }`; `GET /present/vehicle` → `{ sysid, lat, lon, hdg, alt_rel, mode, armed, link } | null`; `GET /present/logo` → the file (`Cache-Control: no-store`); `POST /present/whep` → same relay as Task 5 (separate upstream session per call).
- Rate: `/present/vehicle` is polled at 2 Hz by one page; no server-side limit needed (document).

- [ ] **Step 1: Failing integration tests** — `present_endpoints_need_a_valid_token` (no `t` → 401; revoked → 401; valid → 200 config with `logo: false`); `admin_creates_lists_and_revokes_tokens` (operator role → 403; admin → token 32 hex; list shows prefix; delete → revoked); `logo_upload_limits_and_serves` (svg 100 B → 200, `GET /present/logo?t=` returns it with the same content-type; 1 MB + 1 → 413; `image/gif` → 415); `present_vehicle_reports_the_first_vehicle_or_null`; `present_whep_relays_like_the_operator_endpoint` (fake upstream).
- [ ] **Step 2–4: RED → implement → GREEN** (`present_api.rs` ≤ 300 lines; token check as an axum middleware on the `/present` router).
- [ ] **Step 5: Commit** — `feat(server): presentation tokens, logo upload and the token-guarded /present endpoints`.

---

### Task 12: UI — `/present` page and the presentation settings panel

**Files:**
- Create: `apps/rgcs-server/ui/src/present/PresentApp.tsx` (+test), `present/api.ts`, `present/MiniMap.tsx`, `present/usePresentConfig.ts`; `features/present-settings/PresentSettings.tsx` (+test), `api.ts`
- Modify: `main.tsx` (pathname `/present` → `<PresentApp />` without `setUnauthorizedHandler`; else `<App />`), `app/UserPopover.tsx` (+ "観客用画面" item → modal), `app/modal.ts`, `styles/present.css`

**Interfaces:**
- `present/api.ts`: `presentConfig(token)`, `presentVehicle(token)`, `presentWhepUrl(token)`, `presentLogoUrl(token)`; all `fetch` with `cache: 'no-store'`, no CSRF header needed (GET) — the WHEP POST sends `X-Requested-With: rgcs` anyway.
- `<PresentApp />` — reads `t` from `location.search`; states: `loading` → `invalid` (neutral full-screen "無効なリンクです" + nothing else; polling stops; Review Focus 3) → `ready`: full-bleed `<video>` driven by `WhepPlayer(presentWhepUrl)`, logo `<img>` top-left when `config.logo`, `<MiniMap>` bottom-right (320×200, `MapView` with `padding {0,0,0,0}`, follow the vehicle, no controls, `interactive: false`), a `.hint` "再接続中" after 1 s in `reconnecting`; vehicle polled every 500 ms; on fetch errors the page keeps the last vehicle and keeps polling (no login, no dialogs). No `dialog` roles anywhere on this route.
- `<PresentSettings />` (modal from the user popover; admin only — operators see the link list read-only): create token (label), copy link (`${location.origin}/present?t=…`, shown once), revoke, logo upload (`<input type=file accept=image/png,image/svg+xml>` → PUT), logo preview, remove.

- [ ] **Step 1: Failing tests** — `PresentApp.test.tsx` (mock `WhepPlayer` and `MapView`): `invalid token renders the notice and stops polling` (fetch 401 → notice; `vi.advanceTimersByTime(3000)` → no further fetches); `ready renders video, logo and mini-map and polls at 2 Hz`; `vehicle fetch failures keep the last position`; `reconnecting shows the badge after 1 s`. `PresentSettings.test.tsx`: `creating a token shows the link once`, `revoke calls DELETE with the prefix`, `logo upload PUTs the file with its content-type`.
- [ ] **Step 2–4: RED → implement → GREEN.** `npm run build` must emit a single bundle that serves `/present` through the existing SPA fallback (no second HTML entry).
- [ ] **Step 5: Commit** — `feat(ui): token-protected /present audience page (video, mini-map, logo) and presentation settings`.

---

### Task 13: Dev video stack, E2E with simulator and the audience stability check, docs

**Files:**
- Create: `scripts/dev-video.sh` (requires `mediamtx` on PATH and `ffmpeg`: writes `.dev/mediamtx.yml` with `rtsp: yes` on 8554, `webrtcAddress 127.0.0.1:8889`, path `mt11` as publisher; runs `ffmpeg -re -f lavfi -i testsrc2=size=1280x720:rate=30 -c:v libx264 -tune zerolatency -f rtsp rtsp://127.0.0.1:8554/mt11`; prints how to install), `deploy/mediamtx.yml`
- Modify: `scripts/dev.sh` (`--siyi-sim` starts `cargo run -p rgcs-camera --features sim --example siyi_sim -- --port 37260` and seeds the profile for sysid 1 via the API after login; `--video` runs `dev-video.sh`), `scripts/e2e.sh` (`--with-sim`: start the simulator, seed the profile; `--with-video`: also start MediaMTX + ffmpeg, set `RGCS_E2E_VIDEO=1`), `apps/rgcs-server/ui/e2e/camera.spec.ts` (sim: strip appears, zoom + changes the `.big` value, record toggle turns the pill on, settings sheet saves), `e2e/present.spec.ts` (video: open `/present?t=` in page A → `video.currentTime` advances; in page B log in, open settings, send a video type switch, open commands sheet, log out; sample A's `currentTime` every 200 ms for the whole sweep and assert no gap > 1 s — the addendum's acceptance 7-1), `.github/workflows/ci.yml` (e2e job adds `--with-sim`; the video variant stays local), `docs/spec/40-camera-gimbal.md` §8 and `docs/spec/50-api.md` §2.3 / §3 / new §2.6 (`/present/*`), `docs/spec/60-data-model.md` §3 (tables added), `README`-level setup note in `deploy/` for MediaMTX.

- [ ] **Step 1: `camera.spec.ts` + `present.spec.ts`** written first; run `scripts/e2e.sh --with-sim` → camera spec FAIL until the sim seeding works; then PASS.
- [ ] **Step 2: `scripts/dev-video.sh`** — manual check on this Mac after `brew install mediamtx`: `scripts/dev.sh --siyi-sim --video`, open the detail panel → test pattern plays, latency pill shows numbers; open `/present?t=` in a second window → pattern plays; stop ffmpeg for 5 s and restart → the audience window shows the last frame, the badge, then resumes. Record the result in the commit body.
- [ ] **Step 3: `scripts/e2e.sh --with-sim --with-video`** → `present.spec.ts` PASS (local only); CI runs `--with-sim`.
- [ ] **Step 4: Docs sync** (short factual lines, dated 2026-10-17 P2).
- [ ] **Step 5: Commit** — `test: simulator-backed camera E2E, audience stability check with MediaMTX, dev video stack; docs sync`.

---

## Self-review notes

- Spec coverage: 40 §1 trait/caps/command/state → T1/T3; §2 siyi caps → T1; §3 subset (0x00/01/05/06/07/08/0A/0B/0C/0D/0E/0F/10/11/18/19) → T2/T3; §6 joystick (pan/tilt, buttons, 20 Hz, zero-once, select) → T8; §7 port table rows for camera_protocol / video_probe / app.js → T2/T5/T8; 10 §3.3 items 2–4 → T9; 10 §5 接続/操作 → T10; 30 §5 → T5; 30 §6 → T6/T8; 70 §2 → T6/T8; 70 §3 caps check → T4; addendum §5.1 → T11/T12/T13; §5.3 → T3/T9. Deliberately out (Global Constraints): thermal temps, AI, ROI, encoding, SD/clock, Android, cockpit, grid, MAVLink camera.
- Type consistency: `CameraCommand` tag/content names used identically in T4 tests, T8 button routing and T9 strip; `VideoSourceStatus.whep_path` fixed to `"mt11"` in T5 and consumed by T9/T12; `Deadman` from T1 used by T6 and the T9 footer pill.
- Proportion: ~370 lines against ~300 lines of spec sections plus the Python oracle; bodies omitted except the golden byte strings and the few constants the spec fixes.
- Assumptions pending the user's answers (addendum §9): audience sees the same main stream as the operator (video type switches are visible to the audience); LAN between PC and Pi; no cockpit view in P2; no bench MT11 — the simulator and the MediaMTX test pattern stand in. Each is a one-task change if the answer differs (T12 sub-stream path, T9 maximize → cockpit).
