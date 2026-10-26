# Final review: feat/network-view

Scope: the whole branch diff (net-review.diff), checked against the plan's Review Focus 1-5, the rulings and the live-check concerns (a) and (b).
Verified: `cargo test -p rgcs-mavlink link_stats` (9 pass); `rgcs-server` lib (100 pass), `--test network_api` (3), `--test network_sessions` (1); vitest features/network + reducer + Nav (10 files, 86 pass). The Rust tests used a scratch CARGO_TARGET_DIR, and the dev stack was not touched.

Counts: Critical 0 · Important 3 · Minor 9

---

## Important

### I1. Silent vehicle on a live transport: link pill stays green, no stale-rx warning (live concern a)
- **Where:** `apps/rgcs-server/ui/src/features/network/graph.ts:34-36` (`linkStatus` = `!connected || loss > 3`); `crates/rgcs-mavlink/src/link_stats.rs:280-283` (an empty window reads 0 msg/s and 0 % loss).
- **Failure:** The FC browns out, or the radio or serial adapter stops delivering bytes, while the TCP socket to mavproxy or the radio bridge stays up. Loss is computed only over frames that arrive, so the window reads `0 / 0 → 0 %`. The link pill and the link inspector's 状態 row stay green 「接続」, and the summary counts no link warning. The vehicle block does turn amber via router `link`, but the pill and the vehicle disagree.
- **udpin:** the same happens permanently. The socket is "connected" from bind onward, so the pill is green with zero traffic before any vehicle has ever been heard.
- **Fix:**
  - Treat `connected && (last_rx_age_ms === null || last_rx_age_ms > STALE_MS)` as `warn`. A `STALE_MS` of about 3 000 aligns with router `delay`.
  - Add a 「受信なし」/"no data" state text in `inspectLink` and in the pill.
  - Optionally compute a `stale: bool` server-side so the threshold lives in one place.
  - Add a graph test for connected + stale → warn.

### I2. While the link is down, the router is never ticked: the vehicle stays 「正常」 with a frozen heartbeat age (pre-existing, now shown side by side)
- **Where:** `crates/rgcs-mavlink/src/connection.rs:168-169`. `router.tick()` runs only inside `receive_loop`. `run_link` (85-110) does not tick during `RECONNECT_WAIT` or `CONNECT_TIMEOUT`. `apps/rgcs-server/src/network.rs:226-236` reads `message_age_ms` against the frozen `router.now_ms`.
- **Failure:** A TCP or serial link drops and reconnects keep failing (SITL stopped, USB unplugged). The network view then shows:
  - the link pill amber 「切断」;
  - the vehicle block green with `link: ok`;
  - a heartbeat age frozen at its last value.

  The cockpit vehicle list also keeps `ok`, because nothing emits `LinkChanged`. That cockpit behaviour is a safety-relevant bug that predates this branch. The network view is the first screen that puts both facts next to each other, so an operator sees a contradiction.
- **Fix:** In `run_link`, tick the router while disconnected. Either add a 1 s `interval` arm around the connect / sleep, or have `telemetry::diff_loop` call `router.tick(clock)`. That lets `link_status(age)` reach `delay` / `lost` and `heartbeat_age_ms` keep growing. Add a test: no `receive_loop`, advance time, expect `LinkChanged` to `lost`.

### I3. An FC reboot or a dropout longer than 128 frames is counted as loss, modulo 256
- **Where:** `crates/rgcs-mavlink/src/link_stats.rs:96-98, 146-153`. `lost_between` uses only the sequence gap mod 256, and the time since the last frame is ignored.
- **Failure (reboot):**
  - The FC reboots with `last_seq` at 129-255. The first post-boot frame has seq 0, so `gap = 0 - (last + 1) mod 256` = 1..127.
  - The result is counted as up to 127 lost frames. For example, last = 200 gives 55 lost, which against about 250 frames in the 5 s window reads 18 %.
  - The link pill and the AP row go amber and the summary shows 1 警告, for 5 s, on every such reboot.
  - Ruling 4 and Review Focus 2 claim the ≥ 128 resync covers reboots, but it covers only about half of them.
- **Failure (dropout):** A real radio dropout of N frames is reported as `N mod 256` lost, or 0 when the residue is ≥ 128. The number shown is arbitrary.
- **Fix:**
  - Store `last_ms` per component, which already exists. When `now_ms - last_ms` exceeds a resync window, set the baseline instead of counting. 1 000 ms, or about 2× the slowest expected rate, is enough.
  - Report the silence through I1's stale state rather than as loss.
  - Add tests for (last = 200, pause 3 s, seq 0) → 0 lost, and for gap 5 within 100 ms → 5 lost.

---

## Minor

### M1. `last_error` survives a successful connect and renders amber (live concern b)
- **Where:**
  - `link_stats.rs:233-242`: `on_connected` never clears `last_error`.
  - `link_stats.rs:245-251` and `connection.rs:92`: every normal session end writes the generic "link closed", which hides the real reader error that is logged only at `connection.rs:124`.
  - `ui/.../inspect.ts:140`: always `'warn'`.
- **Failure:** After a startup "Connection refused", the inspector of a healthy, connected link shows 最終エラー in amber forever.
- **Fix:** Pick one:
  - clear `last_error` in `on_connected`;
  - or keep it with a timestamp (`last_error_unix_ms`) and render it amber only when `!connected`, neutral and dim with the time otherwise.

  Also pass the reader's actual error (return it from `spawn_reader` / `receive_loop`) instead of "link closed".

### M2. Every logged-in user sees every other user's IP:port, username and browser at 1 Hz
- **Where:** `apps/rgcs-server/src/network.rs:275`, `sessions.rs:30-37`, `network_api.rs:11`.
- **Context:** There is no viewer role today (only Operator and Admin, `rgcs-core/src/operator.rs:9`), and this matches ruling 8, so the risk is low on a field LAN.
- **Failure:** An operator account can enumerate the admin's workstation address.
- **Fix (optional):**
  - Send `addr` only to admins, or send only the IP without the ephemeral port.
  - Mark own versus other sessions.
  - Revisit this when a viewer role lands (70 §).

### M3. The ConnectInfo regression test does not exercise `main.rs`
- **Where:** `apps/rgcs-server/tests/network_sessions.rs:28` builds its own `into_make_service_with_connect_info`.
- **Failure:** If `main.rs:115-118` loses the wrapper, this test still passes. That is exactly Review Focus 3's silent failure mode, and only the live check would catch it.
- **Fix:** Move the serve call into a library fn (`rgcs_server::serve(listener, app, shutdown)`), use it in both `main.rs` and the test.
- **TLS:** The server has no TLS path, so nothing else is affected. `oneshot` tests still work through `Option<Extension<ConnectInfo>>`.

### M4. Half-open WS sockets leave ghost client rows until the TCP timeout
- **Where:** `apps/rgcs-server/src/ws.rs`. There is no ping / pong idle timeout. The guard is correct on every return path.
- **Failure:** A tablet that leaves Wi-Fi without sending FIN stays listed until a send fails (kernel retransmit timeout, minutes). The listing is honest about the socket state but misleading to the operator.
- **Fix:** Send a WS Ping every 10 s and close the session when no Pong or other frame arrives within 30 s.

### M5. Topology size is bounded only by MAX_COMPONENTS and the session count
- **Where:** `network.rs:123-136` and `150-156`. Every component is serialized twice: in `links[].systems` and in `vehicles[].components`. `clients` grows with every open tab.
- **Failure:** A noisy or hostile link that cycles sysid/compid fills all 256 slots, so `systems` is about 25-30 KB/s per WS client on the shared 1 024-slot channel. Many tabs from one account also grow the frame. The 8 KB test covers only the nominal case.
- **Fix (pick any):**
  - cap `systems` to components heard in the last N s;
  - omit the vehicle components from `systems`, or emit only ids;
  - cap the listed clients (for example 32 plus a "+N" count).

### M6. Duplicates arriving over two delayed paths still read as loss
- **Where:** `link_stats.rs:146-153`.
- **Failure:** Path A delivers 10, 11, 12 and path B's delayed 10 then arrives, which resyncs to 10. A's 13 then counts 2 lost. The same happens with two udpin senders using the same ids. This is documented as a Review Focus 2 risk, but nothing mitigates it.
- **Fix:** On a ≥ 128 "backwards" gap, keep the higher baseline instead of resyncing down, or ignore frames whose seq lies within the last 128 behind the baseline.

### M7. Unknown or undecodable frames are counted as lost
- **Where:** Frames the `mavlink` 0.19.1 `ardupilotmega` parser drops never reach `record` (`connection.rs:118-128`). That includes unknown msg ids (CRC extra unknown) and custom companion dialects. The sequence gap then counts them.
- **Failure:** A newer ArduPilot or a companion that emits messages missing from the dialect shows a persistent loss % > 0.
- **Fix:** Document this in the 「受信 (推定)」 tooltip, or hook raw-frame sequence tracking ahead of the parse if the crate allows it.

### M8. Canvas pointer handling: no `pointercancel`
- **Where:** `ui/.../useCanvasGestures.ts:78-89`.
- **Failure:**
  - On touch or pen, a cancelled gesture (OS gesture, alert) leaves the window listeners attached and `dragging` stuck at true until the next pointerdown.
  - The pointer is not captured either, so releasing over an iframe or video is missed.
- **Fix:** Listen to `pointercancel` the same way as `pointerup`, or use `setPointerCapture` on the map.

### M9. Small items
- **Store reads every second:** `network.rs:239-250` makes 1 + N `store.camera_profile*` DB reads per 1 Hz tick (and per GET), even while nobody has the network view open. `receiver_count` counts every WS. Consider caching profiles or reading them from `CameraManager`.
- **Fragile camera line:** `graph.ts:53` parses `compid N` back out of the display string `endpoint`. Send `comp_id` as a field instead.
- **No staleness indicator:** `useNetwork.ts` keeps the last topology when the WS drops. Showing `at_unix_ms` age, or dimming when `link !== 'open'`, would avoid a frozen but healthy-looking map.
- **Shell re-renders:** `Shell` re-renders on every `network_status` because the topology lives in the global vehicles store, even on other screens. This is negligible next to the telemetry rate, but a separate store slice or subscription would isolate it.

---

## Review Focus checklist
1. **Receive-loop stall:** OK.
   - `record` serializes outside the lock (`frame_bytes`) and holds a std Mutex only for the map update.
   - Eviction is O(256) only on first-seen keys once full.
   - `snapshot` holds the lock briefly with no awaits, and `collect` takes one lock at a time.
2. **False loss:** wrap 255→0 is OK and tested. Reconnect reset is OK. Separate (sysid, compid) keys are OK. FC reboot (I3), two-path duplicates (M6) and unknown frames (M7) are still open.
3. **ConnectInfo:** works, and no TLS path is affected. The test does not cover `main.rs` (M3).
4. **Ghost sessions:** the guard covers every return path, and a real-socket close is tested. Half-open TCP is open (M4).
5. **Exposure and load:**
   - `redact_url` strips userinfo, query and fragment, and hides unparsable values (tested).
   - `mavlink_url` holds no credentials by grammar.
   - No tokens or cookies are exposed.
   - The address list is visible to every role (M2), and the size bound is nominal only (M5).
