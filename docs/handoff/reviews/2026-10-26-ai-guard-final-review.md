# feat/ai-guard: final whole-branch review

Reviewer: code-reviewer (final). Base: `main...feat/ai-guard` (13 commits, df49995..16901e6).
Re-ran: `cargo test -p rgcs-guard` (all green) and `cargo test -p rgcs-server guard` (38 passed).

Verdict: **WARNING, can merge as experimental.** I found no Critical issues. Fix Important 1 before anyone
enables L2/L3 on a real vehicle. Important 2–4 can wait for the next round.

Counts: Critical 0 · Important 4 · Minor 14 · Declined to judge 5.

---

## Safety invariants checked (evidence)

| # | Invariant | Result |
|---|---|---|
| 1 | The only vehicle action is SetMode ALT_HOLD / QHOVER | **Holds.** The only `VehicleCommand` built in guard code is `SetMode` (`guard_hub.rs:549`, `:589`). `enqueue()` is called only from `execute()` (`guard_hub.rs:496`). `refusal()` re-checks `ALLOWED_MODES` (`:567`) and `recommended_mode(airframe(v)) == mode` (`:583`). The guard uses no `outgoing` path. The AI tools are read-only (`ai_tools_guard.rs`). |
| 2a | toggle + consent 3 + L2 after the countdown / L3 | **Holds.** `Policy::effective_level` caps L2 and L3 at L1 without `auto_ops` (`intervention.rs:39`). `validate` refuses L2+ without consent 3 (`guard_settings.rs:112`). `recheck` runs after the deadline (`intervention.rs:242`). `refusal` checks the level again at send time (`guard_hub.rs:577`). |
| 2b | At most once per arm→disarm | Holds within one server process (`acted_this_flight` survives a clear, a re-detect and a disable/enable). **It does not survive a server restart** (Important 1). |
| 2c | Never after a takeover (RC ≥60 µs for ≥300 ms, operator command, mode change the guard did not make) | Holds, with two gaps: the RC baseline can be missing (Minor 3), and a µs-wide ordering window exists around the operator-command note (Minor 2). |
| 2d | Never on a rover, a plane without VTOL, or an unknown airframe | **Holds.** `Airframe::Other` is never monitored (`sample.rs:54`), `recommended_mode(Other) = None`, and `refusal` checks the airframe on the fresh router state. |
| 3 | Consent 1/2 gates, 0.01° rounding, keys | **Holds.** `policy.enabled = enabled && monitoring`. `EnvHub::gate` requires consent 2 for every external fetch, SWPC included. `round_cell` falls back to 0.01° on a bad step. URLs are never logged (`log_fetch` logs source, host and cell only). Fetch errors are short codes. `key_hint` shows only the last 4 characters. |
| 4 | No real internet or LLM calls in tests | **Holds.** `EnvEndpoints::default()` panics under `cfg(test)`. `real()` is used only in `main.rs:80` and in a shape-only test. `AppState::new` uses `offline()`. |
| 5 | Audit for every guard action | **Holds.** `set_mode` is audited by `ai-guard` on reject, ok, failed and timeout, with mode, alert_id and decision_id. `cancel` is audited with the username. Settings rows go to `ai_intervention`. |
| 6 | Races | Cancel vs. deadline is serialized under the hub mutex: whichever arrives first wins, and a late cancel gets 409. A takeover, cancel or disable that lands between `SendMode` and the worker is caught by `refusal` (phase must still be `Executing` for the same alert id). A disarm mid-countdown goes to Idle on the next tick or sample (≤250 ms), and `refusal` also checks `armed`. After link loss, the post-countdown re-check fails (no fresh Detected) and `precheck` refuses `link_lost`. Vehicles are keyed by sysid and alert id. **A server restart loses the latches** (Important 1). |

---

## Critical

None.

---

## Important

### I1. A mid-flight server restart forgets the per-flight latches, so the guard can act twice in one flight or after a pilot takeover
- File: `apps/rgcs-server/src/guard_hub.rs:292-305` (`adopt`) and `guard_vehicle.rs:108-127` (`VehicleGuard::new` → `Intervention::default()`). Settings are reloaded with consent at startup (`main.rs:86-89`).
- Failure scenario:
  1. The vehicle is at L3 (or L2).
  2. The guard switches it to ALT_HOLD, and the pilot takes over.
  3. The pilot later puts it back in LOITER and centres the sticks.
  4. The Pi's rgcs-server restarts (OOM, watchdog, update, crash). The consent is persisted, so the guard comes back enabled.
  5. A new `VehicleGuard` starts with `acted_this_flight = false`, `hands_off = false` and `commanded = None`.
  6. The next Detected (the same lingering bowl) sends ALT_HOLD again.

  This breaks "at most once per arm→disarm" and "never after takeover". The same happens after a restart in `Executed` / `Unanswered` once the pilot is back in a monitored mode.
- Fix (either one; the first is simplest and safe-side):
  - In `adopt`, when the vehicle is first seen **already armed**, create the machine with `hands_off: true`. That gives alerts only until the next disarm:
    ```rust
    let armed = rx.borrow().armed;
    VehicleGuard::new(sysid, fc, rx).with_machine(Intervention { hands_off: armed, ..Intervention::default() })
    ```
  - Or rebuild the latch from `guard_decisions`. If any row for `open_flight(sysid)` has phase `executing`, `taken_over`, `cancelled`, `refused` or `unanswered`, start hands-off.
  - Add a hub test: an armed vehicle adopted after `apply_settings(L3)` with a bowl must alert and must not queue anything.

### I2. L2 needs a second Detected aligned with the deadline, so a flickering real bowl can loop countdown → alerting → countdown and never act (this is the Task 11 open question)
- File: `crates/rgcs-guard/src/intervention.rs:186-188, 242-258`.
- Failure scenario:
  1. The recheck fails and the machine drops to `Alerting`.
  2. The next Detected calls `start()` from `Alerting`, which starts a **new full 5-s countdown** that again needs a Detected within 1 s of *its* deadline.
  3. A real, still-growing bowl near the sign-A thresholds produces Detected only in bursts. At r = 10 m, 270°/10 s needs v ≥ 4.7 m/s. At r = 15 m it needs about 7 m/s.
  4. Each burst restarts the countdown, and the pilot sees the countdown banner restart again and again.
  5. L2 may never act. That is exactly the "pilot unresponsive" case L2 exists for.

  See the recommendation below.
- Fix: see "Ruling on the L2 re-check".

### I3. Vehicle-initiated mode changes (EKF / RC / battery failsafe) are shown as "引き継ぎ済み" and silence the alert
- Files: `guard_vehicle.rs:232-241` (any mode change the guard did not command → `TakeoverWhy::ModeChange`), `GuardBanner.tsx:74,84` (always `gaTakenOver`), `alerts.ts:10,24` (the UI drops it after 10 s). `GuardAlert` has no `by`/`why` field (`rgcs-core/src/guard.rs:92-118`).
- Failure scenario:
  1. A compass fault causes a bowl, and an EKF failsafe (FS_EKF_ACTION) switches the vehicle to LAND or ALT_HOLD.
  2. The guard reports 「引き継ぎ済み」 in neutral colour, stops the tone, and the row disappears 10 s later.
  3. The operator is told a human took over when no one did. The vehicle is now landing or drifting with no active guard warning.

  Ruling 5 treats any foreign mode change as a takeover, and standing down is correct. The **message** is wrong.
- Fix:
  - Add `taken_over_by: Option<String>` (`rc` / `gcs_command` / `mode_change`) and the current mode to `GuardAlert`.
  - For `mode_change`, show 「モードが {mode} に変わりました — AI はこれ以上操作しません」 in warn style.
  - Do not auto-prune it at 10 s; drop it on `cleared`.

### I4. The SetMode waits behind SQLite writes in the single worker, so L3 latency becomes disk latency
- File: `guard_hub.rs:411-456` (one sequential worker), with emit order from `guard_vehicle.rs:268-280` (Record first "so its id goes into the audit") and `alert_out` (message row).
- Failure scenario:
  1. At L3, `execute` runs only after `messages.record(...)` and `store.record_decision(...)` complete.
  2. On a Pi SD card under contention (log download, flight track writes, prune every 100 inserts), each write can take hundreds of ms to seconds.
  3. The emergency switch is delayed by that much, and `refusal` evaluates a later state.
- Fix:
  - Send `Execute` on its own channel/task, before the record write.
  - Audit with `alert_id` (already unique) and attach `decision_id` later, or write the audit row after the record id is known.
  - Optionally move pruning off this worker.

---

## Ruling on the L2 re-check (Task 11 open question)

**Recommendation: keep the freshness requirement and drop the alignment.** Every SetMode must still follow a
Detected verdict computed in the last `RECHECK_MS = 1 000` ms. The change is in what happens when the countdown
ends without one: do not drop to `Alerting` and restart a full countdown on the next detection. Instead enter a
**due** state that is still cancellable, with a banner such as 「兆候が続けば {mode} へ切り替えます」. Execute on the
first fresh Detected while the detector has not cleared (`clear_ms = 15 s` without Detected). After a Clear the
machine goes to Idle as today.

Reasoning:
- **False-positive cost does not change.** The send still needs a just-computed A && (B || C) over the last 10 s
  window, plus every ruling-4 check (armed, monitored, link, no takeover, no cancel, latch). A decaying bowl, like
  the 6 SITL compass runs, has growth < 0.05 m/s, so A is false and there is no Detected. It still never switches.
  The Task 11 compass result is a **true negative** (those bowls recovered on their own). It is not evidence that
  the rule is too strict.
- **False-negative cost drops.** Today a persistent bowl must produce two Detected verdicts exactly 5 s ± 1 s
  apart, which a flickering detector can miss indefinitely (I2). The cost of that miss is a growing bowl ending in
  a fly-away or crash with an unresponsive pilot, the one case L2 exists for. An unwanted ALT_HOLD costs drift
  with the wind while the pilot is alerted by sound and banner. Missing a real bowl costs more, as long as each
  send still needs fresh evidence.
- **The pilot loses no warning.** The full countdown already ran and was not cancelled. Cancel stays available in
  the due state.
- Do **not** widen `RECHECK_MS` to 3–5 s as the main fix. The SITL data shows it would not help: the last
  Detected was 5 s before the deadline. It would only let older evidence through.

Sketch:
```rust
// Intervention: add `due: bool` (reset on Idle / disarm).
fn recheck(..) -> Step { match .. { Some(m) => self.execute(m, false),
    None => (Self { due: true, ..self.enter(Phase::Alerting, BY_GUARD, None) }, vec![/* alert + record */]) } }
fn start(..) { match (policy.effective_level(), mode) {
    (Level::L2, Some(m)) if self.due => self.execute(m, true),   // fresh Detected after an uncancelled countdown
    (Level::L2, Some(_)) => /* countdown as today */, .. } }
fn on_cancel(..) { match self.phase { Phase::Countdown => .., Phase::Alerting if self.due => self.hands_off_in(Phase::Cancelled, &by, false), _ => .. } }
```
Tests to add:
- In `tests/intervention.rs`: countdown → recheck fails → Detected 3 s later → exactly one `SendMode`.
- Same flow, but cancel while due → no `SendMode`.
- Same flow, but Clear while due → Idle, and the next Detected starts a new countdown.
- In `synthetic.rs` / `sitl_replay.rs`: a persistent growing spiral with B blanked for 2 s around the deadline acts once. The existing compass fixture still never acts.

The banner and `GuardCancel` must also show the cancel button in the due state (today it shows only for `countdown`).

---

## Minor

1. **`execute` is 57 lines (>50)**, `guard_hub.rs:482-538`. Extract the audit + `action_result` reject branch and the spawned outcome task into `reject_action()` / `await_outcome()`. File sizes: `guard_hub.rs` 717, `guard_hub_tests.rs` 781 and `env_tests.rs` 724 lines are under 800 but close. Split them before they grow, for example `guard_worker.rs` (work, write_record, prune, audit) and `guard_hub_tests/{settings,l2,takeover}.rs`.
2. **The operator-command takeover is noted after the enqueue.** `commands.rs:232-238` and `guided.rs:129-138`.
   - Scenario: the guard's deadline fires between the operator's `queue.send(...).await` / `outgoing.send(...).await` and `note_operator_command`. The worker can then pass `refusal`, and the guard's ALT_HOLD is queued *after* the operator's RTL or guided target, overriding it. The window is µs to ms.
   - Fix: call `note_operator_command(sysid)` just before the send, once validation and confirm have passed. A failed send then only makes the guard hands-off, which is the safe side.
3. **The RC baseline can be missing for the whole alert.** `guard_vehicle.rs:311-314` freezes it only when the alert is created. `takeover.rs:61-64` never reports a move without a baseline.
   - Scenario: RC_CHANNELS drops out for ≥1 s exactly as the alert is raised, then resumes. Stick takeover is never detected for this alert, so in Executed the result is `Unanswered` instead of `TakenOver`.
   - Fix: if `baseline()` is `None` and RC is fresh, freeze it on the first frames after it resumes. Or fall back to 1500 µs for roll, pitch and yaw. The LOITER/POSHOLD gate already required centred sticks.
4. **`commanded` is set when `SendMode` is emitted, before `refusal`** (`guard_vehicle.rs:295`). When the action is refused, a later pilot switch to ALT_HOLD in the same flight is not reported as a takeover. This is cosmetic, because the machine is already hands-off. Set it only after `enqueue` succeeds (in `execute`), or clear it on `Refused`.
5. **A timed-out ACK is reported as `Refused` even if the vehicle switched** (`guard_hub.rs:520-536`; `intervention.rs:284`). If the ACK is lost but the heartbeat shows ALT_HOLD, the banner says 「切り替えに失敗しました」 while the vehicle is in ALT_HOLD. Fix: on `Timeout`, compare the router's mode with `commanded` and treat a match as `Executed`.
6. **Deadlines use the wall clock** (`crate::app::unix_ms`). A Pi with no RTC steps its clock at NTP sync.
   - A forward step expires a countdown or takeover wait at once. That is the safe side: the recheck fails, or the result is Unanswered.
   - A backward step freezes `Countdown` / `Executed` until the clock catches up. `RcWatch` and the detector then restart.
   - Fix: drive deadlines from `tokio::time::Instant` (monotonic) and keep Unix ms only for display and records.
7. **The cancel button stays after the local deadline** (`GuardBanner.tsx:92`). A click after the server has moved to `executing` gets 409, and the button re-enables silently. Disable it, or show 「切り替え中」, when `secondsLeft(...) === 0`. Map 409 `not_cancellable` to a visible line.
8. **Failed cancel attempts are not audited** (`guard_api.rs:76-81`). A 404 or 409 cancel is an operator safety action that leaves no trace. Audit it with `result = "rejected"` and the code.
9. **The env chip hides fetch failures while readings are still fresh** (`EnvSummaryChip.tsx:21-27`). This is Task 11 step F: all sources unreachable and the chip still reads 「Kp 7.3」, because observed Kp stays fresh for 4 h. `missing` appears only in the popover. Add a suffix such as 「· 一部取得できず」 when `missing.length > 0`.
10. **The consent-2 gate is checked only when a fetch is claimed** (`env_hub.rs:239-245`). An Open-Meteo or OWM fetch over up to 4 cells keeps sending requests for the remaining cells after consent 2 is withdrawn. Re-check `gate()` before each request in the per-cell loop (`env_fetch.rs:293`). Also, `in_flight` stays true forever if `run_fetch` panics. A drop guard that resets it fixes this.
11. **Monitoring degrades silently below 8 Hz** (`toilet_bowl.rs:193`, min 80 samples in 10 s). Over a lossy radio link the detector never evaluates, and nothing tells the operator. The main deployment (Pi on the vehicle, UART to the FC) makes this unlikely. Still, set a `monitoring_degraded` flag (sample rate < 8 Hz while armed and in a monitored mode) and show it on the 実験機能 card and in the AI tool output.
12. **Per-sample cloning.** `ToiletBowlDetector::push` clones up to 100 `Sample`s (each with a `String` mode) per GLOBAL_POSITION_INT, and `record_out` clones the window again. That is fine at 10 Hz × a few vehicles on a Pi. If vehicle counts grow, intern the mode (`&'static str` / enum) and push into the deque in place.
13. **Test gaps** to add before L2/L3 leave 実験機能:
    - two vehicles at once: cancel one and the other still acts, with a single `set_mode` each;
    - disarm mid-countdown at the hub level (it is tested only in the pure machine);
    - restart with persisted consent and an armed vehicle (I1);
    - AUTO `NAV_LOITER_TURNS`: a move-to-edge leg followed by a constant circle with yaw to the centre (B true). The AUTO 「WP 待機」 proxy admits it, so prove A stays false;
    - RC absent at the alert, then resuming (Minor 3).
14. **`Refused` text for a superseded or not-monitored refusal.** When `refusal` returns `superseded` because a takeover won, `action_result(false)` hits a phase that is no longer `Executing` and is ignored. That is correct. When it returns `not_monitored` (for example, the vehicle has just left LOITER on its own), the banner says 「…への切り替えに失敗しました」. That reads like a failed command when nothing was sent. Consider a separate `not_sent` text.

UI and quality checks passed:
- No `console.log` in the guard, env or app-settings UI.
- Icons are Lucide only: `ShieldAlert`, `FlaskConical`, `CloudSun`, `RefreshCw` and `ExternalLink` were added to `icons.tsx`, and there is no inline `<svg>`.
- The UI calls only read-only GETs from effects; cancel happens only on click.
- `localStorage` use is wrapped in try/catch.
- The pure crates use immutable step / push patterns. `&mut self` in `VehicleGuard` is confined to the host adapter.
- No secrets are committed, and `.claude/`, `auto.crt` and `auto.key` are not in the branch.

---

## Declined to judge

1. **L2 with no connected UI.** The server runs on the vehicle, so during an LTE or radio outage to the browser, a countdown runs that nobody can see or cancel, and L2 behaves like "L3 + 5 s". This matches spec §5.2 (act when unanswered). Requiring that some client received the alert before counting down is a product decision.
2. **Detector thresholds and field tuning.** These are not tuned (Task 11 deviation 7). QuadPlane QHOVER was never exercised live, and SITL could not produce a QuadPlane bowl. Rehearse on real airframes before raising the default above L1.
3. **Kp tie-break expectation** (`swpc_kp` vs. `swpc_kp_1m` as `value.source`). This follows ruling 12 (ties go to the higher class). The plan text is what needs correcting, not the code.
4. **Stale-not-unavailable on a source outage.** This follows ruling 12 and §5.4. I only suggested a UI marker (Minor 9).
5. **The pre-existing flaky `rgcs-camera link_loss_disconnects_and_rebinds`.** It is outside this branch.
