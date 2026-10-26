# Final review: feat/mavlink-camera (main...HEAD, 8b99877)

Verification run by the reviewer:
- `cargo test -p rgcs-camera -p rgcs-mavlink -p rgcs-core`: 274 + 215 + 89 passed.
- `cargo test -p rgcs-server --test mavlink_camera_flow --test roi_native_flow`: 8 + 9 passed.
- `npx tsc --noEmit -p tsconfig.app.json`: clean.
- Log: scratchpad/mav-final-cargo.log.

Counts: **Critical 0 / Important 3 / Minor 9**

---

## Important

### I1. Every WS session end, vehicle re-select and deadman sends a rate-0 SET_PITCHYAW, which cancels FC-side pointing on ArduPilot
- **Where:**
  - `apps/rgcs-server/src/ws.rs:97` (`gate.close()`) and `ws.rs:138-142` (`Action::Zero` → `rate(0,0)`);
  - `crates/rgcs-input/src/gate.rs:39-42` (`retarget` zeros the previous vehicle) and `gate.rs:133-137` (`close` zeros whenever a target is set);
  - `crates/rgcs-camera/src/mavlink_cam/encode.rs:100-111`.
- **Why it happens:**
  - The UI sends `select` on every page load, even without a gamepad (`features/gimbal-joystick/loop.ts:63`). That sets the gate target.
  - So every reload, tab close or network blip emits one `GIMBAL_MANAGER_SET_PITCHYAW` with NaN angles and rates 0/0. So does switching the selected vehicle (a zero to the previous one).
  - ArduPilot `AP_Mount::handle_gimbal_manager_set_pitchyaw` → `set_rate_target` → `set_mode(MAV_MOUNT_MODE_MAVLINK_TARGETING)` (`AP_Mount_Backend.cpp:229-240`).
  - That drops the mount out of `GPS_POINT` (mission `DO_SET_ROI`, Mission Planner ROI), `SYSID_TARGET` and `HOME_LOCATION`. RC targeting only comes back when the RC input moves past the dead zone (`AP_Mount_Backend.cpp:955-991`).
  - `on_zero` drops the zero only while an *RGCS* ROI is active. Ruling 10 removed the link-up zero for this exact reason, but the WS-gate zeros remain.
- **Failure scenario:**
  1. An AUTO survey with a mission `DO_SET_ROI` is pointing the camera at a structure.
  2. The operator reloads the RGCS tab, opens a second tablet and closes it, or clicks another vehicle in the list.
  3. The gimbal stops tracking and freezes at its current body-frame angle for the rest of the mission leg, with no message.
- **Suggested fix:** suppress redundant zeros in the MAVLink driver, which keeps the MT11 behaviour unchanged.
  - `MavlinkCamera` keeps a `rate_moving: AtomicBool` plus `last_nonzero_ms`.
  - `GimbalRate{yaw≠0 || pitch≠0}` sets it.
  - `GimbalAngle` / `GimbalCenter` / `roi_location` / `roi_none` clear it.
  - `GimbalRate{0,0}` is sent only while `rate_moving`. It then clears the flag, but still allows one repeat within about 2 s of the last non-zero, so a lost zero can be retried by the deadman / close zero. Otherwise it returns `Ok(())` without sending.
  - This keeps the stick-release, deadman and close zeros that actually stop a moving gimbal, and kills the no-op ones.
  - Optionally, also make `Gate` emit `Zero` on close / retarget only if it forwarded a non-zero since its last zero. That mirrors the UI's own `lastNonZero` rule at `loop.ts:88`.
  - Add a driver test ("zero without a prior non-zero sends nothing") and a ws test (session close with no rate → no outgoing frame for a mavlink camera).

### I2. Native ROI on released ArduPilot (≤ 4.6.x) ignores the gimbal-id selector: a pitch-only mount makes the whole Copter yaw, and ROI_NONE resets the Copter's auto-yaw
- **Where:**
  - `crates/rgcs-camera/src/mavlink_cam/caps.rs:37-40` (Native whenever `CAN_POINT_LOCATION_GLOBAL`);
  - `encode.rs:144-176`.
- **Why it happens:**
  - Selector routing for `DO_SET_ROI_LOCATION` / `ROI_NONE` p1 is upstream-master-only: `689868534b` "support unicast links, camera replies and device selectors", 2026-09-21, not in any `Copter-4.6.x` tag. The live check (Task 8) ran on `ardupilot-latest`, which has it.
  - In `Copter-4.6.2`, `GCS_Common.cpp:5506` → `handle_command_do_set_roi(packet)` ignores p1 → `Mode::AutoYaw::set_roi` (`autoyaw.cpp:165-184`).
  - When `!camera_mount.has_pan_control()` it sets `auto_yaw.set_mode(Mode::ROI)`: the **vehicle** yaws at the target in AUTO / GUIDED / RTL and similar modes.
  - ArduPilot always advertises `CAN_POINT_LOCATION_GLOBAL` (`AP_Mount_Backend.cpp:493-497`), so a 2-axis (pitch-only) mount gets `roi: native`.
  - `ROI_NONE` on 4.6 calls `auto_yaw.set_mode_to_default(false)`, which overrides a mission's `CONDITION_YAW` / ROI yaw.
  - Review Focus 1 is therefore only proven on a firmware no operator flies yet.
- **Failure scenario:** an operator with a released Copter 4.6 and a pitch-only gimbal starts GPS ROI in GUIDED / AUTO. The aircraft rotates toward the target, which the plan explicitly says must never happen.
- **Suggested fix:**
  - Report `RoiMode::Native` only when the manager also has `GIMBAL_MANAGER_CAP_FLAGS_HAS_YAW_AXIS` (256). Without it, `RoiMode::None`.
  - Document in spec 40 §2 / §4.2 that on firmware without the selector, p1 is ignored (primary mount) and `ROI_NONE` resets Copter auto-yaw.
  - Optionally re-run the Task 8 live check against a `Copter-4.6.2` SITL build.
  - Add caps tests: pitch-only manager → `roi: none`.

### I3. Fire-and-forget requests fill the shared `outgoing` queue during a link outage, then block the vehicle command queue and flush stale traffic on reconnect
- **Where:**
  - `crates/rgcs-mavlink/src/port.rs:73-78` (`send` awaits a bounded mpsc);
  - `crates/rgcs-camera/src/mavlink_cam/driver.rs:226-236` (`on_tick`);
  - `requests.rs:87-125` (since f5441f8, streams are requested whenever bound, even while silent);
  - `connection.rs:72-103` (nothing drains `ch.outgoing` while the link reconnects);
  - `main.rs` (`outgoing` capacity 64).
- **Why it happens:**
  - While the FC link is down, a bound MAVLink camera keeps queuing 3 × `SET_MESSAGE_INTERVAL` every 5 s. An unbound one queues 1–2 × `REQUEST_MESSAGE` every 2 s. This repeats for every sysid whose profile is `mavlink`.
  - That fills the 64-slot `outgoing` channel within 1–2 minutes.
  - After that, `run_queue` → `execute` blocks in `link.send(..).await`, with no timeout, for every vehicle command (mode, RTL, arm, param writes through the queue). The operator's HTTP request hangs instead of getting `timeout` after 4.5 s.
  - When the link returns, those commands and about 64 stale camera requests go out in one burst.
- **Failure scenario:**
  1. A telemetry radio drops out for 3 minutes.
  2. The operator presses RTL, then Land. Both requests hang.
  3. The link returns and the queued RTL and Land execute back to back, minutes late, in an order the operator no longer intended.
- **Suggested fix:**
  - Add `MavPort::try_send` (`mpsc::try_send`, drop on `Full`) and use it for the info / stream requests in `on_tick`, and ideally for `SET_PITCHYAW` too. A dropped request is retried by the next tick anyway.
  - Skip requests while the vehicle has no recent HEARTBEAT. The router knows this; pass a `watch<bool>` or check `last_seen`.
  - Test: an outgoing channel of capacity 1 that is never drained, then 30 s of paused time → the actor never blocks, and `command` still times out.
  - Pre-existing (separate): the queue's three retries already leave stale copies in the buffer during an outage. Consider clearing `outgoing` on reconnect, or giving `execute`'s `link.send` a timeout.

---

## Minor

### M1. Requests that never stop
- **Where:** `requests.rs:55-85`, `requests.rs:116-125`.
- **Info requests:**
  - A vehicle with a gimbal but no `CAM1_TYPE` (common Siyi-as-mount-only setups), or a camera whose `comp_id` does not match the profile, gets `REQUEST_MESSAGE 259` to compid 0 every 2 s for the life of the process.
  - Each one is ACKed and logged in the inspector.
- **Stream requests:** ArduPilot never streams 262, so `SET_MESSAGE_INTERVAL 262` repeats every 5 s forever (Task 8 concern).
- **Suggested fix:**
  - Back off the info requests (2 s → 30 s after about 5 tries; reset on a reconnect edge).
  - Stop asking for a stream after N ACCEPTED-but-silent attempts.
  - Treat 262 as optional.

### M2. ACK matching ignores compid and target, so foreign ACKs can satisfy waiters
- **Where:** `connection.rs:181-187`, `queue.rs:120-136`.
- The camera's fire-and-forget `SET_MESSAGE_INTERVAL` (M1, every 5 s) produces ACKs for the same `MavCmd` that RC calibration waits on through the queue (`calib_api.rs:128-135`).
  - A lost calibration request can be "completed" by the camera's ACK, and the queue will not retry it.
  - An `UNSUPPORTED` ACK from a native camera at compid 100 can fail the calibration.
- ACKs addressed to another GCS on a shared router (Mission Planner) are also accepted.
- **Suggested fix:**
  - Carry `header.component_id` and `ack.target_system` / `target_component` in `Ack`.
  - Have waiters filter on the target compid and `target_system == our GCS sysid` (or 0).
- Double-clicked identical camera commands complete on the first ACK. That is harmless, because each is sent once.

### M3. Native ROI task exits without releasing when its channel closes
- **Where:**
  - `apps/rgcs-server/src/roi_native.rs:56-59` (`None => return`);
  - `roi.rs:239-250` (a mode switch drops the old sender).
- **Scenario:**
  1. The release fails while the FC is offline, so `pending_release` is set.
  2. The profile is switched to MT11, and a computed ROI starts. `dispatch` drops the native task.
  3. The pending `ROI_NONE` is lost. When the link returns, the FC is still in `GPS_POINT` at the old target.
- **Same family:** with `pending_release` set, a reload to a non-MAVLink driver makes `release()` call `roi_none` on the *new* driver. That returns `Unsupported` → `pending_release = false` → the FC is never released (`roi_native.rs:155-167`, `self.camera()` re-resolves).
- **Suggested fix:**
  - On `None`, attempt one bounded release when active or pending.
  - Bind the native task to the `Arc<dyn Camera>` it started with, or release through the `MavPort` directly.

### M4. A crash or kill leaves the FC pointing at the target
- **Where:** the restart path (no persisted native ROI state).
- **Scenario:**
  - After a SIGKILL, power loss on the Pi or a panic, the mount stays in `GPS_POINT` while the RGCS UI shows ROI inactive.
  - Ruling 10 deliberately sends no link-up zero.
- **Suggested fix:**
  - Persist "native ROI active (sysid, device)" in the store.
  - On the next bind, send one `ROI_NONE` if it was set, then clear it.

### M5. A manual cancel blocks the WS session for up to 4 s
- **Where:** `ws.rs:150-163` → `roi.on_manual_rate` → `stop` → `release()` (`roi_native.rs:155-163`, `NATIVE_SEND_TIMEOUT` 2 s × 2 attempts).
- **Effect:** while the FC does not ACK, the session processes no other frames (heartbeats, deadman, broadcasts). The computed ROI used `SEND_TIMEOUT` 200 ms.
- **Suggested fix:**
  - Send the manual cancel's `ROI_NONE` once, without a retry, or reply first.
  - Or run the stop in a spawned task and forward the rate after it.

### M6. Legacy earth-frame attitudes are mis-read
- **Where:** `attitude.rs:21-28`.
- **What goes wrong:**
  - Only `YAW_IN_EARTH_FRAME` (64) is honoured. Per the MAVLink spec, when neither `YAW_IN_VEHICLE_FRAME` nor `YAW_IN_EARTH_FRAME` is set, `YAW_LOCK` (16) means the yaw is earth-frame. Older MAVLink gimbal devices (e.g. Gremsy, forwarded from compid 154) are read as body-frame, so the fan and status row are off by the vehicle heading.
  - `delta_yaw` from a sender that omits the extension decodes as 0.0, not NaN, so the conversion silently uses 0.
- **Effect:** ArduPilot's own reports are fine (`YAW_IN_VEHICLE_FRAME` is always set).
- **Suggested fix:**
  - When neither frame flag is set and `YAW_LOCK` is, treat the yaw as earth-frame.
  - Treat `delta_yaw == 0.0` together with earth-frame as unknown unless the frame flag is explicit.

### M7. A gimbal bound before the camera info arrives is never re-bound
- **Where:** `binding.rs:74-94`, `requests.rs:62-72`.
- **What goes wrong:** if `GIMBAL_MANAGER_INFORMATION` arrives first, the first manager is taken. A later `CAMERA_INFORMATION` naming a different `gimbal_device_id` does not re-bind, because 280 is not requested again until a reconnect edge.
- **Effect:** none with one mount (in scope). With two mounts, angles and ROI can go to the wrong one.
- **Suggested fix:** when the camera binding changes, request 280 again, or keep the last manager info per device id and re-select.

### M8. Liveness counts either component
- **Where:** `apply.rs:186-205`.
- **What goes wrong:**
  - A native camera at compid 100 that has died still reads as `connected` while the FC's gimbal frames keep arriving.
  - Photo / record then time out as `503 camera_error` instead of `503 camera_offline`. A camera removed from the FC (`CAM1_TYPE` → 0) keeps its stale caps until restart.
- **Suggested fix:** track camera and gimbal freshness separately, and gate camera commands on camera freshness.

### M9. Rapid zoom-step presses do not add up
- **Where:** `encode.rs:75-78`.
- **What goes wrong:** `ZoomStep` is computed from `state.zoom`, which `CAMERA_SETTINGS` updates at only 1 Hz. Three quick "+" presses all send `current + 10`.
- **Suggested fix:** keep a "pending zoom target" in the model, updated on each ACCEPTED zoom and overwritten by `CAMERA_SETTINGS`.

---

## Review Focus checklist
1. **ROI turns the aircraft / wrong mount.**
   - On ArduPilot master: OK. p1 is the device id (≠ 0), and the selector maps 1..6 and the MAVLink gimbal compid (154 via `get_mavlink_device_id`).
   - On released 4.6: **not OK** (I2).
2. **Yaw mirrored.** OK.
   - Attitude is negated (`attitude.rs:33`) and the angle command is negated (`encode.rs:127`). Rates are not negated, which matches `CameraCommand` "+yaw = right". Status and fan read the SIYI `+left` value.
   - The live check confirmed east → ↔ −90.7°.
3. **A rate frame ends FC-side targeting.**
   - `link_zero` is skipped (`cameras.rs:237`), and zeros are dropped while an RGCS ROI is active.
   - WS-gate zeros outside an RGCS ROI still cancel mission / RC targeting (I1).
4. **Caps stay empty.** OK.
   - The actor subscribes before spawning (`driver.rs:164`).
   - `Lagged` is ignored (`driver.rs:215`).
   - `forward` re-reads caps per frame (`cameras.rs` `forward`), with a test.
   - The camera binding at 100 vs. an FC reply from compid 1 is handled by the native-first rule.
5. **ACK cross-talk / double actions.**
   - No retry anywhere on the camera path; auto record retries only after a failure and is idempotent on ArduPilot / Siyi.
   - The vehicle queue never sends camera `MavCmd`s, so ARM etc. cannot be stolen.
   - The remaining overlap is `SET_MESSAGE_INTERVAL` with RC calibration (M2).

## Other checks (OK)
- **MavPort tap:** a broadcast with capacity 256, `send` ignores "no receiver", and nothing is buffered without receivers. A slow receiver only lags. The link is never blocked by the tap; it is blocked only by `outgoing` (I3).
- **Target ids:**
  - camera commands go to the bound compid with `camera_device_id` (p1 photo, p3 record start / zoom / focus, p2 record stop);
  - `SET_PITCHYAW` goes to the manager compid with its `gimbal_device_id`;
  - ROI goes to the manager compid, `COMMAND_INT` `MAV_FRAME_GLOBAL` (MSL).
- **Telemetry requester (`interval.rs`) rates:** not disturbed. The camera requests only 260 / 262 / 285, which are disjoint from `WANTED`.
- **Stop paths:** profile reload stops ROI before swapping the driver (`camera_api.rs` `reload_driver`). Operator, manual, angle / centre, slot unset and `shutdown_all` all release.
- **Auth / audit:** no route signatures changed. `roi/start` now accepts native under the same auth and audit. `camera_rejected` → 409, which is in spec 50 and i18n.
- **UI:**
  - MT11-only controls are caps-gated: modes `[]` → no mode segment; no thermal / AI / encoding / SD / clock rows.
  - The ROI control form is hidden for native, and the Follow-mode note is MT11-only.
  - Percent zoom is linear on the slider; the map fan uses 1×.
  - `comp_id` / `rtsp_url` changes trigger a driver reload (`needs_reload`).
