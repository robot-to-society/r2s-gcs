# MT11 Camera — Remaining Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the SIYI MT11 driver items that spec 40 §7.1 lists as 未実装(デモ後), and replace every 準備中 / hidden camera row in the UI with live data. The work has four parts:
- **Thermal:** gain (0x37 / 0x38), palette (0x1B), full-frame max / min (0x14) and point temperature (0x12).
- **AI tracking:** track push (0x50 / 0x51), AI mode (0x55), box / point select and cancel (0x56), detection boxes (0x5F). This includes click / Ctrl+click / Alt+click in the cockpit video.
- **Camera upkeep:** encoding (0x20 / 0x21), clock sync from the FC's GPS time (0x30 / 0x40), SD card info (0x49).
- **UI:**
  - the camera settings 「映像」 tab;
  - the 接続 tab's SD / clock rows and 「今すぐ同期」;
  - the cockpit overlays and the AI追跡 button;
  - the camera status card rows (サーマル / SD カード / カメラ時刻 / 映像);
  - the detail status row's 追跡中 / 見失い;
  - the joystick functions `thermal_gain_toggle`, `ai_tracking_toggle`, `focus_near` and `focus_far`.

**Architecture:**
- **Pure protocol modules.** The new code lives in `crates/rgcs-camera/src/siyi/{thermal,ai,tf_card}.rs` and `crates/rgcs-camera/src/clock_sync.rs`. They are ports of the Python `thermal.py`, `ai_tracking.py`, `tf_card.py` and `time_sync.py`. Each Python test becomes a `#[test]`.
- **The driver actor does the rest.** The `SiyiMt11` actor (one task per camera) owns everything that needs the wire:
  - the poll schedule;
  - the detection history (1.5 s);
  - the receive timestamps that expire stale overlays;
  - the clock-sync state machine.
  - `client.rs` is split into `apply.rs` (frame → state), `exec.rs` (command → frames), `polls.rs` (schedule) and `expire.rs` (stale overlays), so no file passes 400 lines.
- **GPS time.** The server injects a `GpsTime` source into the driver. It reads the router's latest `SYSTEM_TIME` sample for that vehicle. This keeps the clock offset in `CameraState.clock`, written by the single actor, and needs no new WS frame.
- **The server stays thin.** It adds:
  - command validation;
  - the profile's default `ai_box_px`;
  - the ROI ↔ AI interlock;
  - narrower profile reloads;
  - a 10 Hz cap on `camera_state` frames;
  - a small ARM / DISARM auto-record task.
- **UI.** The overlay maps normalized frame coordinates through the `object-fit: cover` rect of the cockpit `<video>`. Clicks map back the same way.

**Tech stack:** Rust (tokio, axum, sqlx SQLite, ts-rs), React 19 + TypeScript (vitest, @testing-library, zod).

**Specs (binding):**
- `docs/spec/40-camera-gimbal.md`: §1.1 caps, §1.2, §1.3, §3 table (0x12 / 0x14 / 0x1B / 0x20 / 0x21 / 0x30 / 0x37 / 0x38 / 0x40 / 0x49 / 0x50 / 0x51 / 0x55 / 0x56 / 0x5F), §3.1, §5, §6, §7 port table, §8.
- `docs/spec/10-screens.md`:
  - §3.3 item 4 (追跡中 / 見失い in the status row);
  - §4 (the "出さない" line is retired);
  - §4.2 (operation bar AI追跡, video overlay, click operations, camera status card rows);
  - §5 (接続 status SD / clock + 今すぐ同期; 映像 tab).
- `docs/spec/50-api.md` §2.3 (`camera/command`, `camera/profile`), §3.1 (`camera_state`).
- `docs/spec/60-data-model.md` §3.3. No new columns: `encoding_preset`, `thermal_palette`, `thermal_overlay`, `ai_box_px`, `clock_sync` and `auto_record` already exist.
- `docs/spec/70-safety-auth.md` §3:
  - `409 unsupported_capability`;
  - no click tracking while the resolution is unknown;
  - no clock sync without fresh GPS time;
  - auto record and the SD warning;
  - 0x48 stays forbidden.
- Design:
  - `design_base/screenshots/glass_camera_settings_video.png`, `glass_camera_settings_conn.png`, `glass_cockpit_ir.png`, `glass_cockpit_rgb.png`;
  - prototype `design_base/project/RGCS Prototype Glass.dc.html`:
    - lines 374–382 (`.trk`, `.tmark` CSS);
    - 757–762 (overlay markup);
    - 785 (AI追跡 button `btn btn-sm` / `on`);
    - 801–810 (card rows);
    - 1277–1290 (映像 tab);
    - 1468–1469 (`ENC_PRESETS`, `PALETTES`);
    - 2165–2177 (view model texts).
- Python reference:
  - `~/github/rtos/siyi-mt11-cameracontrol/app/{camera_protocol.py,thermal.py,ai_tracking.py,time_sync.py,tf_card.py,video_routes.py,main.py (background_status_loop)}` and `app/static/{video_geometry.js,app.js}`;
  - tests: `tests/{test_thermal.py,test_tf_card.py,test_time_sync.py,test_ai_tracking.py,test_camera_protocol.py,test_video_api.py,test_time_api.py,test_tf_card_api.py,test_thermal_api.py,js/video_geometry.test.mjs}`.

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
- Never send vehicle commands or write vehicle params to the dev stack (ports 5760-5763, 8000, 5173, 14550, 14551). Live checks run only against a scratch server / SITL / MT11 simulator on other ports (Task 10).

## Fixed values (from the specs and the Python app; tests assert these)

| Value | Fixed at | Source |
|---|---|---|
| Temperature | `raw / 100` °C; > 600 °C → `(raw − 65536) / 100` | 40 §3, `thermal.py` |
| Gain ranges | High (−20, 150) °C, Low (0, 550) °C; wire 0 = Low, 1 = High | 40 §1.1, §3 |
| Palettes | 0, 2–11 (White Hot, Sepia, Ironbow, Rainbow, Night, Aurora, Red Hot, Jungle, Medical, Black Hot, Glory Hot) | 60 §3.3, prototype 1469 |
| 0x14 request | `[1]` (flag ONCE), every 1 s while `video_mode == thermal` | `main.py` |
| 0x12 request | `<HHB` x, y (stream px), flag 1 | `thermal.py` |
| Overlay ages | frame ≤ 3 s, point ≤ 15 s, track ≤ 1 s, detections shown ≤ 0.5 s | `thermal.py`, `video_routes.py` |
| Detection history | 1.5 s, at most 60 frames; Ctrl+click looks back 1 s | `camera_protocol.py`, `video_routes.py` |
| 0x50 grid | centre box on 1280 × 720 → normalized top-left | `ai_tracking.py` |
| 0x50 status | 0 tracking, 1 lost temporarily, 2 lost, 3 cancelled, 4 tracking (any) | `ai_tracking.py` |
| Box size | `ai_box_px` 100, 32–600; centre / joystick start 200 | 60 §3.3, 40 §6 |
| 0x55 → 0x56 | enable, wait 100 ms, select | `video_routes.py` |
| 0x51 / 0x5F | `[1]` / `[5]` (enable), re-sent every 5 s | `main.py` |
| Encoding presets | `h264_720p`, `h264_1080p`, `h264_4k`, `h265_1080p`, `h265_4k` (codec 1 = H.264, 2 = H.265) | 60 §3.3, `ai_tracking.py` |
| 0x20 | `[1]` (main stream); every 1 s while the resolution is unknown, else every 30 s; only `stream_type == 1` replies count | `main.py`, `camera_protocol.py` |
| 0x21 | `<BBHHHB` 1, codec, w, h, 0, 0; clears `stream` / `encoding`; 0x20 re-read 300 ms later | `camera_protocol.py`, `video_routes.py` |
| Clock | 0x30 `<Q` unix µs; 0x40 reply `<Q…` (≥ 8 bytes) | 40 §3 |
| Clock rules | resync every 600 s; GPS sample ≤ 5 s old; read-back timeout 1 s; offset = camera − GPS at the RTT midpoint; red when \|offset\| > 1000 ms | 40 §5, `time_sync.py` |
| 0x40 poll | every 5 s (display) | `main.py` |
| SD | 0x49 every 10 s; `<BBHH` status, fs, total ×100, free ×100; red when free < 10 % or status ≠ ok | 40 §3, §5 |
| SD status | 0 not_inserted, 1 mount_failed, 2 ok, 3 low_space, 4 read_only, 5 read_error; fs 0 unknown, 1 FAT32, 2 exFAT | `tf_card.py` |
| 0x37 poll | every 10 s | `main.py` |
| `camera_state` | change-driven, at most 10 Hz, plus the 1 Hz resend | ruling 8 |

## Rulings (spec conflicts / open questions decided here)
1. **Coordinates.** Thermal `xy` / `max_xy` / `min_xy` stay in main-stream pixels (spec 40 §1.3), which is what 0x12 / 0x14 carry. The track box and detections are **normalized 0..1**, because their wire formats are not stream pixels: 0x50 uses a fixed 1280 × 720 grid and 0x5F uses u16 / 65535. This deviates from the §1.3 line "座標は主ストリーム画素". The UI normalizes thermal points with `state.stream`.
2. **Command coordinates are normalized.** The spec names `AiSelectBox(StreamBox)` and `AiSelectPoint{x,y}` in stream pixels. These become `AiSelectBox{x, y, box_px}`, `AiSelectPoint{x, y}` and `MeasurePoint{x, y}` with x / y in 0..1.
   - The driver converts them with the latest 0x20 resolution.
   - So the "resolution unknown → refuse" rule (70 §3) is enforced in one place, against the same `stream` value the conversion uses.
   - `box_px: null` means "use the profile's `ai_box_px`". The server fills it in.
3. **Not commands:** `MeasureFrame(bool)`, `AiEnable(bool)` and `AiCandidates(bool)`, as in the Python app:
   - 0x14 is polled whenever the view is IR, and the overlay On/Off is the UI-only `thermal_overlay` flag;
   - 0x55 is sent before every select;
   - 0x51 / 0x5F are re-enabled every 5 s, which also covers a camera reboot.
4. **Refusals are `409` with a specific code.** The driver returns the new `CameraError::Refused(code)`. `camera_api` maps it to `409 {code}`, and the UI translates `camErr_<code>`. Codes:
   - `rgb_only` (click tracking outside RGB);
   - `thermal_only` (Alt+click outside IR);
   - `stream_unknown` (resolution not yet read);
   - `no_detection` (Ctrl+click missed every recent box);
   - `clock_sync_off`.
   - Python used 503 / 404 here. Spec 50 lists only the generic codes; these are added to its error list.
5. **Clock sync runs inside the driver.**
   - `SyncClock` stays a `CameraCommand`: it sets the state machine's pending flag.
   - The GPS sample comes from an injected `GpsTime`. Its server implementation reads the router's newest `SYSTEM_TIME` with `time_unix_usec > 0`, timestamped with the link's wall clock (`Clock.unix_ms`).
   - Elapsed time is wall-now − wall-received. A negative value counts as stale.
   - Without a source (`profile.clock_sync == false`), automatic sync is off and `SyncClock` → `409 clock_sync_off`.
   - The `clock_sync` flag has no UI toggle (none in the design); it is API-only.
6. **The displayed offset** is the last sync's read-back (RTT/2-corrected), not the 5 s 0x40 poll. The poll only refreshes `camera_unix_us`. Red: \|offset\| > 1000 ms, or `clock.error` is set.
7. **Profile PUT reloads the driver only when a connection field changes:** `kind`, `host`, `port`, `rtsp_url`, `comp_id`, `video_source_mode`, `android_url`, `clock_sync`. This narrows spec 50 "保存後にドライバ…再生成".
   - The 映像 tab fields (`encoding_preset`, `thermal_palette`, `thermal_overlay`, `ai_box_px`, `auto_record`) are stored without a reload. So an encoding change never stops ROI or the video monitor.
   - The UI save then sends `Encoding` / `ThermalPalette` / `ThermalGain` commands for the values that changed. It does this only when the connection fields did not change, because a reload makes the camera briefly offline.
   - Failures are reported like other camera commands.
   - The palette has no read-back, so the stored value is what the select shows.
   - The gain is not stored: its draft starts from `state.thermal.gain`.
8. **`camera_state` is capped at 10 Hz.** 0x50 / 0x5F push at camera rate (up to 30 Hz) and every frame changes the watch. `forward()` sends at most one frame per 100 ms, always sending the newest state at the end of a burst, plus the existing 1 Hz resend. Spec 50 says only "変化時".
9. **ROI ↔ AI interlock** (40 §4, "AI 追跡開始で ROI 解除 / ROI 開始で AI 追跡解除"):
   - `AiSelectBox` / `AiSelectPoint` stop an active ROI before sending (`StopReason::Manual`, audit `roi` / `stop`, reason `ai_tracking`).
   - `RoiHub::start` sends `AiCancel` first when `caps.ai_tracking` is present. A failure is logged and does not block the start.
   - A `VideoMode` switch to IR / 2画面 cancels tracking (40 §3.1): the driver sends 0x56 cancel when `state.track` is set.
10. **Track state mapping:** 0 / 4 → `tracking`, 1 → `searching`, 2 → `lost`, 3 → track cleared.
    - UI classes: `.trk.tracking` for tracking, `.trk.lost` for searching / lost.
    - A plain `.trk` (accent dashed) preview box shows from the click until the first 0x50, for at most 1.5 s.
11. **Android video source (70 §3)** does not exist (`VideoSource` = `mt11 | none`). The "no tracking / temperatures on Android" rule needs no code now. It stays a note for the Android plan.
12. **Auto record (70 §3)** is included because the 映像 tab exposes the toggle. A server task polls `router.states()` at 2 Hz.
    - On a false → true `armed` edge with `auto_record`: `RecordStart`, unless already recording. With `storage.status` ≠ ok, or `recording` no_card / card_error, it also posts a warning message `sd_card_problem`.
    - On a true → false edge: `RecordStop`.
    - The first observation after a server start is not an edge.
    - Audit operator `auto_record`.
13. **Cockpit geometry is `object-fit: cover`** (the design is full-bleed), not Python's letterbox. `coverRect` is the Python `contentRect` with max instead of min scale. In 2画面, clicks do nothing and no temperatures are drawn. In IR, markers draw only when `thermal_overlay` is on.
14. **Ctrl+click** also accepts ⌘ (`metaKey`) on macOS, and the cockpit's `contextmenu` is prevented. Alt+click is IR-only.
15. **Disconnect clears media state:** `track`, `candidates`, `thermal.frame` / `thermal.point`, `stream`, `encoding`. `storage` and `clock` stay, so the last known values remain visible while greyed.
16. **The 0x13 region temperature and `/api/debug/camera/{sysid}/rx`** are not ported (no UI uses them).

## Review Focus (untested-in-isolation failure modes most likely to bite an operator)
1. **Click lands somewhere else than aimed.**
   - The cover crop, element resize and 4K vs 1080p stream all affect the mapping.
   - `toNormalized(coverRect(...))` is unit-tested, but the real `<video>` `videoWidth` / `videoHeight` may differ from the 0x20 resolution, e.g. MediaMTX transcoding or 2画面.
   - The math uses the element's intrinsic `videoWidth` / `videoHeight` for the rect, and the normalized result is what goes to the camera.
   - Verify live (Task 10): a click on a sim detection selects that detection.
2. **ROI and the AI tracker fight over the gimbal.**
   - The tracker moves the gimbal itself. If ROI keeps sending 0x07, the gimbal oscillates.
   - Check that every AI start path stops ROI: click, Ctrl+click, the AI追跡 button and the joystick `ai_tracking_toggle` all go through `camera/command`.
   - Check that the ROI start's `AiCancel` reaches the camera before the first ROI 0x07.
3. **Overlays freeze after the camera stops pushing.**
   - Cases: camera reboot, a link drop shorter than 3 s, FW without 0x5F.
   - `expire` must drop the track after 1 s and the boxes after 0.5 s even when no other frame arrives. Its 250 ms tick runs independently of reads.
   - After a reconnect, the 5 s 0x51 / 0x5F re-enable must bring the pushes back.
4. **Encoding change mid-flight.**
   - Until 0x20 answers, every click must be refused with `stream_unknown` (and not mapped onto the old size).
   - The 1 s 0x20 poll must resume.
   - The WHEP feed must recover after the resolution change; `useWhepFeed` reconnect is not covered by tests.
   - H.265 may not play in the browser at all (the note in the tab).
5. **Clock sync writes a wrong time.**
   - Causes: a stale FC sample, a Pi wall-clock step between the sample and its use, a 0x30 NACK, or `time_unix_usec == 0` before GPS lock.
   - The state machine never sends without a ≤ 5 s sample, and the router drops zero samples.
   - The sign convention (camera − GPS) must match the card's "+0.3 s".

---

### Task 1: Core types — caps, state, commands, refusals, joystick buttons

**Files:**
- Create: `crates/rgcs-core/src/camera_media.rs`. It holds the thermal / AI / encoding / storage / clock types, the MT11 presets and the validators. `camera.rs` is 776 lines, so these do not go there.
- Create: `crates/rgcs-core/src/camera_tests.rs`. The existing `camera.rs` `mod tests` moves here, pulled in with `#[cfg(test)] #[path = "camera_tests.rs"] mod tests;`, to make room for the new variants.
- Modify:
  - `crates/rgcs-core/src/camera.rs` (`CameraCaps`, `CameraCommand`, `CameraState`, `ButtonFunction`, `CameraProfile::needs_reload`);
  - `crates/rgcs-core/src/lib.rs` (`pub mod camera_media;` + re-exports).
- Modify: `crates/rgcs-camera/src/error.rs` (`CameraError::Refused(&'static str)`).
- Regenerated: `apps/rgcs-server/ui/src/shared/api/generated/{CameraCaps,CameraCommand,CameraState,ButtonFunction,ThermalCaps,ThermalGain,ThermalState,ThermalFrame,ThermalPoint,AiTrackingCaps,TrackState,TrackStatus,NormRect,Detection,EncodingPreset,VideoCodec,EncodingInfo,StorageInfo,StorageStatus,CameraClock,AiAck}.ts`.
- Modify (TS compile only):
  - `apps/rgcs-server/ui/src/shared/api/types.ts` (re-exports);
  - `features/gimbal-joystick/profile.ts` `BUTTON_FUNCTIONS`;
  - every UI `CameraCaps` / `CameraState` literal that tsc reports.

**Interfaces — Produces:**
```rust
// camera_media.rs — all: Debug, Clone, PartialEq, Serialize, Deserialize, TS, #[ts(export)];
// enums also Copy, Eq, snake_case. u64 fields carry #[ts(type = "number")].
pub enum ThermalGain { Low, High }
impl ThermalGain { pub fn range_c(self) -> (f32, f32); pub fn wire(self) -> u8; pub fn from_wire(b: u8) -> Option<Self>; }
pub struct ThermalCaps { pub gains: Vec<ThermalGain>, pub palettes: Vec<u8>, pub point_temp: bool, pub frame_temp: bool }
pub struct ThermalFrame { pub max_c: f32, pub min_c: f32, pub max_xy: (u16, u16), pub min_xy: (u16, u16) }
pub struct ThermalPoint { pub temp_c: f32, pub xy: (u16, u16), pub age_ms: u64 }
pub struct ThermalState { pub gain: Option<ThermalGain>, pub range_c: Option<(f32, f32)>,
    pub frame: Option<ThermalFrame>, pub point: Option<ThermalPoint> }
pub struct AiTrackingCaps { pub box_select: bool, pub point_select: bool, pub candidates: bool }
pub struct NormRect { pub x: f32, pub y: f32, pub w: f32, pub h: f32 }        // 0..1, top-left
pub enum TrackStatus { Tracking, Searching, Lost }
pub struct TrackState { pub status: TrackStatus, pub rect: NormRect, pub target: String, pub age_ms: u64 }
pub struct Detection { pub x0: f32, pub y0: f32, pub x1: f32, pub y1: f32, pub score: f32, pub class_id: u8, pub class_name: String }
/// Last 0x55 / 0x56 ACK as a fixed code; `seq` increments on every ACK so the UI can notice repeats.
pub struct AiAck { pub code: String, pub seq: u32 }
pub enum VideoCodec { H264, H265, Unknown }
pub struct EncodingPreset { pub id: String, pub label: String, pub codec: VideoCodec, pub width: u16, pub height: u16 }
pub fn mt11_encoding_presets() -> Vec<EncodingPreset>;            // the 5 presets, Python order
pub struct EncodingInfo { pub codec: VideoCodec, pub width: u16, pub height: u16, pub bitrate_kbps: u16, pub fps: Option<u8> }
pub enum StorageStatus { NotInserted, MountFailed, Ok, LowSpace, ReadOnly, ReadError, Unknown }
pub struct StorageInfo { pub status: StorageStatus, pub fs: String, pub total_gb: f32, pub free_gb: f32, pub free_pct: Option<f32> }
pub struct CameraClock { pub camera_unix_us: Option<u64>, pub reading_age_ms: Option<u64>, pub offset_ms: Option<f32>,
    pub rtt_ms: Option<f32>, pub synced_at_unix_ms: Option<u64>, pub error: Option<String> }
pub const MT11_PALETTES: [u8; 11] = [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
pub const AI_BOX_PX_RANGE: (u16, u16) = (32, 600);
pub const AI_BOX_PX_DEFAULT: u16 = 100;
pub const AI_CENTER_BOX_PX: u16 = 200;
```
- `CameraCaps` gains:
  - `thermal: Option<ThermalCaps>`;
  - `ai_tracking: Option<AiTrackingCaps>`;
  - `encoding_presets: Vec<EncodingPreset>`;
  - `storage_info: bool`;
  - `clock_sync: bool`.
- `CameraCaps::siyi_mt11()`:
  - `thermal`: gains `[Low, High]`, `MT11_PALETTES`, both temps true;
  - `ai_tracking`: all true;
  - the 5 encoding presets;
  - `storage_info` and `clock_sync` true.
- `CameraCaps::none()` has none of these.
- `CameraState` gains:
  - `encoding: Option<EncodingInfo>`, `thermal: Option<ThermalState>`;
  - `track: Option<TrackState>`, `candidates: Vec<Detection>`, `ai_ack: Option<AiAck>`;
  - `storage: Option<StorageInfo>`, `clock: Option<CameraClock>`.
  - `disconnected()` sets them to `None` / empty.
- `CameraCommand` gains (serde snake_case tags):
  - `ThermalGain{gain: ThermalGain}`, `ThermalPalette{palette: u8}`;
  - `MeasurePoint{x: f32, y: f32}`;
  - `AiSelectBox{x: f32, y: f32, box_px: Option<u16>}`, `AiSelectPoint{x: f32, y: f32}`, `AiCancel`;
  - `Encoding{preset: String}`, `SyncClock`.
  - `name()` returns the tag.
  - `supports()`:
    - `ThermalGain` → `thermal.gains` contains it;
    - `ThermalPalette` → `thermal.palettes` contains it;
    - `MeasurePoint` → `thermal.point_temp`;
    - `AiSelectBox` → `box_select`;
    - `AiSelectPoint` → `point_select`;
    - `AiCancel` → `ai_tracking.is_some()`;
    - `Encoding` → a preset with that id;
    - `SyncClock` → `clock_sync`.
- `impl CameraCommand { pub fn validate(&self) -> Result<(), ProfileError> }` checks:
  - x / y finite and in 0..=1 (field `x` / `y`);
  - `box_px` in 32..=600 (field `box_px`);
  - palette 0 or 2..=11 (field `palette`).
- `impl CameraProfile { pub fn needs_reload(&self, other: &Self) -> bool }` (ruling 7).
- `ButtonFunction` gains `ThermalGainToggle`, `AiTrackingToggle`, `FocusNear`, `FocusFar`. With snake_case these serialize as `thermal_gain_toggle`, `ai_tracking_toggle`, `focus_near`, `focus_far`.
- `CameraError::Refused(&'static str)` → `"refused: {0}"`.

- [ ] **Step 1: Write failing tests** in `camera_tests.rs` and a `camera_media.rs` `mod tests`:
  - `mt11_caps_cover_media`: thermal gains `[Low, High]` and 11 palettes, `ai_tracking` all true, preset ids are exactly the 5 in order, `storage_info && clock_sync`.
  - `none_caps_have_no_media`: every new cap is absent / false, and every new command is unsupported.
  - `supports_media_commands`:
    - `ThermalPalette{1}` is not supported, `{3}` is;
    - `Encoding{"h266_8k"}` is not supported, `{"h265_4k"}` is;
    - with `ai_tracking: None`, `AiCancel` is not supported.
  - `command_validation`:
    - `AiSelectBox{x: 1.1, ..}` → field `x`;
    - `MeasurePoint{y: NaN}` → field `y`;
    - `AiSelectBox{box_px: Some(31)}` and `Some(601)` → field `box_px`;
    - `Some(32)`, `Some(600)` and `None` are `Ok`;
    - `ThermalPalette{1}` → field `palette`.
  - `media_command_json_shape`:
    - `AiSelectBox{0.5, 0.5, None}` → `{"cmd":"ai_select_box","args":{"x":0.5,"y":0.5,"box_px":null}}`;
    - `SyncClock` → `{"cmd":"sync_clock"}`;
    - `ThermalGain{High}` → `{"cmd":"thermal_gain","args":{"gain":"high"}}`.
  - `gain_ranges`: `High.range_c() == (-20.0, 150.0)`, `Low.range_c() == (0.0, 550.0)`, `from_wire(1) == Some(High)`, `from_wire(2) == None`.
  - `needs_reload_only_for_connection_fields`: a change in `encoding_preset`, `thermal_palette`, `thermal_overlay`, `ai_box_px` or `auto_record` → `false`; a change in `host`, `port`, `kind` or `clock_sync` → `true`.
  - `new_button_functions_serialize`: `ThermalGainToggle` serializes as `"thermal_gain_toggle"`, `FocusNear` as `"focus_near"`, and both round-trip.
  - `disconnected_state_has_no_media`.
- [ ] **Step 2:** `cargo test -p rgcs-core camera`. Expected: FAIL to compile.
- [ ] **Step 3: Implement.** Fix every `CameraCaps { … }` / `CameraState { … }` literal (`cargo build --workspace` finds them, including `none.rs` and the ROI tests).
- [ ] **Step 4:** `cargo test -p rgcs-core` regenerates the bindings. Then `cargo test -p rgcs-camera -p rgcs-server --no-run`.
- [ ] **Step 5: UI compile.**
  - Re-export the new types.
  - Add the 4 functions to `BUTTON_FUNCTIONS`, and add `case` arms returning `null` in `buttonCommand` for now.
  - Extend the UI caps / state fixtures.
  - `npx tsc --noEmit -p tsconfig.app.json` and `npx vitest run src/features` must be clean / PASS.
- [ ] **Step 6:** commit `feat(core): MT11 thermal, AI, encoding, storage and clock types`.

### Task 2: Thermal + SD port (`siyi/thermal.rs`, `siyi/tf_card.rs`, encoders)

**Files:**
- Create: `crates/rgcs-camera/src/siyi/thermal.rs`, `crates/rgcs-camera/src/siyi/tf_card.rs`.
- Modify:
  - `crates/rgcs-camera/src/siyi/mod.rs`;
  - `crates/rgcs-camera/src/siyi/encode.rs` (encoders for 0x12 / 0x14 / 0x1B / 0x37 / 0x38 / 0x30 / 0x40 / 0x49);
  - `crates/rgcs-camera/src/siyi/parse.rs` (0x30 ACK, 0x40 reply).

**Interfaces — Produces:**
```rust
// thermal.rs
pub const NEGATIVE_THRESHOLD_C: f32 = 600.0;
pub const FRAME_MAX_AGE: Duration = Duration::from_secs(3);
pub const POINT_MAX_AGE: Duration = Duration::from_secs(15);
pub fn decode_temp(raw: u16) -> f32;                        // rounded to 0.01
pub fn parse_full_frame(p: &[u8]) -> Option<ThermalFrame>;  // 0x14, ≥ 12 bytes
pub fn parse_point(p: &[u8]) -> Option<(f32, (u16, u16))>;  // 0x12, ≥ 6 bytes
pub fn parse_gain(p: &[u8]) -> Option<ThermalGain>;         // 0x37 / 0x38 byte 0
// tf_card.rs
pub fn parse_tf_card(p: &[u8]) -> Option<StorageInfo>;      // ≥ 6 bytes; free_pct = free/total·100 (1 dp), None when total 0
// encode.rs
pub fn point_temp(x: u16, y: u16) -> [u8; 5];               // flag ONCE
pub fn full_frame_temp() -> [u8; 1];                        // [1]
pub fn thermal_gain(g: ThermalGain) -> [u8; 1];
pub fn thermal_palette(p: u8) -> [u8; 1];
pub fn utc_time(unix_us: u64) -> [u8; 8];
// parse.rs
pub fn utc_ack(p: &[u8]) -> Option<bool>;                   // 0x30: byte 0 == 1
pub fn camera_time(p: &[u8]) -> Option<u64>;                // 0x40: first 8 bytes LE
```

- [ ] **Step 1: Write failing tests** (1:1 with `test_thermal.py`, `test_tf_card.py` and the `TestTimeCommands` / `TestTfCard` / `TestThermal*` classes of `test_camera_protocol.py`):
  - `point_request_matches_sdk_example`: `point_temp(960, 540) == hex c0031c0201`.
  - `full_frame_request`: `[0x01]`.
  - `decode_temp_cases`: 1604 → 16.04; 55000 → 550.0; 64036 → −15.0.
  - `parse_hardware_samples`:
    - `6a08e6033e062000f4016203` → max 21.54, min 9.98, max_xy (1598, 32), min_xy (500, 866);
    - `4406c0031c02` → (16.04, (960, 540)).
  - `short_payloads`: 11 bytes / 5 bytes → `None`.
  - `gain_bytes`: `parse_gain([1]) == High`, `[0] == Low`, `[] == None`; `thermal_gain(High) == [1]`.
  - `tf_card_normal`: `<BBHH`(2, 2, 5820, 1234) → ok, `"exFAT"`, 58.2, 12.34, free_pct 21.2.
  - `tf_card_status_codes`: 0 / 1 / 3 / 4 / 5 → NotInserted / MountFailed / LowSpace / ReadOnly / ReadError; 9 → Unknown.
  - `tf_card_zero_total_has_no_pct`, `tf_card_short_payload`, and `tf_card_32gb`: (2, 1, 3200, 800) → 32.0 / 8.0, `"FAT32"`.
  - `utc_and_readback`: `utc_time(1_790_000_000_123_456)` is that value `to_le_bytes`; `camera_time(<QI>(1_790_000_000_000_000, 5000)) == Some(1_790_000_000_000_000)`; `utc_ack([1]) == Some(true)`, `[0] == Some(false)`.
  - `sd_info_is_0x49_never_0x48`: `frame::check_allowed(0x49).is_ok()`, and `0x48` → `Forbidden(0x48)`.
- [ ] **Step 2:** `cargo test -p rgcs-camera siyi::`. Expected: FAIL to compile.
- [ ] **Step 3: Implement.**
  - `decode_temp`:
    ```rust
    let c = f32::from(raw) / 100.0;
    let c = if c > NEGATIVE_THRESHOLD_C { (i32::from(raw) - 65536) as f32 / 100.0 } else { c };
    (c * 100.0).round() / 100.0
    ```
  - fs names: 0 `"unknown"`, 1 `"FAT32"`, 2 `"exFAT"`, else `"fs_{n}"`.
- [ ] **Step 4:** `cargo test -p rgcs-camera` → PASS. `cargo clippy -p rgcs-camera --all-targets -- -D warnings`.
- [ ] **Step 5:** commit `feat(camera): port MT11 thermal, SD card and clock codecs`.

### Task 3: AI tracking + encoding port (`siyi/ai.rs`)

**Files:**
- Create: `crates/rgcs-camera/src/siyi/ai.rs`. Tests go in `siyi/ai_tests.rs` via `#[path]` if the file passes 400 lines.
- Modify: `crates/rgcs-camera/src/siyi/mod.rs`.

**Interfaces — Produces:**
```rust
pub const TRACK_BASE: (f32, f32) = (1280.0, 720.0);
pub const TRACK_MAX_AGE: Duration = Duration::from_secs(1);
pub const DETECTION_HISTORY: Duration = Duration::from_millis(1500);
pub const DETECTION_HISTORY_MAX: usize = 60;
pub const DETECTION_LOOKBACK: Duration = Duration::from_secs(1);
pub const DETECTION_SHOW_MAX_AGE: Duration = Duration::from_millis(500);
pub const FOLLOW_MIN_IOU: f32 = 0.1;
#[derive(Debug, Clone, Copy, PartialEq, Eq)] pub struct StreamBox { pub lx: u16, pub ly: u16, pub rx: u16, pub ry: u16 }
#[derive(Debug, Clone, PartialEq)] pub struct DetectionFrame { pub model: u8, pub pts_us: u64, pub detections: Vec<Detection> }
pub enum ClickError { OutOfRange, StreamUnknown }
pub fn click_to_stream_box(nx: f32, ny: f32, w: u16, h: u16, box_px: u16) -> Result<StreamBox, ClickError>;
pub fn normalized_to_stream_point(nx: f32, ny: f32, w: u16, h: u16) -> (u16, u16);
pub fn encode_ai_select(b: Option<StreamBox>) -> [u8; 9];        // None = cancel
pub fn encode_ai_select_point(x: u16, y: u16) -> [u8; 9];
pub fn ai_mode(enable: bool) -> [u8; 1];                          // 0x55
pub fn track_push(enable: bool) -> [u8; 1];                       // 0x51
pub fn candidate_push(enable: bool) -> [u8; 1];                   // 0x5F: [5] / [4]
/// 0x50 → (status, rect, target name); `None` for short payloads; status 3 (cancelled) → Some with `None` status.
pub fn parse_track(p: &[u8]) -> Option<(Option<TrackStatus>, NormRect, String)>;
pub fn parse_candidates(p: &[u8]) -> Option<DetectionFrame>;     // header <BBQB + SoA
pub fn pick_detection(frames: &[&DetectionFrame], nx: f32, ny: f32) -> Option<Detection>;
pub fn ai_select_ack(p: &[u8]) -> Option<&'static str>;          // 0x56 byte 0
pub fn ai_mode_ack(p: &[u8]) -> Option<&'static str>;            // 0x55 byte 1
pub fn parse_encoding(p: &[u8]) -> Option<(u8, EncodingInfo)>;   // (stream_type, info), ≥ 8 bytes
pub fn encode_encoding(preset: &EncodingPreset) -> [u8; 9];       // stream 1, bitrate 0, fps 0
pub fn encoding_request() -> [u8; 1];                             // [1]
```
- `ai_select_ack` codes: 0 `failed`, 1 `ok`, 2 `not_ai_mode`, 3 `stream_unsupported`, 4 `low_texture`, 5 `stabilization_on`.
- `ai_mode_ack` codes: 0 `ok`, 1 `night_vision_box_only`, 2 `super_res_box_only`, 3 `stabilization_no_ai`, 4 `night_stab_no_ai`, 5 `super_res_stab_no_ai`.
- Unknown → `status_n` is not representable as `&'static str`, so unknown codes map to `"unknown"`.
- Class names: 0 `person`, 1 `car`, 2 `bus`, 3 `truck`, 255 `any` (0x50 only), else `class_{n}` (`String`).

- [ ] **Step 1: Write failing tests** (1:1 with `test_ai_tracking.py`; packet comparisons use `frame::make_packet(cmd, data, 1, 0)`):
  - `ai_select_box_matches_sdk_example`: box (200, 200, 400, 400) → packet `55 66 01 09 00 00 00 56 01 C8 00 C8 00 90 01 90 01 92 20`.
  - `ai_cancel_matches_sdk_example`: `… 56 00 00 00 00 00 00 00 00 00 2D 94`.
  - `ai_point_matches_sdk_example`: (960, 540) → `… 56 01 C0 03 1C 02 00 00 00 00 39 F9`.
  - `click_box_centres` (box 150):
    - 1080p → (885, 465, 1035, 615);
    - 4K → (1845, 1005, 1995, 1155);
    - 720p → (565, 285, 715, 435).
  - `click_box_edges_shift_inward` (1920 × 1080, box 150), and every size stays 150:
    - (0, 0) → (0, 0, 150, 150);
    - (1, 1) → (1769, 929, 1919, 1079);
    - (0.01, 0.99) → (0, 929, 150, 1079).
  - `click_box_larger_than_frame`: (0.5, 0.5, 400, 300, 600) → (0, 0, 399, 299).
  - `click_box_rejects`: x −0.1 or y 1.1 → `OutOfRange`; w = h = 0 → `StreamUnknown`.
  - `half_pixel_rounds_up_like_js`: box 151 → lx 885, box 149 → lx 886. Use `(c - s / 2.0 + 0.5).floor()`, never `round()`.
  - `stream_point`: (0.5, 0.5) → (960, 540); (1, 1) → (1919, 1079); (0, 0) → (0, 0).
  - `track_centre_to_top_left`: `<HHHHBB>`(640, 360, 128, 72, 0, 0) → rect (0.45, 0.45, 0.1, 0.1) ± 1e-6, `Tracking`, `"person"`.
  - `track_any_and_clamp`:
    - (100, 100, 20, 20, 255, 4) → `Tracking`, `"any"`;
    - (5, 5, 40, 40, 1, 1) → x = y = 0, `Searching`, `"car"`;
    - status 2 → `Lost`, status 3 → `None`;
    - 9 bytes → `None`.
  - `candidates_struct_of_arrays`:
    - the Python helper `candidate_payload` ported as a test fn;
    - two boxes ((0.1, 0.2, 0.3, 0.4, 0.9, 0), (0.5, 0.5, 0.7, 0.9, 0.5, 1)) → coordinates ± 1e-4, names person / car, score 0.5 ± 1e-4, pts 123456;
    - an empty frame → no detections;
    - truncated, or the enable ACK `[5, 0]` → `None`.
  - `pick_detection_cases` (the 4 Python cases):
    - no hit;
    - smallest containing box wins;
    - a hit in an older frame follows to the newest frame with the same class (IoU ≥ 0.1);
    - another class is not followed.
  - `encoding_parse`:
    - `<BBHHHB>`(1, 2, 3840, 2160, 16000, 30) → (1, H265 3840 × 2160, 16000, `Some(30)`);
    - without fps → `None`;
    - 3 bytes → `None`;
    - codec 9 → `Unknown`.
  - `encoding_encode`: `h264_1080p` → `<BBHHHB>`(1, 1, 1920, 1080, 0, 0); `h264_720p` → `01 01 00 05 D0 02 00 00 00`.
  - `ack_codes`: `ai_mode_ack([1, 3]) == "stabilization_no_ai"`, `ai_select_ack([4]) == "low_texture"`.
  - `push_enables`: `track_push(true) == [1]`, `candidate_push(true) == [5]`, `candidate_push(false) == [4]`, `ai_mode(true) == [1]`.
- [ ] **Step 2:** `cargo test -p rgcs-camera siyi::ai`. Expected: FAIL to compile.
- [ ] **Step 3: Implement** as `ai_tracking.py`. `pick_detection` uses `(area, -index)` minimum, then the best IoU among the newest frame's detections with the same class.
- [ ] **Step 4:** `cargo test -p rgcs-camera` → PASS; clippy clean.
- [ ] **Step 5:** commit `feat(camera): port MT11 AI tracking and encoding codecs`.

### Task 4: Clock sync state machine + router `SYSTEM_TIME`

**Files:**
- Create: `crates/rgcs-camera/src/clock_sync.rs`, with tests in `clock_sync_tests.rs` via `#[path]`.
- Modify: `crates/rgcs-camera/src/lib.rs` (`pub mod clock_sync;`), `crates/rgcs-camera/src/camera.rs` (the `GpsTime` trait).
- Modify: `crates/rgcs-mavlink/src/router.rs` (slot `system_time`, `pub fn system_time`).

**Interfaces — Produces:**
```rust
// camera.rs
#[derive(Debug, Clone, Copy, PartialEq, Eq)] pub struct TimeSample { pub unix_us: u64, pub age_us: u64 }
#[async_trait] pub trait GpsTime: Send + Sync { async fn sample(&self) -> Option<TimeSample>; }
// clock_sync.rs (times are the driver's monotonic µs)
pub const RESYNC_US: u64 = 600_000_000;
pub const SAMPLE_MAX_AGE_US: u64 = 5_000_000;
pub const READBACK_TIMEOUT_US: u64 = 1_000_000;
#[derive(Debug, Clone, Copy, PartialEq, Eq)] pub struct GpsSample { pub unix_us: u64, pub received_at_us: u64 }
pub fn current_unix_us(s: &GpsSample, now_us: u64) -> u64;
#[derive(Debug, Clone, Copy, PartialEq, Eq)] pub enum ClockAction { SetUtc(u64), ReadBack }
#[derive(Debug, Clone, PartialEq, Default)] pub struct ClockStatus {
    pub last_sync_at_us: Option<u64>, pub ok: Option<bool>, pub offset_ms: Option<f32>, pub rtt_ms: Option<f32>, pub error: Option<&'static str> }
#[derive(Debug, Clone, PartialEq)] pub struct ClockSync { /* pending, was_connected, readback: Option<(sent_at_us, GpsSample)>, status */ }
impl ClockSync {
    pub fn new() -> Self;                                            // pending, was_connected = true
    pub fn request(&self) -> Self;                                   // 今すぐ同期
    pub fn tick(&self, now_us: u64, connected: bool, sample: Option<GpsSample>) -> (Self, Vec<ClockAction>);
    pub fn on_camera_time(&self, camera_unix_us: u64, received_at_us: u64) -> Self;
    pub fn status(&self) -> &ClockStatus;
}
// router.rs
#[derive(Debug, Clone, Copy, PartialEq, Eq)] pub struct SystemTimeSample { pub unix_us: u64, pub received_unix_ms: u64 }
pub fn system_time(&self, sysid: SysId) -> Option<SystemTimeSample>;  // only time_unix_usec > 0
```
- Error codes: `no_gps_time`, `gps_time_stale`, `no_readback`.

- [ ] **Step 1: Write failing tests.** These port `test_time_sync.py`, with GPS_US = 1_790_000_000_000_000 and seconds × 1e6.
  - `current_unix_us_adds_elapsed`: received 10.0 s, now 10.25 s → GPS_US + 250_000.
  - `first_sync_sends_compensated_time`:
    - setup: now 100 s, sample received 99.5 s;
    - `tick` → `[SetUtc(GPS_US + 500_000), ReadBack]`;
    - then `on_camera_time(true time at 100.01 s, 100.02 s)` → `ok == Some(true)`, offset 0.0 ± 0.01, rtt 20.0.
  - `offset_sign_camera_ahead`: the camera answers 250 ms ahead → offset +250.0.
  - `no_gps_time_does_not_send`: `None` → no actions, error `no_gps_time`.
  - `stale_gps_time_does_not_send`: received 50 s, now 100 s → error `gps_time_stale`.
  - `resync_only_after_interval`: +300 s → no actions; +601 s → `SetUtc`.
  - `reconnect_triggers_sync`: a tick with `connected = false`, then `true` with a fresh sample → `SetUtc`.
  - `manual_request_triggers_sync`.
  - `readback_timeout_reports_error`: no `on_camera_time`; a tick at sent + 1.0 s → offset `None`, error `no_readback`, `ok == Some(true)` (0x30 was sent), and `pending` is cleared.
  - `poll_reply_before_sync_is_ignored`: `received_at_us < sent_at` does not set the offset.
  - `disconnected_skips`.
  - `ClockSync::new() == ClockSync::new()`: the state is a value, and `tick` leaves `self` unchanged.
  - Router `system_time_sample`:
    - `SYSTEM_TIME{time_unix_usec: 0}` → `None`;
    - `1_790_000_000_000_000` at `Clock{unix_ms: 5_000}` → `Some{…, received_unix_ms: 5_000}`;
    - it comes only from the FC component.
- [ ] **Step 2:** `cargo test -p rgcs-camera clock_sync` and `cargo test -p rgcs-mavlink router`. Expected: FAIL.
- [ ] **Step 3: Implement.** The algorithm (tests do not pin the read-back bookkeeping):
  ```rust
  fn tick(&self, now, connected, sample) -> (Self, Vec<ClockAction>) {
      let pending = self.pending || (connected && !self.was_connected);
      let base = Self { pending, was_connected: connected, ..self.clone() };
      let base = base.expire_readback(now);            // sent + READBACK_TIMEOUT_US ≤ now → error no_readback
      if !connected || base.readback.is_some() { return (base, vec![]) }
      let due = base.pending || base.status.last_sync_at_us.map_or(true, |t| now - t >= RESYNC_US);
      if !due { return (base, vec![]) }
      match sample {
          None => (base.with_error("no_gps_time"), vec![]),
          Some(s) if now.saturating_sub(s.received_at_us) > SAMPLE_MAX_AGE_US || s.received_at_us > now
              => (base.with_error("gps_time_stale"), vec![]),
          Some(s) => (Self { pending: false, readback: Some((now, s)),
                        status: ClockStatus { last_sync_at_us: Some(now), ok: Some(true), ..Default::default() }, ..base },
                      vec![ClockAction::SetUtc(current_unix_us(&s, now)), ClockAction::ReadBack]),
      }
  }
  // on_camera_time: if readback = (sent, s) and received ≥ sent:
  //   mid = (sent + received) / 2; offset_ms = (camera_us as i128 − current_unix_us(&s, mid) as i128) as f32 / 1000 (1 dp);
  //   rtt_ms = (received − sent) / 1000 (1 dp); readback = None; error = None.
  ```
  - Router: in `on_message`, match `MavMessage::SYSTEM_TIME(t)` with `t.time_unix_usec > 0` and store it in the slot.
- [ ] **Step 4:** both crates PASS; clippy clean.
- [ ] **Step 5:** commit `feat(camera): clock sync state machine and FC SYSTEM_TIME samples`.

### Task 5: MT11 simulator learns the new commands and pushes

**Files:**
- Create: `crates/rgcs-camera/src/siyi/sim_media.rs`. It holds the pure reply / push builders for the new commands and the `SimMedia` state, so `sim.rs` stays under 400 lines.
- Modify: `crates/rgcs-camera/src/siyi/sim.rs` (dispatch, push ticker in `serve_tcp`, test setters), `crates/rgcs-camera/src/siyi/mod.rs`.

**Interfaces — Produces:**
```rust
pub struct SimMedia {
    pub gain: u8, pub palette: u8, pub encoding: (u8, u16, u16),          // codec, w, h; default (1, 1920, 1080)
    pub tf: (u8, u8, u16, u16),                                           // default (2, 2, 12800, 5630)
    pub clock_offset_us: i64, pub utc_set_at: Option<(u64, Instant)>,     // 0x30 sets the sim clock
    pub ai_mode: bool, pub track_push: bool, pub candidate_push: bool,
    pub track: Option<(u16, u16, u16, u16)>,                              // centre-based on 1280×720
    pub frame_temps: [u16; 6],                                            // default the hardware sample 6a08…6203
    pub detections: Vec<(f32, f32, f32, f32, f32, u8)>,                   // default person (0.40,0.40,0.50,0.60,0.9,0), car (0.70,0.55,0.85,0.70,0.8,1)
}
pub fn media_reply(m: &mut SimMedia, cmd: u8, payload: &[u8], now: Instant, unix_now_us: u64) -> Option<(u8, Vec<u8>)>;
pub fn track_frame(m: &SimMedia) -> Option<Vec<u8>>;        // 0x50 payload while ai_mode && track_push && track.is_some()
pub fn candidate_frame(m: &SimMedia, pts_us: u64) -> Option<Vec<u8>>; // 0x5F payload while candidate_push
impl SimServer {
    pub fn set_tf_card(&self, status: u8, total_x100: u16, free_x100: u16);
    pub fn set_clock_offset_us(&self, offset: i64);
    pub fn lose_track(&self);                                // track status 2 on the next pushes
    pub fn set_detections(&self, d: Vec<(f32, f32, f32, f32, f32, u8)>);
}
```
- Replies:
  - **0x12** `<HHB` → `<3H>`(1604, x, y);
  - **0x14** → `frame_temps`;
  - **0x37** → `[gain]`;
  - **0x38** sets the gain → `[gain]`;
  - **0x1B** sets the palette → `[palette]`;
  - **0x20** `[1]` → `<BBHHHB>`(1, codec, w, h, 4000, 30); other stream types → `None`;
  - **0x21** sets the encoding → `[1, 1]`;
  - **0x30** → `[1]`, and the sim clock follows the sent time;
  - **0x40** → `<QI>`(sim unix µs, 0);
  - **0x49** → `tf`;
  - **0x51** `[e]` → `[e]`;
  - **0x55** `[e]` → `[e, 0]`;
  - **0x56**: a box sets `track` to the box centre / size scaled to 1280 × 720 → `[1]`. A point picks the detection containing it, else a 100 × 100 box at the point → `[1]`. A cancel clears `track` → `[1]`;
  - **0x5F** `[5]` / `[4]` → `[5, 0]` / `[4, 0]`.
- **0x48** is never answered (the client cannot send it anyway).
- Pushes from the per-connection 100 ms ticker in `serve_tcp`:
  - 0x50 every 100 ms;
  - 0x5F every 200 ms;
  - both skipped while frozen.

- [ ] **Step 1: Write failing tests** (sim `mod tests`):
  - `sim_point_temperature_reply`: `media_reply(0x12, point_temp(960, 540))` decodes with `thermal::parse_point` to (16.04, (960, 540)).
  - `sim_frame_reply_is_the_hardware_sample`: max 21.54.
  - `sim_gain_set_and_get`: 0x38 `[1]`, then 0x37 → High.
  - `sim_encoding_set_then_read`: 0x21 `h264_4k`, then 0x20 `[1]` → 3840 × 2160; 0x20 `[0]` → `None`.
  - `sim_clock_follows_utc_set`: 0x30 GPS_US, then 0x40 within 50 ms → within 60 ms of GPS_US.
  - `sim_select_box_starts_track_push`:
    - 0x55 `[1]`, 0x51 `[1]`, 0x56 box (885, 465, 1035, 615) on 1920 × 1080;
    - `track_frame` decodes to centre (0.5, 0.5) ± 0.01, `Tracking`;
    - after a cancel → `None`.
  - `sim_candidate_frame_roundtrip`: `parse_candidates(candidate_frame)` has 2 detections, person first.
  - `sim_tf_card_default`: 0x49 → ok, 128.0 / 56.3.
- [ ] **Step 2:** `cargo test -p rgcs-camera siyi::sim` (`sim` is compiled under `cfg(test)`). Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `reply_for` delegates unknown cmds to `media_reply`. `SimState` gains `media: SimMedia`.
  - `serve_tcp` becomes a `tokio::select!` over `read` and a 100 ms `interval`. Push frames use the same seq counter.
- [ ] **Step 4:** `cargo test -p rgcs-camera` → PASS. `cargo run -p rgcs-camera --features sim --example siyi_sim -- --port 37261` starts and logs.
- [ ] **Step 5:** commit `feat(camera): MT11 simulator answers thermal, AI, encoding, clock and SD commands`.

### Task 6: Driver — polls, frame application, new commands, expiry, clock sync

**Files:**
- Create:
  - `crates/rgcs-camera/src/siyi/apply.rs`: `apply_frame` moves here from `client.rs`, plus the new cmds;
  - `crates/rgcs-camera/src/siyi/exec.rs`: `exec`, `zoom_to`, `record` move here, plus the new commands and refusals;
  - `crates/rgcs-camera/src/siyi/polls.rs`;
  - `crates/rgcs-camera/src/siyi/expire.rs`;
  - `crates/rgcs-camera/src/siyi/client_tests.rs`: the existing client tests move here via `#[path]`, plus the new ones.
- Modify: `crates/rgcs-camera/src/siyi/client.rs` (session loop: 250 ms expiry tick, `Media` actor-local data, `GpsTime`, `with_gps_time`).

**Interfaces:**
- Consumes:
  - Tasks 1–5;
  - `Link::{tcp, udp}`;
  - `check_allowed`.
- Produces:
```rust
// client.rs
impl SiyiMt11 { pub fn with_gps_time(self, src: Arc<dyn GpsTime>) -> Self; }
// polls.rs — tick 0 is the first poll after connect, then +1 per second
pub fn due_polls(tick: u64, video_mode: Option<VideoMode>, stream_known: bool) -> Vec<(u8, Vec<u8>)>;
// apply.rs
pub struct Media { pub track_at: Option<Instant>, pub point_at: Option<Instant>, pub frame_at: Option<Instant>,
    pub candidates_at: Option<Instant>, pub history: Vec<(Instant, DetectionFrame)>, pub ack_seq: u32, pub clock: ClockSync,
    pub clock_read_at: Option<Instant> }
pub fn apply_frame(state: &CameraState, media: &Media, f: &Frame, now: Instant, mono_us: u64) -> (Option<CameraState>, Media);
// expire.rs
pub fn expire(state: &CameraState, media: &Media, now: Instant) -> Option<CameraState>;  // Some only when something changed
// exec.rs
pub async fn exec(link: &mut Link<'_>, state: &watch::Sender<CameraState>, media: &Media, cmd: CameraCommand) -> Result<Media, CameraError>;
```
- `due_polls`:
  - every tick: `0x0A`, `0x0D`, plus `0x14 [1]` when `video_mode == Some(Thermal)`;
  - `0x20 [1]` when `!stream_known || tick % 30 == 0`;
  - `tick % 5 == 0`: `0x40`, `0x51 [1]`, `0x5F [5]`;
  - `tick % 10 == 0`: `0x49`, `0x37`.
- `exec`, new arms:
  - `ThermalGain` → 0x38 then 0x37.
  - `ThermalPalette` → 0x1B.
  - `MeasurePoint`:
    - refused `thermal_only` unless the view is Thermal;
    - refused `stream_unknown` without `stream`;
    - else 0x12 at `normalized_to_stream_point`.
  - `AiSelectBox`:
    - refused `rgb_only` unless `video_mode == Some(Rgb)`;
    - then `stream_unknown`;
    - else 0x55 `[1]`, sleep 100 ms, 0x56 box. `box_px.unwrap_or(AI_BOX_PX_DEFAULT = 100)`.
  - `AiSelectPoint`:
    - same refusals;
    - frames from the last 1 s of `media.history`: if any, `pick_detection` (no hit → refused `no_detection`) and send its centre; if none, send the click point;
    - 0x55, 100 ms, 0x56 point.
  - `AiCancel` → 0x56 cancel.
  - `Encoding` → set `stream = None`, `encoding = None`, send 0x21, sleep 300 ms, send 0x20 `[1]`.
  - `SyncClock` → refused `clock_sync_off` without a `GpsTime`, else `media.clock.request()`.
  - `VideoMode` to Thermal / SideBySide with `track.is_some()` → also 0x56 cancel.
- On every 1 s poll tick, the session:
  - fetches `gps.sample()`, converting `age_us` to `received_at_us = mono_us − age_us`;
  - runs `media.clock.tick(...)`;
  - sends `SetUtc` → 0x30 and `ReadBack` → 0x40;
  - writes `state.clock` from `clock.status()` plus the last 0x40 reading:
    - `synced_at_unix_ms` is wall time at the sync;
    - `reading_age_ms` is set from `clock_read_at`;
    - the `error` code is copied.
- `disconnect` and session end also clear the media state (ruling 15).

- [ ] **Step 1: Write failing tests.**
  - `polls.rs`:
    - `tick0_has_everything_once`: tick 0 RGB, stream unknown → contains 0x0A, 0x0D, 0x20 [1], 0x40, 0x51 [1], 0x5F [5], 0x49, 0x37, and no 0x14.
    - `thermal_adds_0x14_every_tick`.
    - `encoding_polled_every_second_until_known`: tick 7, unknown → 0x20; known → none; tick 30 known → 0x20.
    - `never_0x48`: no tick 0..120 yields 0x48.
  - `apply.rs`:
    - `apply_0x20_main_only`: 0x20 stream_type 1 1920 × 1080 → `stream == Some((1920, 1080))` and `encoding.codec == H264`; type 0 → unchanged.
    - `apply_thermal_frames`: 0x14 / 0x12 / 0x37 set `thermal.frame` / `point` (age 0) / `gain` with `range_c` (−20, 150).
    - `apply_track_and_cancel`: 0x50 status 0 → `track.status == Tracking`; status 3 → `track == None`.
    - `apply_candidates_history`:
      - an enable ACK is ignored;
      - frames at t, t + 1 s, then t + 3 s → history length 2 then 1 (1.5 s window);
      - 61 frames in 1 s → length 60;
      - `state.candidates` = newest.
    - `apply_acks`:
      - 0x56 `[4]` → `ai_ack {code: "low_texture", seq: 1}`; again → seq 2;
      - 0x55 `[1, 3]` → `"stabilization_no_ai"`.
    - `apply_tf_and_clock`: 0x49 → `storage`; 0x40 → `clock.camera_unix_us`, and `media.clock.on_camera_time` is called.
  - `expire.rs`: `expire_drops_stale_overlays`:
    - track at −1.1 s → `None`;
    - candidates at −0.6 s → empty;
    - frame at −3.1 s → `None`;
    - point at −15.1 s → `None`;
    - all fresh → `None` (no change).
  - `client_tests.rs` (async, against `SimServer`):
    - `connect_polls_media`: within 1.5 s the sim sees 0x20 [1], 0x49, 0x37, 0x40, 0x51 [1], 0x5F [5], and the state has `stream (1920, 1080)`, `storage.status Ok`, a thermal gain, `camera_unix_us`.
    - `click_track_flow`:
      - `AiSelectBox{0.5, 0.5, Some(150)}` → the sim sees 0x55 [1] then 0x56 `01 75 03 D1 01 0B 04 67 02` (885, 465, 1035, 615);
      - `state.track.status == Tracking` within 1 s;
      - `AiCancel` → `track == None` within 1.5 s (expiry or status 3).
    - `click_refused_outside_rgb`: after `VideoMode{Thermal}` → `Err(Refused("rgb_only"))`.
    - `encoding_change_refuses_clicks_until_reread`:
      - `Encoding{"h264_4k"}`; immediately `AiSelectBox` → `Refused("stream_unknown")`;
      - within 2 s `stream == Some((3840, 2160))`, and a click then succeeds.
    - `ctrl_click_picks_detection`: wait for candidates; `AiSelectPoint{0.45, 0.5}` → the sim sees 0x56 point at the person's centre (864, 540) ± 1 px.
    - `ctrl_click_miss_is_refused`: (0.05, 0.05) with detections present → `Refused("no_detection")`.
    - `alt_click_requires_thermal`: `MeasurePoint` in RGB → `Refused("thermal_only")`; in Thermal → the sim sees 0x12 `c0 03 1c 02 01` and `state.thermal.point.temp_c == 16.04`.
    - `ir_switch_cancels_tracking`: while tracking, `VideoMode{Thermal}` → the sim sees 0x56 cancel.
    - `clock_sync_with_fake_gps`:
      - a `FakeGps` returns GPS_US with age 0;
      - within 2 s the sim sees 0x30 (value within 50 ms of GPS_US) and 0x40;
      - `state.clock.offset_ms` is `Some`, with |offset| < 100;
      - `SyncClock` → a second 0x30.
    - `sync_clock_without_source_refused` → `Refused("clock_sync_off")`.
    - `format_sd_can_never_be_sent` (kept).
- [ ] **Step 2:** `cargo test -p rgcs-camera`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Move the code first with no behaviour change (the existing tests pass), then add the new paths.
  - The session loop gains `expire_tick = interval(250 ms)`.
  - `Media` lives in the session and is replaced, not mutated: `media = next`.
- [ ] **Step 4:** `cargo test -p rgcs-camera` → PASS. Clippy clean. `wc -l` of every `siyi/*.rs` ≤ 400.
- [ ] **Step 5:** commit `feat(camera): MT11 driver polls, applies and sends thermal, AI, encoding, SD and clock`.

### Task 7: Server — wiring, validation, interlock, reload, throttle, auto record

**Files:**
- Create:
  - `apps/rgcs-server/src/gps_time.rs` (`RouterGpsTime`);
  - `apps/rgcs-server/src/auto_record.rs` (pure `decide` / `sd_warning` + runner task).
- Modify:
  - `apps/rgcs-server/src/cameras.rs` (time-source factory, `forward` throttle);
  - `apps/rgcs-server/src/camera_api.rs` (validate, default `box_px`, `Refused` → 409, AI stops ROI, `needs_reload`);
  - `apps/rgcs-server/src/roi.rs` (`start` sends `AiCancel`);
  - `apps/rgcs-server/src/app.rs` (install the factory, spawn auto record);
  - `apps/rgcs-server/src/lib.rs`.

**Interfaces:**
- Consumes: `Router::system_time`, `SiyiMt11::with_gps_time`, `CameraCommand::validate`, `CameraProfile::needs_reload`, `RoiHub::stop`, `roi_api::audit_manual_stop`, `MessageLog::submit`.
- Produces:
```rust
// gps_time.rs
pub struct RouterGpsTime { router: Arc<Mutex<Router>>, sysid: SysId }
#[async_trait] impl GpsTime for RouterGpsTime { async fn sample(&self) -> Option<TimeSample>; } // age from wall now − received_unix_ms; None if negative
// cameras.rs
pub type GpsTimeFactory = Arc<dyn Fn(SysId) -> Arc<dyn GpsTime> + Send + Sync>;
impl CameraManager { pub fn set_gps_time(&self, f: GpsTimeFactory); }   // used by build() when profile.clock_sync
pub const STATE_MIN_GAP: Duration = Duration::from_millis(100);
// auto_record.rs
pub fn decide(prev_armed: Option<bool>, armed: bool, enabled: bool, rec: RecordingState) -> Option<CameraCommand>;
pub fn sd_warning(storage: Option<&StorageInfo>, rec: RecordingState) -> bool;
pub fn spawn(app: AppState) -> JoinHandle<()>;                         // 2 Hz over router.states()
```
- `camera_api::command` order:
  1. `ws_only`;
  2. `cmd.validate()` → `400 validation`;
  3. the `box_px: None` default from `store.camera_profile(sysid).ai_box_px`;
  4. the ROI cancel (manual commands and now `AiSelectBox` / `AiSelectPoint` with reason `ai_tracking`);
  5. `cameras.send`;
  6. errors: `Refused(code)` → `409 code`;
  7. audit as today, with the refusal code as the reason.
- `put_profile` reloads only when `base.needs_reload(&profile)`.
- `RoiHub::start`: after the caps / connected / set checks, if `caps.ai_tracking.is_some()`, it sends `cameras.send(sysid, AiCancel)` with `SEND_TIMEOUT` (error → `tracing::warn!`) before dispatching `Cmd::Start`.
- The auto-record warning text is the fixed code `sd_card_problem`, severity 4 (warning), translated by the UI like `comms_delay`.

- [ ] **Step 1: Write failing tests.**
  - `auto_record.rs`:
    - `decide`:
      - (None, true, true, Idle) → `None` (first sight);
      - (Some(false), true, true, Idle) → `RecordStart`;
      - (Some(false), true, true, Recording) → `None`;
      - (Some(true), false, true, Recording) → `RecordStop`;
      - (Some(false), true, false, Idle) → `None`.
    - `sd_warning`: `NotInserted` → true; `Ok` with `NoCard` → true; `Ok` + `Idle` → false; `None` storage + `Idle` → false.
  - `gps_time.rs`: with a router fed `SYSTEM_TIME` at `unix_ms` = now − 300 → `age_us` ≈ 300_000 (± 50_000); with a future `received` → `None`.
  - `cameras.rs`: `forward_caps_bursts_at_10_hz`. 50 watch changes within 200 ms → at most 4 broadcasts in that window, and the last broadcast carries the final state.
  - Server integration tests in `apps/rgcs-server/tests/camera_flow.rs` and `roi_flow.rs` (the existing `common` harness with `CameraFactory::Sim`; the self dev-dependency enables `sim`):
    - `ai_select_box_out_of_range_is_400`: `{"cmd":"ai_select_box","args":{"x":1.5,"y":0.5,"box_px":null}}` → 400 `validation`.
    - `ai_select_box_uses_profile_box_px`: profile `ai_box_px` 150 → the sim sees 0x56 box width 150.
    - `ai_click_in_ir_is_409_rgb_only`.
    - `ai_select_stops_roi`: with an active ROI, `ai_select_box` → `roi.active_target` `None`, and the audit has `roi/stop` with reason `ai_tracking`.
    - `roi_start_cancels_ai_tracking`: the sim sees 0x56 cancel before the first 0x07 of the ROI.
    - `profile_put_video_fields_keeps_driver`: PUT `{encoding_preset: "h265_4k", ai_box_px: 200}` → no reconnect (the sim sees no second 0x01) and ROI still active. PUT `{host: "127.0.0.2"}` → a reload.
    - `measure_point_unsupported_on_none_camera_is_409`: `unsupported_capability`.
- [ ] **Step 2:** `cargo test -p rgcs-server --lib -- auto_record gps_time cameras` and `cargo test -p rgcs-server --test camera_flow --test roi_flow`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `forward`:
    ```rust
    loop {
        send(current);
        let deadline = Instant::now() + RESEND_EVERY;
        select! { changed => {}, sleep_until(deadline) => {} }
        sleep(STATE_MIN_GAP - since_last_send).await;   // collapse bursts; the next loop sends the newest state
    }
    ```
  - The auto-record runner skips vehicles without a camera entry, or whose caps lack `record`. It sends through `cameras.send` and audits (operator `auto_record`, target `camera`). With `sd_warning`, it submits a `VehicleMessage` with severity 4 and text `sd_card_problem`.
- [ ] **Step 4:** `cargo test -p rgcs-server` → PASS; clippy clean.
- [ ] **Step 5:** commit `feat(server): MT11 media commands, ROI/AI interlock, clock source, auto record`.

### Task 8: UI — status texts, camera card, status row, connection tab SD / clock

**Files:**
- Create:
  - `apps/rgcs-server/ui/src/features/camera/mediaFormat.ts` (+ `.test.ts`);
  - `apps/rgcs-server/ui/src/features/camera/profileStore.ts` (+ `.test.ts`);
  - `apps/rgcs-server/ui/src/shared/i18n/cameraMedia.ts` (ja / en, merged in `index.ts`).
- Modify:
  - `features/video/CamCard.tsx` (+ test in `Cockpit.test.tsx`);
  - `features/video/Cockpit.tsx` (`videoText` with encoding);
  - `features/camera/CameraStatusRow.tsx` (+ test);
  - `features/camera-settings/ConnectionTab.tsx`;
  - `features/camera-settings/CameraSettingsSheet.test.tsx`;
  - `app/Shell.tsx` (pass `onSyncClock`);
  - `shared/i18n/index.ts`.

**Interfaces — Produces:**
```ts
// mediaFormat.ts
export function thermalText(t: ThermalState | null | undefined): string | null   // 'High  68.4 / 11.2℃'; gain only → 'High'
export function sdText(s: StorageInfo | null | undefined): string | null        // '56.3 / 128 GB  44%'; not ok → dict status
export function sdDanger(s: StorageInfo | null | undefined): boolean            // status !== 'ok' || free_pct < 10
export function clockText(c: CameraClock | null | undefined, dict: Dict): string // 'GPS 同期 +0.3 s' / error text / '—'
export function clockDanger(c: CameraClock | null | undefined): boolean          // |offset_ms| > 1000 || error
export function encodingLabel(e: EncodingInfo | null | undefined): string | null // 'H.265 1080p', 'H.264 720p', 'H.264 4K'
export function trackLabel(t: TrackState | null | undefined, dict: Dict): string | null // 追跡中 / 再捕捉中 / 見失い
// profileStore.ts — the cockpit needs ai_box_px and thermal_overlay without opening the sheet
export function useCameraProfile(sysid: number | null): CameraProfile | null
export const cameraProfileStore: { set(sysid: number, p: CameraProfile): void; invalidate(sysid: number): void }
```
- `CamCard` rows, in prototype order, each only when its cap exists:
  - ジンバル;
  - ROI;
  - サーマル (`caps.thermal && state.thermal`);
  - SD カード (`caps.storage_info`; `style={{ color: 'var(--danger)' }}` when `sdDanger`);
  - カメラ時刻 (`caps.clock_sync`; danger colour when `clockDanger`);
  - 映像 (`[encodingLabel, source, delay].filter(Boolean).join('  ')`).
- `CameraStatusRow`: after the ROI part, `sep` + `trackLabel` when `state.track`; class `caution` for `lost` / `searching`.
- `ConnectionTab`:
  - SD row = `sdText` (danger colour), else 不明.
  - Clock row = `clockText` + 「今すぐ同期」 `btn btn-sm`. It is enabled when `connected && caps.clock_sync` and calls `onSyncClock()`, which sends `{cmd: 'sync_clock'}` through the existing `cameraCommand` path. A failure lands in the log (`camErr_clock_sync_off`).
- i18n:
  - `trackSearching`;
  - `sdStatus_*` (6);
  - `clockGps` 'GPS 同期';
  - `camErr_rgb_only` / `_thermal_only` / `_stream_unknown` / `_no_detection` / `_clock_sync_off`;
  - `aiAck_*` (5 + `unknown`);
  - `sd_card_problem` (message code: 'SD カードが未挿入またはエラーです(自動録画)');
  - the 映像 tab labels (Task 9).

- [ ] **Step 1: Write failing tests.**
  - `mediaFormat.test.ts`:
    - `thermalText({gain: 'high', range_c: [-20, 150], frame: {max_c: 68.4, min_c: 11.2, …}, point: null})` → `'High  68.4 / 11.2℃'`;
    - `sdText({status: 'ok', fs: 'exFAT', total_gb: 128, free_gb: 56.3, free_pct: 44})` → `'56.3 / 128 GB  44%'`;
    - `sdDanger`: free_pct 9 → true; status `not_inserted` → true; 44 / ok → false;
    - `clockText`: offset 300 → 'GPS 同期 +0.3 s'; offset −1200 → 'GPS 同期 −1.2 s', and `clockDanger` true; error `no_gps_time` → the translated text; null → '—';
    - `encodingLabel`: H265 1920 × 1080 → 'H.265 1080p'; 3840 × 2160 → '4K'; 1280 × 720 → '720p';
    - `trackLabel`: tracking → '追跡中', lost → '見失い'.
  - `Cockpit.test.tsx`:
    - with MT11 caps + thermal / storage / clock state, the card shows サーマル `High  41.2 / 9.8℃`, SD `11.0 / 128 GB  9%` with the danger colour, カメラ時刻 `GPS 同期 +0.3 s`, and 映像 starting `H.265 1080p`;
    - with `caps.thermal: null` there is no サーマル row.
  - `CameraStatusRow.test.tsx`: track `tracking` → '追跡中' after a `sep`; `lost` → '見失い' with class `caution`.
  - `CameraSettingsSheet.test.tsx`: the connection tab shows `11.0 / 128 GB  9%` and `GPS 同期 +0.3 s`; 「今すぐ同期」 is enabled and its click calls `onSyncClock`; disconnected → disabled.
  - `profileStore.test.ts`: `useCameraProfile(2)` fetches once (mock `getCameraProfile`), `set` updates subscribers, and `invalidate` refetches.
- [ ] **Step 2:** `npx vitest run src/features/camera src/features/video src/features/camera-settings`. Expected: FAIL.
- [ ] **Step 3: Implement.** Reuse prototype classes only (`.kv`, `.inset`, `.btn btn-sm`, `.sep`, `.danger`, `.caution`).
- [ ] **Step 4:** tsc clean; vitest PASS.
- [ ] **Step 5:** commit `feat(ui): thermal, SD, clock and tracking status rows`.

### Task 9: UI — 映像 tab and save flow

**Files:**
- Create:
  - `apps/rgcs-server/ui/src/features/camera-settings/VideoTab.tsx`;
  - `apps/rgcs-server/ui/src/features/camera-settings/videoSchema.ts` (+ `.test.ts`).
- Modify:
  - `features/camera-settings/CameraSettingsSheet.tsx` (+ test): 4th tab, `SheetDraft.video`, `caps` prop;
  - `app/useCameraSettingsFlow.ts` (+ test if present, else a new `useCameraSettingsFlow.test.ts` for `videoSteps`);
  - `app/Shell.tsx` (pass `caps`).

**Interfaces — Produces:**
```ts
export const ENCODING_IDS = ['h264_720p', 'h264_1080p', 'h264_4k', 'h265_1080p', 'h265_4k'] as const
export const PALETTES: readonly { id: number; label: string }[]   // prototype 1469, 11 entries
export const videoSchema: z.ZodObject<{ encoding_preset, thermal_palette, thermal_overlay, ai_box_px, auto_record, gain }>
  // palette 0 | 2..11; ai_box_px int 32..600; gain 'high' | 'low' | null
export type VideoDraft = z.infer<typeof videoSchema>
export function startVideoDraft(p: CameraProfile, s: CameraState | undefined): VideoDraft
/** Profile patch (stored fields that changed) + camera commands for the live values (ruling 7). */
export function videoSteps(p: CameraProfile, s: CameraState | undefined, d: VideoDraft, connectionChanged: boolean):
  { readonly patch: Partial<CameraProfile> | null; readonly commands: readonly CameraCommand[] }
// CameraSettingsSheet: Tab = 'connection' | 'input' | 'roi' | 'video'; SheetDraft gains `video: VideoDraft`; Props gain `caps: CameraCaps | undefined`
```
- `VideoTab` markup follows prototype 1277–1290:
  - `.form` rows: エンコード `select.in` (labels from `caps.encoding_presets`), パレット `select.in`;
  - ゲイン `.seg.sm` (High / Low, width 200) with the `.t3` range line (`rangeHigh` / `rangeLow`);
  - 温度表示 `.seg.sm` (On / Off, width 120);
  - 追跡ボックス `input.in.num` + `px`;
  - then ARM で自動録画 `.seg.sm`;
  - then the `.t3` note.
  - Rows are gated per cap: encoding by `caps.encoding_presets.length > 0`, palette / gain / overlay by `caps.thermal`, box by `caps.ai_tracking`. Auto record is always shown for a configured camera.
  - With `kind === 'none'`, the tab shows the `noneNote` text.
- Save: the `cameraSteps`, then the video patch PUT (when non-null), then the `commands` through `sendCameraCommand` (only when `!connectionChanged`), then ROI and input as today.
  - `cameraProfileStore.set` runs with the PUT result.
  - Any failure → `report(sysid, e)`.

- [ ] **Step 1: Write failing tests.**
  - `videoSchema.test.ts`: `ai_box_px` 31 / 601 / 100.5 → issue path `ai_box_px`; palette 1 → `thermal_palette`; the defaults from `CameraProfile.default` parse.
  - `videoSteps`:
    - nothing changed → `{patch: null, commands: []}`;
    - encoding changed → patch `{encoding_preset: 'h265_4k'}` + command `{cmd: 'encoding', args: {preset: 'h265_4k'}}`;
    - palette 3 → 5 → patch + `thermal_palette` command;
    - gain differs from `state.thermal.gain` → only the `thermal_gain` command (no patch);
    - `ai_box_px` / `thermal_overlay` / `auto_record` → patch only;
    - `connectionChanged: true` → patch kept, `commands: []`.
  - `CameraSettingsSheet.test.tsx`:
    - the 映像 tab is enabled (no 準備中 title) and switching shows エンコード with 5 options, パレット with 11, and ゲイン High `on` from state;
    - an invalid box (20) marks the input `invalid` and disables 保存;
    - MAVLink / none caps hide エンコード〜追跡ボックス.
- [ ] **Step 2:** `npx vitest run src/features/camera-settings src/app`. Expected: FAIL.
- [ ] **Step 3: Implement.** Remove the `comingSoon` 映像 button. The `lens` index uses `TABS.indexOf(tab)` with 4 tabs.
- [ ] **Step 4:** tsc clean; vitest PASS.
- [ ] **Step 5:** commit `feat(ui): camera settings video tab`.

### Task 10: UI — cockpit overlays, clicks, AI追跡, joystick functions; docs; live check

**Files:**
- Create:
  - `apps/rgcs-server/ui/src/features/video/geometry.ts` (+ `.test.ts`);
  - `apps/rgcs-server/ui/src/features/video/clickAction.ts` (+ `.test.ts`);
  - `apps/rgcs-server/ui/src/features/video/VideoOverlay.tsx` (+ `.test.tsx`).
- Modify:
  - `features/video/Cockpit.tsx` (+ test): overlay layer, click handler, preview box, `ai_ack` → log;
  - `features/video/CamBar.tsx`: AI追跡 button;
  - `styles/app.css`: `.cockpit-overlay { position:absolute; inset:0 }`, `.cand` (detection box: 1px solid `#9cdcff`, radius 3px, `pointer-events:none`), `cursor: crosshair` when clickable. Not `prototype.css`.
  - `features/gimbal-joystick/{buttons,mapping,loop}.ts` (+ tests): new functions and release edges;
  - `app/Shell.tsx` (`onRelease` → `focus 0`).
- Docs: `docs/spec/40-camera-gimbal.md`, `docs/spec/10-screens.md`, `docs/spec/50-api.md`.

**Interfaces — Produces:**
```ts
// geometry.ts (port of video_geometry.js, cover instead of contain — ruling 13)
export interface Rect { readonly x: number; readonly y: number; readonly w: number; readonly h: number }
export function coverRect(elW: number, elH: number, vidW: number, vidH: number): Rect | null
export function toNormalized(px: number, py: number, r: Rect | null): { nx: number; ny: number } | null
export function rectToDisplay(b: NormRect, r: Rect): Rect
export function detectionToDisplay(d: Detection, r: Rect): Rect
export function pointToDisplay(xy: readonly [number, number], stream: readonly [number, number], r: Rect): { x: number; y: number }
export function previewBox(nx: number, ny: number, r: Rect, sw: number, sh: number, boxPx: number): Rect
// clickAction.ts
export type ClickResult = { kind: 'command'; cmd: CameraCommand } | { kind: 'refuse'; code: 'rgb_only' | 'thermal_only' | 'stream_unknown' } | null
export function clickAction(mods: { ctrl: boolean; meta: boolean; alt: boolean }, nx: number, ny: number,
  state: CameraState, caps: CameraCaps, boxPx: number): ClickResult
// buttons.ts additions
// thermal_gain_toggle → {cmd:'thermal_gain', args:{gain: state.thermal?.gain === 'high' ? 'low' : 'high'}}
// ai_tracking_toggle → state.track ? {cmd:'ai_cancel'} : {cmd:'ai_select_box', args:{x:0.5, y:0.5, box_px:200}}
// focus_near → {cmd:'focus', args:{dir:-1}}; focus_far → {cmd:'focus', args:{dir:1}}
export function releaseCommand(fn: ButtonFunction): CameraCommand | null   // focus_* → {cmd:'focus', args:{dir:0}}
// mapping.ts
export function buttonReleases(prev: readonly boolean[], now: readonly boolean[], p: GimbalInputProfile): ButtonFunction[]
// loop.ts: LoopDeps gains `readonly onRelease?: (fn: ButtonFunction) => void`
```
- `clickAction` rules:
  - Alt + IR + `caps.thermal.point_temp` → `measure_point`; Alt elsewhere → refuse `thermal_only`.
  - Ctrl / ⌘ + RGB → `ai_select_point`.
  - Plain + RGB → `ai_select_box` with `boxPx`.
  - In 2画面 → `null`. Not RGB (IR) without Alt → refuse `rgb_only`.
  - `state.stream === null` → refuse `stream_unknown`. The server checks again.
  - Without `caps.ai_tracking` → `null`.
- `VideoOverlay` draws inside `.cockpit-overlay`:
  - `.trk` + `.tracking` / `.lost` with `<span className="tag">`, from `state.track` via `rectToDisplay`;
  - the preview `.trk` from the last click until a track arrives or 1.5 s pass;
  - `.cand` boxes from `state.candidates` (RGB only);
  - in IR with `profile.thermal_overlay`: `.tmark.hot` / `.tmark.cold` from `thermal.frame` and a `.tmark` (no colour class) for `thermal.point` (15 s server-side), via `pointToDisplay` with `state.stream`.
  - The rect comes from the `<video>` element's `clientWidth` / `clientHeight` and `videoWidth` / `videoHeight`, kept in state through `ResizeObserver` + `loadedmetadata`.
- `CamBar`: when `caps.ai_tracking`, an AI追跡 `button.btn.btn-sm` (`on` while `state.track`), placed after centre (prototype 785).
  - Click: `state.track` → `ai_cancel`, else `ai_select_box` at centre with `box_px` 200.
  - Disabled with title `camErr_rgb_only` unless RGB.
- `Cockpit`:
  - a refusal or a rejected command → `vehicleStore.pushLocalResult({cmd: 'ai_track' | 'measure_point', ok: false, reason: dict['camErr_' + code]})`;
  - an `ai_ack` with a new `seq` and code ≠ `ok` → the same log path (`aiAck_<code>`);
  - `onContextMenu` → `preventDefault`.

- [ ] **Step 1: Write failing tests.**
  - `geometry.test.ts`:
    - `coverRect(1000, 400, 1920, 1080)` → w 1000, h 562.5, x 0, y −81.25;
    - `coverRect(640, 480, 1280, 720)` → h 480, w 853.33 ± 0.01, x −106.67 ± 0.01, y 0;
    - unknown sizes → null;
    - `toNormalized(320, 240, coverRect(640, 480, 1280, 720))` → (0.5, 0.5); null rect → null;
    - `previewBox` (half-size display of 1920 × 1080, box 150) → {x: 442.5, y: 232.5, w: 75, h: 75}; corner (1, 1) → {x: 884.5, y: 464.5, …};
    - box 151 / 149 at full size → x 885 / 886;
    - `rectToDisplay({x: 0.25, y: 0.5, w: 0.1, h: 0.2}, {x: 100, y: 50, w: 800, h: 450})` → {300, 275, 80, 90};
    - `detectionToDisplay` → {300, 275, 200, 225};
    - `pointToDisplay([960, 540], [1920, 1080], {x: 0, y: −81.25, w: 1000, h: 562.5})` → (500, 200).
  - `clickAction.test.ts`, one case per rule above, plus:
    - Ctrl with `meta` on macOS → `ai_select_point`;
    - SBS → null;
    - stream null → refuse `stream_unknown`;
    - `boxPx` from the profile (150) lands in `args.box_px`.
  - `VideoOverlay.test.tsx`:
    - a tracking state → `.trk.tracking` at `left: 450px` for rect {0, 0, 1000, 562.5} and track x 0.45, tag '追跡中';
    - lost → `.trk.lost` and '見失い';
    - IR + `thermal_overlay` → `.tmark.hot` text `68.4℃` and `.tmark.cold` `11.2℃`;
    - `thermal_overlay: false` → none;
    - RGB with 2 candidates → 2 `.cand`.
  - `Cockpit.test.tsx`:
    - clicking the overlay at the centre (mocked rect) calls `onCommand({cmd: 'ai_select_box', args: {x: 0.5, y: 0.5, box_px: 100}})`;
    - Alt+click in IR → `measure_point`;
    - the AI追跡 button exists with MT11 caps and not with MAVLink caps, and is `on` while tracking.
  - `buttons.test.ts`:
    - `thermal_gain_toggle`: high → low; unknown → high;
    - `ai_tracking_toggle`: tracking → `ai_cancel`; idle → box at centre with 200;
    - `focus_near` → dir −1; `releaseCommand('focus_far')` → dir 0; `releaseCommand('shutter')` → null.
  - `mapping.test.ts`: `buttonReleases([true], [false], …)` → `['focus_near']` for a mapped button; a held button → `[]`.
  - `loop.test.ts`: a press then release of a `focus_far` button calls `onButton('focus_far')` then `onRelease('focus_far')`.
- [ ] **Step 2:** `npx vitest run src/features/video src/features/gimbal-joystick`. Expected: FAIL.
- [ ] **Step 3: Implement.** In `Shell.tsx`, `useGimbalJoystick` takes an `onRelease` handler that sends `releaseCommand(fn)` for `current` through `cameraCommand`.
- [ ] **Step 4: Docs.**
  - **Spec 40:**
    - §7.1: move thermal / AI / encoding / clock / SD from 未実装 to implemented (2026-10-23), with the module names.
    - §1.2: the final command list (rulings 2 / 3).
    - §1.3: the coordinate note (ruling 1) and the field names.
    - §3: the poll schedule.
    - §5: the offset display (ruling 6) and the `GpsTime` source (ruling 5).
    - §6: the 4 buttons implemented.
  - **Spec 10:**
    - §4: drop the "サーマル温度・AI 追跡・SD・時刻同期 … 出さない" sentence.
    - §4.2: cover geometry, ⌘ + click, the preview box (rulings 10 / 13 / 14).
    - §5: the 映像 tab save semantics (ruling 7).
  - **Spec 50:**
    - §2.3: the refusal codes (ruling 4), the narrowed reload (ruling 7), `box_px` defaulting;
    - §3.1: the 10 Hz cap (ruling 8).
  - **Spec 70 §3:** the auto-record runner and `sd_card_problem` (ruling 12).
- [ ] **Step 5: Full checks.**
  - `npx tsc --noEmit -p tsconfig.app.json`.
  - `npx vitest run`.
  - `cargo test --workspace`.
  - `cargo clippy --workspace --all-targets -- -D warnings`.
- [ ] **Step 6: Live check on a scratch stack only.** Never use ports 5760-5763 / 8000 / 5173 / 14550 / 14551.
  1. SITL instance 3 (`-I3`, tcp:5790), as in the GPS ROI plan, for `SYSTEM_TIME`.
  2. `cargo run -p rgcs-camera --features sim --example siyi_sim -- --port 37261`.
  3. Scratch `config.toml`: `listen = "127.0.0.1:8110"`, `mavlink_url = "tcp:127.0.0.1:5790"`, a fresh `data_dir`, and `ui_dir` = a fresh `npm run build` output.
  4. Set the camera profile `siyi_mt11` 127.0.0.1:37261. Expected:
     - 接続 tab: SD `56.3 / 128 GB  44%`, clock `GPS 同期 ±0.0 s` after ≤ 2 s; 「今すぐ同期」 logs a new 0x30 in the sim log;
     - cockpit (no video; the overlay still maps through the fallback 16:9 rect):
       - plain click → 0x55 / 0x56 in the sim log, and a `.trk.tracking` box at the click;
       - Ctrl+click on the sim person box → 0x56 point at its centre;
       - IR → hot / cold markers at the sample positions;
       - Alt+click → a point marker showing 16.0℃ for 15 s;
     - 映像 tab: save `h264_4k` → 0x21 then 0x20; clicks are refused (`stream_unknown` in the log) for under 1 s, then work;
     - start an ROI chip while tracking → the sim log shows 0x56 cancel before 0x07;
     - devtools: `camera_state` ≤ 10 per second while tracking.
  5. Do not arm or command the scratch SITL. Stop everything afterwards.
- [ ] **Step 7:** commit `feat(ui): cockpit tracking and temperature overlays, AI button, joystick media functions`, and `docs: MT11 thermal, AI, encoding, clock and SD implemented`.
