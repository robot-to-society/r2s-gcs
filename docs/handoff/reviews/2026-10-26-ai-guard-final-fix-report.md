# feat/ai-guard: final-review Important fixes I1–I4

Branch feat/ai-guard, 4 commits on top of 16901e6 (no push). Each was done with TDD: the test was written, run and seen to FAIL, then the fix was written and the test passed.

| Finding | Commit |
|---|---|
| I2 L2 due state | 0b4d1b3 `fix(guard): L2 due state instead of restarting the countdown` |
| I1 first seen armed → alert-only | 32ae217 `fix(guard): alert-only for a vehicle first seen already armed` |
| I3 takeover cause on the alert | 4b5853b `fix(guard): carry the takeover cause and show a foreign mode change as such` |
| I4 SetMode not behind SQLite | 75a405d `fix(guard): send the guard SetMode on its own task, ahead of SQLite writes` |

## I2: L2 "due" state (0b4d1b3)

**What changed**
- New `rgcs_guard::Phase::Due` and `rgcs_core::GuardPhase::Due`. The JSON value is `"due"`, the `guard_decisions.phase` value is `"due"`, and the ts-rs `GuardPhase.ts` was regenerated.
- `recheck` at the deadline:
  - With a fresh Detected (≤ `RECHECK_MS` = 1 000 ms, not widened) it executes, as before.
  - Without one, but still allowed (L2+, not latched), it goes to `Due`. The Due step sends an alert with no sound, writes a record and sets no deadline.
  - If the action is no longer allowed it goes to `Alerting`, as before.
- In `Due`, the first fresh Detected (`on_detected` → `start`) executes. Every other gate still applies (`may_act`, effective level L2, then `refusal` at the hub).
- Other inputs while `Due`:
  - Cancel → `Cancelled`, hands-off.
  - Takeover → `TakenOver`.
  - Clear (15 s) → `Idle` + `Clear`. The next detection starts a fresh countdown.
  - Disable → `Cancelled` (by `disabled`).
  - Policy drops to L1 (consent 3 withdrawn) → `Alerting`.
- Server side:
  - Text is 「兆候が続けば {mode} へ切り替えます」. `action_mode` is set and there is no deadline.
  - `GuardHub::cancel` accepts `Due`. The 409 message is updated.
- UI:
  - The banner line uses `gaDue`: ja 「兆候が続けば {mode} へ切り替えます」, en "Switching to {mode} if the signs continue".
  - 取り消し is shown for `countdown` and `due`.
  - `due` keeps the tone latched.
- Spec `docs/spec/70-safety-auth.md` §4.1 is updated.

**Tests**
- RED: I first added only the `Phase::Due` variant, then ran `cargo test -p rgcs-guard --test l2_due`. 6 of 8 failed.
- `a_flickering_growing_bowl_acts_once` (a 30 s growing spiral; a stick blip 2 s around the deadline blanks sign A for one window).
  - On the old code it acted at 29 600 ms.
  - The test expects 24 600 ms, the first fresh Detected after the blip.
  - The old code was 5 s late because it restarted the full countdown.
- New `crates/rgcs-guard/tests/l2_due.rs` (RED → GREEN):
  - `a_fresh_detection_after_an_uncancelled_countdown_acts_once`
  - `cancel_while_due_sends_nothing`
  - `clear_while_due_goes_idle_and_the_next_detection_counts_down_again`
  - `takeover_and_disable_while_due_never_act`
  - `losing_consent_3_while_due_falls_back_to_alerting`
  - `a_flickering_growing_bowl_acts_once`
- Two tests in that file passed on both the old and the new code; they are regression guards:
  - `a_lowered_level_at_the_deadline_alerts_instead_of_going_due`
  - `the_sitl_compass_bowl_still_never_acts_at_l2` (the SITL compass fixture through detector + L2 machine: no send).
- Updated `tests/intervention.rs`: `l2_rechecks_the_verdict_after_the_countdown` and `l2_detected_more_than_one_second_before_the_deadline_does_not_execute` now expect `Due` instead of `Alerting`. They still expect no send. This change is intended.
- Hub level, in `apps/rgcs-server/src/guard_hub_review_tests.rs` (RED: the text was the headline, not the due line):
  - `l2_due_acts_on_the_first_fresh_detection`: a 1.5 s gap in the position stream across the deadline goes to Due with no send; the bowl resumes and exactly one `SetMode ALT_HOLD` is sent.
  - `l2_due_is_cancellable`: `POST cancel` while due returns 200 `cancelled`, and nothing is sent.
- UI (RED → GREEN):
  - `GuardBanner.test.tsx`: "keeps 取り消し while a due switch waits for the signs to continue" and "names QHOVER in the due line for a QuadPlane" (en).
  - `alerts.test.ts`: the tone latch test extended with `due`.

## I1: first seen armed → alert-only (32ae217)

**What changed**
- `VehicleGuard::new` reads `armed` from the watch. If the vehicle is armed, the machine starts with `hands_off: true` and a new `alert_only` flag is set.
- While `alert_only` is set, the `level` on the alert and on the decision row is capped at L1 (`VehicleGuard::level`).
- Both are reset on disarm, in `host_inputs` and in `while_off`. I did not rebuild anything from `guard_decisions`, as instructed.
- `GuardHub::on_frame` now adopts a vehicle on its first frame **before** the enabled check. "First seen" therefore means first seen by this server process, not first seen while the guard is on.
  - Without this, a vehicle that was seen disarmed while the guard was off and is then enabled mid-flight would be treated as "first seen armed".
  - Adoption is only a router subscribe the first time. While the guard is off, `while_off` still does nothing except a quiet reset on disarm.
- Hub test rig: `copter_rig()` and the QuadPlane test now boot the vehicle disarmed, send one no-op `Wind` frame, then arm (`Rig::boot_then_arm`). Otherwise every existing L2/L3 test would be "first seen armed".
- Spec §4.1 is updated.

**Tests** (`guard_hub_review_tests.rs`)
- RED: `a_vehicle_first_seen_armed_is_alert_only_until_it_disarms`. Settings are applied directly as `main` does at start-up, with consent 3 and L3, and the vehicle is armed before the first frame.
  - Old code: `(Executing, L3)`.
  - Now: `(Alerting, L1)`, `action_mode` null, no queue job for 8 s, and every decision row is `l1`.
  - After a disarm and re-arm, the next flight sends one `SetMode`.
- `a_vehicle_seen_disarmed_while_the_guard_was_off_acts_after_arming` passed before and after the fix. It guards the adopt-while-off choice.

## I3: takeover cause on GuardAlert (4b5853b)

**What changed**
- `GuardAlert` gains two fields. The ts-rs `GuardAlert.ts` was regenerated with `cargo test -p rgcs-core`.
  - `taken_over_by: Option<String>`: `"rc"`, `"gcs_command"` or `"mode_change"`, set only on `taken_over`.
  - `vehicle_mode: String`: the current flight mode.
- Server, for `mode_change`:
  - The text is 「モードが {mode} に変わりました — AI はこれ以上操作しません」, and a **warn** message row is written.
  - The guard still stands down: the machine is unchanged, `TakenOver`, hands-off.
- For `rc` / `gcs_command` the text stays 「引き継ぎ済み」.
- The AI tool output (`ai_tools_guard::alert_json`) now includes `taken_over_by`.
- UI:
  - `alerts.ts` gets `modeChanged()` and `takenOver()`. A mode-change takeover is not pruned at 10 s (it goes on `cleared`), stays in `activeSysids` (vehicle highlight), and keeps its tone latched (mute still works).
  - The banner uses the `warn` class (new `.guard-banner.warn` in `styles/guard.css`, caution tokens; prototype.css untouched) with the line `gaModeChanged`: ja as above, en "The mode changed to {mode} — the AI will not operate this vehicle again".
- **Wording deviation:** the task's example was 「機体側でモードが変わりました」. I used the reviewer's neutral wording instead. The server cannot tell a pilot's RC mode switch from a vehicle failsafe, so "機体側で" could be wrong.
- Spec §4.1 is updated.
- Also in this commit:
  - The I1/I2 hub test files were merged into one `guard_hub_review_tests.rs`, so `guard_hub_tests.rs` stays ≤ 800 (it is 797).
  - The worker `Job::Out` was boxed: the bigger `GuardAlert` tripped clippy `large_enum_variant`. I4 replaced this.

**Tests**
- RED: the hub tests did not compile (no fields yet). There is no separate behavioural RED for the server part; the UI tests gave a behavioural RED.
  - `a_mode_change_the_guard_did_not_make_is_shown_as_such`: an L2 countdown, then the vehicle goes to LAND. The alert is `taken_over`, by `mode_change`, with `vehicle_mode` LAND, the text above, a warn message row, and no send afterwards.
  - `an_operator_command_is_shown_as_taken_over`: `gcs_command`, 「引き継ぎ済み」.
- UI RED → GREEN:
  - `GuardBanner.test.tsx`: "shows a mode change the AI did not make as a warning, not as taken over".
  - `alerts.test.ts`: "keeps a mode-change takeover (and its tone) until cleared".
- Fixtures were updated with the new fields: `features/ai/fixtures.ts` and `app/App.test.tsx`.

## I4: SetMode not queued behind SQLite (75a405d)

**What changed**
- New `apps/rgcs-server/src/guard_worker.rs` (~220 lines): `GuardIo`, `Job` (`Record` / `Message` / `Audit(ActionAudit)` / `Flush`), `Job::of(Out)`, the writer task `work`, `write_record`, `prune` and `audit`. `guard_hub` re-exports `audit`, `AUDIT_TARGET` and `KEEP_DECISIONS`, so other callers are unchanged.
- `GuardHub` has a second channel, `exec`, served by `exec_loop`:
  - `Out::Execute` goes there.
  - `execute()` re-reads the router, runs `refusal` under the hub lock and calls `try_send` on the command queue. It is still the single enqueue site.
  - It is split into `execute` (~20 lines), `await_outcome` and `audit_action`, all under 50 lines.
- The `set_mode` audit row (rejected / ok / failed / timeout) is sent to the writer **behind** the action's `executing` record, which `step()` dispatched first. The writer still looks up `decision_id` by `alert_id`, so audit rows keep `decision_id`.
- `flush()` drains the exec task, then the writer.
- `dispatch` is ~25 lines.
- File sizes: `guard_hub.rs` 721 → 615, `guard_hub_tests.rs` 797, `guard_hub_review_tests.rs` ~205.
- Spec §4.1 is updated.
- Pruning still runs on the writer task. That task no longer blocks the action, so I did not move pruning.

**Tests**
- RED: `l3_sends_while_the_database_is_busy_and_still_audits`. The test holds the only connection of the in-memory pool, which stalls every record and message write, and feeds the bowl at L3.
  - Old code: the `SetMode` never reached the queue within 2 s (`Elapsed`).
  - Now: it is queued at once.
- After the connection is released, the test checks:
  - the `set_mode` audit row has `ok` and `decision_id` is an i64;
  - the `executing` decision row exists.
- The existing `l2_counts_down_then_switches_to_alt_hold_once` (decision_id is i64) and `a_lost_link_at_execution_refuses` (rejected audit) still pass.

## Verification (final tree, 75a405d)

- `cargo test --workspace --no-fail-fast`: 1363 passed, 1 failed, 2 ignored. The only failure is `rgcs-camera mavlink_cam::driver::tests::link_loss_disconnects_and_rebinds`. It also fails when run alone, with `after[before..]` missing `(259.0, 0)`.
  - The final review lists this test as a pre-existing flaky test outside this branch ("Declined to judge" 5). None of these commits touch `crates/rgcs-camera` or `crates/rgcs-mavlink`.
  - Everything else is green: `rgcs-guard` (incl. the new `l2_due`) and `rgcs-server` (incl. the 45 guard tests).
- `cargo clippy --workspace --all-targets -- -D warnings`: clean.
- UI: `npx tsc --noEmit -p tsconfig.app.json` is clean. `npx vitest run --testTimeout=30000`: 252 files, 1564 tests passed.

## Concerns / notes

- **I1 also applies when a vehicle is first seen armed for any other reason.** For example, the guard process starts while the vehicle is already flying (a fresh install, or a GCS restart). That flight is alert-only. This errs on the safe side and is documented in the spec. The alert shows level `l1` while the settings say L2/L3; the UI has no separate "alert-only until disarm" line.
- **I3 tone:** a `mode_change` takeover keeps the tone latched until cleared (≈15 s after the last detection) or muted. That is my judgement of "do not silently drop". Change it in `alerts.ts` `rebased()` if a silent warn is preferred.
- **I2:** the alert in `Due` has no deadline, and the message log gets no row for entering `Due`, only the decision record. Entering `Due` plays no tone; the tone latched from the countdown keeps sounding.
- Minor 4 is unchanged: `commanded` is still set when `SendMode` is emitted. This interacts with I4 only cosmetically.
- `guard_hub_tests.rs` is 797 lines. New hub tests should go into `guard_hub_review_tests.rs` or a new module.
