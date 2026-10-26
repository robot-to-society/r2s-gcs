# Final review — feat/vehicle-models (main...HEAD, 23 commits)

Verified while reviewing: `cargo test -p rgcs-camera roi` (74 pass), `cargo test -p rgcs-server --test roi_flow --test roi_runtime` (pass), and vitest on roi / app / gimbal-joystick / commands / editorKeys / vehicles (39 files, 175 tests pass). The dev stack was not touched.

Counts: **Critical 0 · Important 7 · Minor 10**

---

## Important

### I1. After a WS reconnect or a server restart the UI keeps showing "ROI active"
- **Where:** `ui/src/features/vehicles/reducer.ts:97-103` (`snapshot`) never resets `roi`. Only `vehicle_lost` (l.168) drops an entry.
- **Failure scenario:**
  1. ROI is running and the browser's WS drops: Wi-Fi blip, a laptop sleep, or `systemctl restart rgcs-server`. Ruling 18 says a restarted server comes up with ROI inactive.
  2. While the socket is down, ROI stops (server restart, another operator, manual cancel). The final `roi_status` frame is never received.
  3. On reconnect the snapshot arrives without any ROI info, and no further `roi_status` comes because ROI is inactive.
  4. The UI still lights the chip `.on`, shows the card row "ROI 1 方位 …", the status-row name, the marker `.rg-roi.on` and a sight line to the target. The operator believes the gimbal is tracking when it is not.
  5. The joystick toggle (`buttonAction`, `roiActive === fn`) then sends **stop** on the first press. The operator has to press twice to start.
- **Fix:** clear `roi` in the `snapshot` case (`roi: new Map()`). Ruling 2 already guarantees an active ROI re-announces itself within 0.5 s. Add a reducer test.

### I2. `systemctl stop/restart` never sends the ROI zero (ruling 18 graceful path is dead in deployment)
- **Where:** `apps/rgcs-server/src/main.rs:103-106` waits only for `tokio::signal::ctrl_c()` (SIGINT). `deploy/rgcs-server.service` has no `KillSignal=`, so systemd sends SIGTERM.
- **Failure scenario:**
  1. An upgrade or `systemctl restart rgcs-server` happens during flight with ROI in rate mode at speed ±60.
  2. The process dies at once, and `roi.shutdown_all()` never runs.
  3. The gimbal keeps slewing until the boot zero, about 3 s RestartSec plus the camera connect.
  4. With `systemctl stop` there is no restart, so the gimbal keeps slewing indefinitely.
- **Fix:** in `shutdown_signal`, also await `tokio::signal::unix::signal(SignalKind::terminate())` via `select!`. Alternatively set `KillSignal=SIGINT` in the unit. The code fix is better, because the docker `stop_signal: SIGRTMIN+3` is a different signal again. Keep `TimeoutStopSec` ≥ 2 s.

### I3. Every camera-settings save stops an active ROI and reloads the camera driver
- **Where:**
  - `ui/src/app/useCameraSettingsFlow.ts:93-97`: `save` always PUTs the camera profile first.
  - `apps/rgcs-server/src/camera_api.rs:165-168`: `put_profile` then calls `roi.stop(…Operator)` and `cameras.reload` unconditionally, even when the profile is unchanged.
- **Failure scenario:**
  1. The operator opens ⚙ during a ROI to tweak Kp, rename a preset, or move the active preset by map pick or CSV.
  2. Save sends `PUT /camera/profile` first, so ROI stops, the MT11 TCP reconnects and video reloads. Only after that do the ROI PUTs go out.
  3. This makes `RoiHub::configure` while active and ruling 11 ("changing its coordinates keeps it running") unreachable from the UI.
  4. The stop is also not audited (see M2).
- **Fix (either):**
  - UI: skip the profile PUT when `draft.camera` equals the loaded profile.
  - Server: compare the merged profile with `base`, and skip the stop / reload / video reload when they are equal (still 200).
  - The server-side fix also covers other clients.

### I4. A ROI start never forces a zero, so the gimbal can keep the operator's last stick speed
- **Where:** `crates/rgcs-camera/src/roi/controller.rs:146-166` (`start` → `halt(false)`) and `step.rs:26-28` / `203-205` (goal-error and no-attitude paths → `halt(false)`). Together with ruling 7 in `ws.rs:138-157`, which drops every joystick zero while active.
- **Failure scenario:**
  1. A 1–4 unit stick creep is still being forwarded, or the stick is released just after the ROI chip / joystick `roi_N` press.
  2. The release `(0,0)` frame and the deadman zero are dropped because ROI is now active.
  3. The controller's own `last_speed` is `STILL`, so `halt(false)` sends nothing. Its first tick always has `stamp = None` (`roi_task.rs:128-134`), so it ends in NO_ATTITUDE → halt(false) → nothing.
  4. While ROI sits in an error state the gimbal keeps turning at the operator's speed indefinitely. Errors that cause this: `no_position` before GPS fix, `heading_unknown`, `position_stale`, `target_too_close`. It also keeps turning while the error stays inside the deadband (`send` is false when both speeds are STILL).
- **Fix:**
  - Make `start` use `halt(true)`. Ruling 8 already says a zero costs nothing.
  - Or initialise `last_speed` to an "unknown" sentinel so the first halt always zeros.
  - Add a controller test: start, then a goal error, must emit `GimbalRate{0,0}`.

### I5. A stop while the camera link is down is lost, and the gimbal is not zeroed when the link comes back
- **Where:** `apps/rgcs-server/src/roi_task.rs:108-118`.
- **Failure scenario:**
  1. The SIYI TCP watchdog marks the camera disconnected (3 s without replies) while ROI was driving at, say, 40.
  2. The operator presses 停止. The immediate zero fails with NotConnected, and `send_failed` does nothing because the controller is already inactive.
  3. On the next tick, `offline && !active` drops the 2 pending resends ("Nothing to resend to").
  4. When the link returns, nothing sends 0x07 0,0. `boot_zero` fires only on the first connect of an install. If the gimbal kept the last 0x07 rate, it keeps turning.
  5. The same applies when ROI was manually cancelled while offline.
- **Fix:**
  - Keep pending zero resends while offline: don't clear them, and don't retire while `zero_resends > 0 && offline`, perhaps with a cap.
  - Or send one zero on every offline→online transition seen by the task.
  - Or make `boot_zero` fire on every reconnect, not just the first.

### I6. A tiny `rate_hz` is accepted, and in rate mode the gimbal coasts for a whole period
- **Where:**
  - `crates/rgcs-core/src/roi.rs:142` (`0 < rate_hz ≤ 50`, per spec 60);
  - `ui/src/features/roi/schema.ts:10`;
  - `controller.rs:297-303` (period = 1000 / rate_hz).
- **Failure scenario:**
  1. A PUT `roi/control` with `rate_hz: 0.05` sets a 20 s period. Any REST client can send it; the UI has no field for it today but validates `gt(0)`.
  2. In rate mode a 0x07 at up to `max_speed` (60 °/s) is held for 20 s, with no watchdog (ruling 9 replaced it with send timeouts only).
  3. The 500 ms attitude limit stops most steps, but a 1 Hz poll reply occasionally lands fresh, and that speed is then held for the full period.
  4. Python had the same 0.1 Hz floor, but it also had its watchdog thread.
- **Fix:**
  - Raise the minimum to about 5 Hz for `control_mode = rate`, and amend spec 60 §3.4.
  - Or have the task send a zero if no new rate command went out within about 300 ms of the last non-zero one.

### I7. Rate-mode overshoot (sim −58° before −44°): the port is faithful, so the cause is loop latency, which needs measuring before real flight
- **Port check:** the port matches `app/gimbal_pid.py`, `app/roi_controller.py` and `app/geo.py` line for line in every part that shapes the transient:
  - `pid_step`: integral pre-multiplied by ki and clamped to max_speed / 2, output clamped to max_speed;
  - dt clamp to 2 periods;
  - deadband hysteresis (×2);
  - EMA `smooth_angle` with wrap;
  - `stable_yaw_error` 170° guard;
  - attitude max age 500 ms;
  - attitude requested after the motion command, reply used next cycle;
  - follow mode first and every 5 s;
  - `wrap_180` with the same `%` / fmod semantics.
- **Differences from Python:**
  - Python sends speeds rounded to 0.1, Rust to integers (immaterial).
  - Rust also requests 0x0D on goal-error steps (harmless).
- **Why the sim overshoot points at latency:** the sim gimbal is an ideal integrator (1 unit = 1 °/s, no inertia). I ran a closed-loop simulation using the Python PID helpers on a 0 → −45° step (kp 2, ki 0.2, 10 Hz, max 60). Effective attitude latency vs. the most negative yaw reached:

  | Effective attitude latency | Most negative yaw reached |
  |---|---|
  | 0.0 s | −45.2° |
  | 0.1 s | −45.5° |
  | 0.2 s | −48.9° |
  | 0.3 s | −54.4° |
  | 0.5 s | −67° |

  The expected design latency (one 100 ms period) gives no visible overshoot, so −58° implies about 0.35 s of effective latency. The controller maths is not the cause. Either the attitude is older than assumed, or the ticks are slower or more irregular than 10 Hz.
- **Likely contributors (unverified):**
  1. Neither `siyi/client.rs` nor `siyi/sim.rs` calls `set_nodelay(true)`. The 0x0D request (TCP) can be held by Nagle behind an un-ACKed heartbeat / 0x0A, and the reply behind delayed ACK. That is up to about 200 ms on macOS, and also on the camera's stack.
  2. Attitude is stamped when the task sees the watch change, not when the frame arrived (see M1).
  3. Tick starvation: each tick awaits `ensure()`, the router Mutex, two actor round-trips and the SEND_TIMEOUT path, with `MissedTickBehavior::Skip`.
- **Fix:**
  - Set TCP_NODELAY on the client (and the sim).
  - Add `attitude_age_ms` and the actual tick interval to `roi_status`, or log them at debug, and repeat the Task 9 run.
  - On real hardware with gimbal inertia the same latency would overshoot more. Tune Kp / max_speed only after the latency is confirmed to be about 100 ms.

---

## Minor

- **M1. A stale attitude is re-stamped as fresh** (`roi_task.rs:136-140`, `inputs.rs:25-27`). Any watch change re-stamps with the current `g.age_ms`. That includes the 1 Hz 0x0A reply, zoom, record feedback and the poll's own `age_ms` rewrite, and `send_modify` always notifies. If 0x0D replies stop while other replies continue, `age_ms` stays 0 until the next 1 Hz poll. So for up to about 1 s the controller acts on a frozen attitude at up to max_speed, then halts with `no_attitude`. **Fix:** have the client publish a monotonic `attitude_at` (an Instant / epoch ms set in `apply_frame` 0x0D), and age against it instead of re-deriving from watch changes.
- **M2. ROI stops without an audit row (spec 70 §6 "ROI 開始 / 停止"):**
  - the profile-PUT stop (`camera_api.rs:166`);
  - the targets-PUT stop when the active slot is unset or removed (`roi_api.rs:82`, only a `targets` row);
  - the graceful-shutdown stop.

  **Fix:** use `stop()`'s bool to write a `stop` row with reason `profile_reload` / `target_removed` / `shutdown`.
- **M3. Start / PUT races in `RoiHub`** (`roi.rs:93-120` vs `roi_api.rs:79-82,115-118`). `start` reads the targets and control from the store and dispatches later. A concurrent `PUT targets` that unsets the slot can call `set_targets` while no task exists yet (dispatch without spawn = no-op), so ROI then runs on a just-deleted preset. The same applies to `PUT control`. **Fix:** let the Start command re-read from the store inside the task, or serialise start / put per sysid with a per-vehicle async mutex.
- **M4. Manual-cancel window** (`roi.rs:136-146`). `active` is published only after the task processed Start. A ≥5 stick frame arriving during the start round-trip is forwarded without cancelling, and ROI then takes over. The next stick frame cancels, so this is benign, but Review Focus 4 assumes no window. **Fix:** set `active` in `dispatch` for Start, or document it.
- **M5. `other_guard` is broader than the UI's needs** (`other_guard.rs:26-27`):
  - 246 passes any params while disarmed: shutdown (2), reboot-to-bootloader (3), companion-computer reboot (param2/3). The UI only sends `[1,0,…]`. Restrict p1 ∈ {1}, p2..p7 = 0.
  - 511 accepts `interval_us` of 1 µs (a flood request). Clamp to ≥ 10 000 µs or require a 0 / -1 / sane range.
  - 511 on non-core ids while armed can stop EXTENDED_SYS_STATE / HOME_POSITION. The interval requester re-asks for stale wanted streams, so this self-heals.
- **M6. ROI control number inputs: an emptied field becomes 0 silently** (`RoiControlForm.tsx:27`, `Number('') === 0`). Kp = 0 and Ki = 0 are valid per spec, so Save stores a controller that never moves the gimbal. **Fix:** treat '' as NaN so the existing `finite()` check marks the field invalid.
- **M7. Preset cache never refreshes** (`targetsStore.ts:42-53`). `requested` is module-global and never cleared:
  - a transient failure on first load means no chips or markers until a page reload;
  - edits from another client or tab never show up (stale chip names and markers);
  - the store survives logout.

  **Fix:** reload on settings save from any client (a WS hint), on WS reconnect, and remove the sysid from `requested` on failure.
- **M8. Zeros share the camera actor FIFO with TCP ops** (`siyi/client.rs` actor). A 0x07 zero queued behind a TCP write blocked on a full send buffer waits until the 3 s READ_TIMEOUT ends the session. Python sent UDP speeds outside the TCP path, and its watchdog zeroed over UDP. **Fix:** send UDP 0x07 directly from `submit` (or use a separate UDP socket handle), outside the TCP actor.
- **M9. No panic guard in the ROI task** (`roi_task.rs:35-70`). A panic leaves the handle with `active = Some`, so joystick zeros and small speeds are dropped. A large stick still recovers it via SendError. The gimbal is not zeroed. Python caught every exception and halted. Panic paths are hard to reach today (`expect("active controller")`, the mutex poisoning). **Fix:** wrap `run` in `catch_unwind` / a JoinHandle monitor that clears the handle and sends a zero.
- **M10. ROI routes accept any sysid** (`roi.rs:99`). `start` → `cameras.ensure(sysid)` installs a driver for a sysid that does not exist, e.g. `POST /vehicles/250/roi/start`. That driver then broadcasts `camera_state` for a phantom vehicle every second. The GET routes also return defaults for any sysid. Authenticated only. **Fix:** return 404 when the router does not know the sysid (and has no saved profile).

## Review Focus walk-through
1. **Position stale while the link is alive:** OK.
   - The chain is `Router::now_ms` (also advanced by the 1 Hz tick) → `message_age_ms(…, 33)` → `vehicle_fix.age_ms` → `POSITION_STALE` → `roi_status.error`. The Task 9 live check matches (SIGSTOP → `position_stale` from 2.5 s).
   - Limitation: ArduPilot keeps sending GLOBAL_POSITION_INT (EKF dead-reckoning) on a GPS loss, so position_stale does not cover a GPS loss. Not a defect against spec.
2. **hdg = 65535:** OK. `decode.rs:69` → `None` → `HEADING_UNKNOWN` halt. `sightGeoJson` returns empty on `hdg === null`. The halt only zeros if the controller itself was moving (see I4).
3. **Target < 3 m:** OK. Zero if moving, error `target_too_close`, ROI stays active, and it resumes on its own (goal_error cleared on the next good fix).
4. **Manual cancel races:** OK as designed.
   - `ws.rs::forward` → `on_manual_rate` → `stop()` awaits the task's ack, which is sent after `apply` awaited the zero send (or its 200 ms timeout). Only then is the manual frame forwarded.
   - Ticks and commands are serialised by `select!`, so a tick mid-send finishes before the Stop runs, and no stale command can follow.
   - The manual frame is not dropped. Small frames and zeros are dropped per ruling 7.
   - Residual: the start window (M4) and I4.
5. **Restart / reload:**
   - The profile PUT stops before `reload`: OK, but on every save (I3).
   - `boot_zero` skips caps without `gimbal.rate` (none / MAVLink → NoneCamera) and fires once per install. It also fires on every profile reload, which is harmless.
   - The crash case depends on the boot zero, but SIGTERM is not handled (I2), and a link drop is not covered (I5).

## Other areas checked, no issues found
- **Auth:** all 6 ROI routes take `AuthUser`.
- **Audit:**
  - start (ok / rejected with code), stop, targets and control are audited;
  - the WS joystick cancel is audited under the socket's operator (2e7582e);
  - the REST gimbal_center / angle / mode cancel is audited as `manual_command`.
- **Validation:** matches spec 60 §3.4 in `rgcs-core::roi`. NaN fails, names are counted in chars, ids must be roi_1..roi_10 in order. The SQLite CHECKs agree.
- **with_cameras:** rebuilds the hub on the same manager. It is used only by tests and the `ws.rs` test helper, before any clone is handed out.
- **VTOL / model / quick modes:**
  - `apply_extended_sys_state` is plane-gated, and the heartbeat keeps a known vtol. A copter heartbeat clears it.
  - `modelFor` / `modesFor` agree with each other.
  - Every quick / all mode name exists in `rgcs-mavlink::modes`.
  - The QuadPlane appears as a plain plane until EXTENDED_SYS_STATE is streamed (≤ 10 s grace). This is cosmetic.
- **Interval requester:** the gap reset re-asks the ONCE streams after each reconnect (intended), and a silent vehicle is asked at 3 s.
- **Survey fixes:**
  - the `midHandles` entering-leg anchor is correct;
  - `clearItems` drops surveys;
  - `ownsKey` lets ⌘Z / Escape through from buttons but keeps Delete and arrows on controls and range inputs.
- **Battery:** the dash is correct. `battWidth` still renders 100 % when `pct` is null, which predates this branch.
