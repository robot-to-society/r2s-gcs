# Final review: feat/camera-rest (MT11 thermal / AI / encoding / clock / SD)

Reviewed: the full diff, plan header (constraints, Review Focus 1-5, rulings 1-16), and the Python reference
(`camera_protocol.py`, `thermal.py`, `ai_tracking.py`, `time_sync.py`, `tf_card.py`, `video_routes.py`).
Verification: UI `tsc` is clean, and the vitest suites for video / camera / camera-settings / gimbal-joystick / useCameraSettingsFlow pass (134 tests).
Rust: `cargo test -p rgcs-camera -p rgcs-core -p rgcs-server` (separate target dir) showed no failures in the captured output. Only the last 60 lines of the log were kept, and every suite in them reported ok.

The wire codecs match the Python byte for byte. I checked these:
- 0x12 `<HHB`; 0x14 `<6H`; temperatures as raw/100 with the >600 °C wrap;
- 0x49 `<BBHH`; 0x50 `<HHHHBB` on the 1280x720 grid;
- 0x5F `<BBQB` plus struct-of-arrays, with classes at 11+10n;
- 0x56 `<BHHHH`; 0x21 `<BBHHHB`; 0x30 / 0x40 `<Q`;
- 0x55 ACK byte 1; 0x56 ACK byte 0; 0x51 [1]; 0x5F [5]/[4]; 0x38 0=Low / 1=High.

Other checks that pass:
- `pick_detection` tie-breaking matches.
- `axis_span` uses floor(x+0.5).
- The 0x48 format command is blocked in `Link::tcp` / `Link::udp` and never polled.
- `forward()` always sends the newest state after a burst.
- The expiry tick runs independently of reads.
- Auto record ignores the first observation and acts only on edges.
- No changed source file exceeds 800 lines, apart from the pre-existing `i18n/index.ts` (see M9).

No Critical findings.

---

## Critical

None.

---

## Important

### I1. A refused AI click still stops an active ROI
`apps/rgcs-server/src/camera_api.rs:51-53` (`cancel_roi_for` runs before `app.cameras.send`)

**What happens.** `AiSelectBox` / `AiSelectPoint` stop ROI before the driver checks its preconditions. The driver then refuses with 409 for any of:
- `rgb_only`;
- `stream_unknown`, which follows every encoding change and any reconnect until 0x20 answers;
- `no_detection`, from a Ctrl+click that misses every recent box;
- `camera_offline`;
- `unsupported_capability`.

By then ROI is already stopped and audited as `roi/stop ai_tracking`.

**Example.** ROI points the gimbal at a site. The operator Ctrl+clicks the video a little beside a detected car, or clicks within ~1 s of an encoding change. The response is 409, the tracker never starts, and ROI is gone with its zero rate sent. The gimbal stops pointing at the target. The only sign is a log line about the refused click.

**Python comparison.** Python calls `check_trackable` and `pick_detection` (404) before `get_roi().stop()`.

**Fix.** Run the checks that cannot pass before stopping ROI:
- Add a driver-side precheck to the `Camera` trait, e.g. `fn check(&self, &CameraCommand) -> Result<(), CameraError>` using the watch snapshot and media history; or
- Have the driver hand back a "will send" decision before the server stops ROI.

The simplest server-side version needs no history:
- check `caps.supports`, `state.connected`, `video_mode == Rgb` and `stream.is_some()` from `camera.state().borrow()` first;
- accept that `no_detection` still stops ROI.

Add a roi_flow test: ROI active, then `ai_select_box` in IR returns 409 `rgb_only`, and ROI is still active.

### I2. A 0x20 reply of 0x0 counts as a known resolution
`crates/rgcs-camera/src/siyi/apply.rs:83-90`; uses in `crates/rgcs-camera/src/siyi/exec.rs:91-107, 131-141`; `ui/src/features/video/VideoOverlay.tsx` (`ThermalMarks`)

**What happens.** `apply_encoding` stores `stream: Some((w, h))` for any main-stream reply, including `w == 0` or `h == 0`. Python stores the size only when `width > 0 and height > 0` (`camera_protocol.py` `_handle_frame` 0x20). After a bogus or transitional 0x20 reply (e.g. while the encoder restarts after 0x21):
- `due_polls` treats the stream as known and drops 0x20 polling to every 30 s, so the bad value sticks for up to 30 s.
- `MeasurePoint` and `AiSelectPoint` pass `stream_of` and send 0x12 / 0x56 at pixel (0, 0). `normalized_to_stream_point` clamps to `limit.max(1) - 1 = 0`. Only `AiSelectBox` is refused, through `click_to_stream_box`.
- The UI `clickAction` sees `stream !== null` and sends the command.
- `pointToDisplay` divides by 0, so the IR markers jump to Infinity / NaN.

**Fix.**
- In `apply_encoding`, require `info.width > 1 && info.height > 1` (as Python does), otherwise keep `stream` / `encoding` unchanged.
- Make `stream_of` refuse `w <= 1 || h <= 1` with `stream_unknown`.
- Add an apply test for a 0x20 reply with zero width.

### I3. After an encoding change, the 300 ms re-read can lock in the old resolution for 30 s
`crates/rgcs-camera/src/siyi/session.rs:30, 232-236`; `crates/rgcs-camera/src/siyi/polls.rs:16`

**What happens.** `set_encoding` clears `stream` and schedules one 0x20 re-read 300 ms later. If the MT11 has not finished re-configuring, that reply still carries the old size, e.g. 1920x1080 after asking for 4K. A 0x20 poll that was already in flight before the 0x21 has the same effect. `stream` becomes `Some(old)` and the poll falls back to every 30 s.

**Example.** For up to 30 s, every click maps normalized coordinates onto the wrong pixel grid. On 1080p → 4K, a click at the frame centre selects pixel (960, 540) of a 3840x2160 stream, i.e. the upper-left quarter. The tracker locks onto the wrong object. This is exactly Review Focus 4: "must be refused with stream_unknown (and not mapped onto the old size)". Python has the same 0.3 s re-read, so this is inherited, not new.

**Fix.**
- Remember the requested preset's `(w, h)` in `Media` (`pending_encoding`).
- While it is set, accept a 0x20 reply as the stream size only when it matches the request, and keep polling 0x20 every 1 s.
- Give up after N seconds: accept whatever the camera reports and log it.
- Optionally parse the 0x21 ACK (`payload[1] == 1`, as Python's `encoding_set_ok` does) and clear the pending request on a NACK.

### I4. Auto-record failures are invisible to the operator and never retried
`apps/rgcs-server/src/auto_record.rs:71-97`

**What happens.** On an ARM edge, `RecordStart` can fail:
- `camera_offline`, e.g. the MT11 still booting, a short link drop, or the driver being rebuilt by a profile save;
- `unsupported_capability`;
- an IO error.

The failure is only `tracing::warn!` and an audit row with result `rejected`. No `VehicleMessage` is posted, unlike the SD warning. The edge has already been consumed, so nothing retries when the camera comes back during the flight.

The same applies when `app.cameras.get(sysid)` is `None` at ARM (no driver yet): the function returns silently.

**Example.** The operator arms and expects the auto recording, and flies the whole mission without video on the card.

**Fix.**
- On a failed `RecordStart`, post a warning message, e.g. code `auto_record_failed`, translated like `sd_card_problem`.
- Either keep a "wanted recording" flag per vehicle and retry `RecordStart` while armed and the camera is connected but idle (bounded, e.g. every 5 s), or at least warn.
- On a silent `None` camera with `auto_record` on, warn as well.

---

## Minor

### M1. The clock sample is aged against a time taken before the router lock
`crates/rgcs-camera/src/siyi/session.rs:251-256`

`at = ctx.mono_us()` is taken before `gps.sample().await`. That call takes the router `Mutex`, and `aged()` measures the age at its own later wall time. If the router lock is contended, `received_at_us = at - age` comes out earlier than the truth by the wait. The camera is then set ahead by that wait.

**Fix:** take `at` after the await, or return `received_mono` from the source.

### M2. The GPS sample is aged with the Pi wall clock
`apps/rgcs-server/src/gps_time.rs:31-37`; `crates/rgcs-mavlink/src/router.rs:161-165`

A forward wall-clock step of less than 5 s between the receipt of SYSTEM_TIME and its use (NTP / chrony step on a vehicle Pi) is added directly to the time written to the camera. `Clock.mono_ms` is available in the router.

**Fix:** store `received_mono_ms` and age the sample against the router's monotonic clock.

### M3. A 0x30 NACK is ignored and still reported as ok
`crates/rgcs-camera/src/clock_sync.rs:113-116`; `crates/rgcs-camera/src/siyi/apply.rs:41-53` (no 0x30 arm)

`parse::utc_ack` exists but is never applied. The status is `ok: Some(true)` at send time, and the read-back offset is shown as a successful sync. The offset is likely large and red, but there is no explanation.

**Fix:** apply the 0x30 ACK into `ClockSync`, setting `error: "utc_rejected"` and `ok: Some(false)`.

### M4. The 0x21 ACK is not parsed
`crates/rgcs-camera/src/siyi/apply.rs`

An encoding the camera rejects (e.g. a preset this firmware does not support) is reported to the operator as a successful save. The profile then stores a preset the camera is not using.

**Fix:** expose `encoding_set_ok` or report it through `ai_ack`-style feedback.

### M5. `CameraProfile::validate` does not check `encoding_preset`
`crates/rgcs-core/src/camera.rs:518-547`

`PUT /camera/profile {"encoding_preset":"foo"}` is stored. The UI then shows `h264_1080p`, because `startVideoDraft` falls back to it. Because of that mismatch, saving the sheet sends `encoding h264_1080p` even though the operator changed nothing, which changes the live stream.

**Fix:** validate the preset against `mt11_encoding_presets()` when `kind == siyi_mt11`.

### M6. The cockpit sends clicks while the video is not connected
`ui/src/features/video/Cockpit.tsx:76`; `useOverlayClicks.ts`

The overlay is mounted and clickable whenever `has` is true, including when `live` is false (the 映像未接続 tile). The rect falls back to the stream size or 16:9, so a click on the black tile starts AI tracking on something the operator cannot see.

**Fix:** pass `clickable && live`, and ignore clicks when `!live`.

### M7. Click-handling edge cases
`ui/src/features/video/VideoOverlay.tsx:22-25`; `ui/src/features/video/clickAction.ts:31-35`

- On Windows / Linux, a right-click while holding Ctrl fires `contextmenu` with `ctrlKey` and starts a Ctrl+click AI point select.
  **Fix:** only treat `contextmenu` as a click when `e.button === 0` or on macOS.
- Every plain click in IR logs an `rgb_only` failure, which is noisy.
  **Fix:** return null for plain clicks in IR when the thermal point capability exists.

### M8. `ai_tracking_toggle` and the AI追跡 button decide cancel vs start from `state.track`
`ui/src/features/gimbal-joystick/buttons.ts:38-39`; `ui/src/features/video/CamBar.tsx:72-74`

`state.track` is expired after 1 s without a 0x50. On firmware where the 0x51 push is not working, or after a short gap, the button always starts and never cancels. The camera keeps tracking while the button shows off.

**Fix:** also remember "AI select sent and not cancelled" (e.g. the last `ai_ack` ok after a select), or offer an explicit cancel.

### M9. `ui/src/shared/i18n/index.ts` is 822 lines (limit 800)
This branch adds 2 lines; the file was already 820 on `main`. Split the remaining inline dictionaries into per-feature files, as `cameraMedia.ts` / `cameraVideo.ts` already are.

### M10. `age_ms` on `TrackState` and `ThermalPoint` is always 0
`crates/rgcs-camera/src/siyi/apply.rs` (ledger Task 6)

The field is part of the API (spec 40 §1.3) but never updated. Either refresh it in `expire` or the poll tick, as `gimbal.age_ms` is, or drop it from the type.

### M11. The focus release goes to the current selection
`ui/src/app/Shell.tsx:160-163`

If the selected vehicle changes while a focus button is held, the loop's `releaseAll` sends `focus 0` to the newly selected vehicle. The previous camera keeps focusing until its own timeout, if it has one.

**Fix:** remember the sysid for each pressed focus button.

---

## Review Focus checklist

1. **Click lands elsewhere.**
   - `coverRect` is correct (max scale, centred).
   - The click is measured at that moment against the layer that coincides with `video.feed` (`object-fit: cover`, 100 %).
   - The picture uses the intrinsic `videoWidth` / `videoHeight`.
   - 2画面 is ignored.
   - Remaining gaps: I2 (a 0x0 stream), I3 (old size after an encoding change), M6 (clicks without video).
2. **ROI vs AI.**
   - Every AI start path goes through REST `camera/command`: click, Ctrl+click, the button and the joystick. `cancel_roi_for` covers both select variants.
   - ROI start sends `AiCancel` first. If the 200 ms timeout fires after enqueueing, FIFO still puts the cancel before ROI's 0x07.
   - Gap: I1.
3. **Overlay freeze.**
   - The 250 ms expiry tick is independent of reads.
   - `offline()` clears media on a link drop.
   - 0x51 / 0x5F are re-enabled at tick 0 and every 5 s. OK.
4. **Encoding mid-flight.**
   - `stream` is cleared at 0x21, and clicks are refused until 0x20 answers.
   - Gaps: I2 and I3; also M4 (no 0x21 ACK).
5. **Clock sync.**
   - The state machine never sends without a sample ≤ 5 s old, and the router drops `time_unix_usec == 0` samples and samples not from the FC component.
   - The offset is camera − GPS at the RTT midpoint, and the UI sign matches.
   - Remaining: M1 / M2 (aging), M3 (NACK).

Other checks:
- **camera_state 10 Hz cap:** the final state is always sent. OK.
- **Auto record:**
  - fires only on edges, never on the first observation or a reconnect;
  - duplicates are guarded by `decide` and by `exec::record`, which toggles only on a state mismatch.
  - Gap: I4.
- **Forbidden 0x48:** unreachable.
- **Auth / audit:** new routes use `AuthUser`; commands, refusals and auto record are audited.
- **UI save flow:** commands are skipped when connection fields change (ruling 7).
