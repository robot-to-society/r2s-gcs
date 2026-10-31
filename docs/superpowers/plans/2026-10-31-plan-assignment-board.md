# プランの機体割当ボード Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 割当 mode to the フライトプラン screen. Saved plans (left) are assigned to vehicles (right) by drag & drop or tap-to-place, mouse and touch. One plan may go to many vehicles; a vehicle holds one plan. The server keeps each vehicle's assignment and the last plan id + version written to it, so every vehicle card shows 一致 / 書込待ち / 更新あり / 不明 / 飛行中. Changed vehicles are written in one go, through a confirm sheet that gates armed vehicles.

**Architecture:**
- **Server:**
  - A `plan_assignments` table (one row per vehicle) with store functions and `GET /api/assignments` / `PUT /api/assignments/{sysid}`.
  - A `ServerMessage::Assignments` broadcast whenever a row changes.
  - `POST /api/vehicles/{sysid}/mission/upload {mission_id}` records the written plan id and version when it verifies. A content upload (`PUT …/mission`) clears the record.
- **UI:**
  - An `AssignmentStore` mirrors the server rows (initial GET, then WS frames).
  - Pure functions decide status, compatibility, battery estimate and write targets.
  - The board has three parts: `PlanCards` (left), `VehicleCards` (right), and an assign-mode map overlay.
  - One `useCardDrag` hook implements drag & drop with Pointer Events; tap-to-place and double-tap are a small pure reducer.
  - Writing reuses the batch writer with saved content and mission-last ordering.
- The edit mode stays as it is, except:
  - the open-plan rows show their assigned vehicles as chips instead of a select;
  - the comparison table loses 割当どおり書き込む.

**Tech Stack:** React 19 + TypeScript (vitest, @testing-library), MapLibre GL 5, Rust axum + sqlx SQLite, ts-rs.

**Spec:** `docs/superpowers/specs/2026-10-31-plan-assignment-board-design.md`. Visual reference: the mock at https://claude.ai/artifact/7gUwHAyMUfS7Hb3BrAW1QY (layout, copy, badge colours, ghost, sheet).

## Global Constraints
- **Copy:** Japanese, in a new i18n module `shared/i18n/assign.ts` (ja + en, key prefix `as`), merged in `shared/i18n/index.ts`.
- **Styles:**
  - New styles go in `styles/assign.css`, imported in `main.tsx`.
  - Never hand-edit `styles/prototype.css`. Never run prettier.
  - Lucide icons only, via `shared/ui/icons.tsx`. No text glyphs (`no-glyph-icons.test.ts`).
  - No `window.confirm`.
- **Code style:**
  - TDD: watch each test fail first.
  - Immutable state. Files ≤ 400 lines typical (800 max). Functions < 50 lines.
  - Run `rustfmt --edition 2021` only on the files you touch.
- **Commits:** Conventional. End with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never commit `.claude/`, `auto.crt` or `auto.key`.
- **Vehicles:** No vehicle writes during development except into scratch SITLs (instances 6 / 7). The dev stack's ports are off limits. e2e uses its own server on :8010.
- **Touch targets:** every control on a card is ≥ 44 px high, except the × and the per-card 書き込む button, which are ≥ 28 px and sit away from the card's tap area.
- **Battery estimate:** labelled 目安. Amber above 70 %, red above 100 %.
- **What gets written:** only saved content. A plan with unsaved edits cannot be dragged and says so.

## Rulings made while planning
- **Plan version:** `missions.updated_at` (ms). 一致 means the vehicle's written plan id and version equal its assigned plan's id and current `updated_at`.
- **Write order:** a board write sends fence → rally → mission, with the mission last. The server records the written plan only when the mission upload verifies, so a failed fence or rally leaves the card at 書込待ち.
- **Edit-mode write:** 機体に書き込む uses `POST …/mission/upload {mission_id}` when the plan is saved and unchanged, so the record is kept. Otherwise it uses the content upload, which clears the record (state 不明).
- **Plan ↔ vehicle link:** `plan_assignments.plan_id` references `missions(id) ON DELETE SET NULL`. `written_plan_id` has no foreign key; it is history.
- **Board plan list:** loads summaries, then each full plan via `GET /api/missions/{id}`, cached by `id` + `updated_at`. No new list endpoint.
- **Colours:**
  - An open plan keeps its row colour.
  - Other plans take palette colours in id order, skipping the colours the open rows use (`nextColor` in `features/plans/palette.ts`).
- **Compatibility:** the client-side check mirrors `Mission::validate_for(kind)` on one rule. A rover cannot take a plan whose first item is a takeoff, and an air vehicle needs one. The server's fatal findings still apply at write time.
- **Edit-mode row select:** the per-row vehicle select goes away. `Row.sysid` stays as the edit-mode 対象機体 of that row; the right panel's select sets it.

## Review Focus
1. **Assignment is server state.** Two browser sessions see each other's changes within one WS frame. A failed PUT rolls the optimistic change back and says why. Task 4.
2. **Status correctness.** After a board write, the card reads 一致. Re-saving that plan flips it to 更新あり. Writing other content through the edit mode flips it to 不明. Tasks 3, 5.
3. **Drag on touch must not fight scrolling.** A vertical swipe on a plan card scrolls the list. A 250 ms hold then a move drags. A drag never scrolls the page. Task 7.
4. **Double-tap never undoes the first tap.** A double-tap on a plan card leaves it picked and focuses the map. A double-tap on a vehicle card with a plan picked assigns once and focuses. Task 8.
5. **Armed vehicles are written only when their checkbox is ticked.** A failure on one vehicle never stops the others. Task 13.

---

### Task 1: Assignment table and store
**Files:**
- Create: `crates/rgcs-core/src/assignment.rs`, `crates/rgcs-store/migrations/0015_plan_assignments.sql`, `crates/rgcs-store/src/assignments.rs`
- Modify: `crates/rgcs-core/src/lib.rs`, `crates/rgcs-store/src/lib.rs`

**Interfaces:**
- rgcs-core, ts-exported:
  - `Written { plan_id: i64, plan_updated_at: u64, at: u64, by: String }`. All integers are `#[ts(type = "number")]`.
  - `Assignment { sysid: SysId, plan_id: Option<i64>, assigned_by: Option<String>, assigned_at: Option<u64>, written: Option<Written> }`.
- Migration:
  ```sql
  CREATE TABLE plan_assignments (
    sysid INTEGER PRIMARY KEY,
    plan_id INTEGER REFERENCES missions(id) ON DELETE SET NULL,
    assigned_by TEXT,
    assigned_at INTEGER,
    written_plan_id INTEGER,
    written_plan_updated_at INTEGER,
    written_at INTEGER,
    written_by TEXT
  );
  ```
- Store functions:
  - `list_assignments() -> Vec<Assignment>`, sysid ascending.
  - `set_assignment(sysid, plan_id: Option<i64>, by) -> Assignment`. Upserts. Unknown `plan_id` → `StoreError::NotFound`.
  - `record_written(sysid, plan_id, plan_updated_at, by) -> Assignment`.
  - `clear_written(sysid) -> Assignment`.

- [ ] **Step 1:** Write failing store tests in `assignments.rs`:
  - `set_list_round_trip`: assign plan 1 to sysid 2 and plan 1 to sysid 3; both are listed (one plan, two vehicles).
  - `deleting_a_plan_unassigns_it`: delete mission 1 → `plan_id` is `None`, `written` is kept.
  - `record_and_clear_written`.
  - `unknown_plan_is_not_found`.
- [ ] **Step 2:** Run `cargo test -p rgcs-store assignments`. Expected: FAIL.
- [ ] **Step 3:** Implement the types, the migration and the store functions.
- [ ] **Step 4:** Rerun until PASS. Run `cargo test -p rgcs-core` so the ts-rs bindings appear, then export `Assignment` / `Written` from `ui/src/shared/api/types.ts`.
- [ ] **Step 5:** Commit: `feat(server): plan assignments per vehicle in the store`.

### Task 2: Assignment API and WS broadcast
**Files:**
- Create: `apps/rgcs-server/src/assignment_api.rs`, `apps/rgcs-server/tests/assignment_flow.rs`
- Modify: `apps/rgcs-server/src/app.rs` (routes), `apps/rgcs-server/src/lib.rs`, `crates/rgcs-core/src/ws.rs`

**Interfaces:**
- `GET /api/assignments` → `Assignment[]`.
- `PUT /api/assignments/{sysid}` body `{plan_id: number | null}` → `Assignment`.
  - `404 not_found` for an unknown plan.
  - Audit target `assignment` (`assign` / `unassign`).
- `ServerMessage::Assignments { rows: Vec<Assignment> }`: the full list, sent after every change.

- [ ] **Step 1:** Write failing integration tests:
  - `put_then_get`.
  - `one_plan_on_two_vehicles`.
  - `unknown_plan_is_404`.
  - `needs_a_session`.
  - `a_change_is_broadcast`: subscribe to `state.tx`, PUT, receive `Assignments` with the new row.
  - A ws.rs unit test for the frame tag `{"t":"assignments",…}`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement in the style of `mission_api.rs` (`ok` / `err`, `audit`).
- [ ] **Step 4:** Rerun until PASS. Run clippy.
- [ ] **Step 5:** Commit: `feat(server): /api/assignments with a WS broadcast`.

### Task 3: Record the written plan
**Files:**
- Modify: `apps/rgcs-server/src/mission_api.rs` (`upload_saved` and the content upload handler)
- Modify: `apps/rgcs-server/tests/mission_flow.rs` or a new `tests/assignment_written.rs`

- [ ] **Step 1:** Write failing tests against a scripted vehicle. Copy the pattern of the existing mission-upload flow tests (no SITL).
  - `upload_saved_records_plan_and_version`: upload saved plan 7 to sysid 1 → `GET /api/assignments` shows `written.plan_id == 7` and `plan_updated_at` equal to the plan's `updated_at`. A `ServerMessage::Assignments` is broadcast.
  - `a_failed_or_rejected_upload_records_nothing`: a fatal validation leaves `written` unchanged.
  - `a_content_upload_clears_the_record`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** In `upload_saved`, after `do_upload` returns a verified report, call `record_written` and broadcast. In the content handler, call `clear_written` after a verified write. Keep `do_upload` itself unchanged, so the content path and the saved path share it.
- [ ] **Step 4:** Rerun until PASS.
- [ ] **Step 5:** Commit: `feat(server): remember which saved plan was written to each vehicle`.

### Task 4: AssignmentStore in the UI
**Files:**
- Create: `ui/src/features/assign/api.ts`, `ui/src/features/assign/store.ts`, `ui/src/features/assign/store.test.ts`
- Modify: the WS dispatcher (where `ServerMessage` frames reach the stores, e.g. `shared/ws` or `features/vehicles/store.ts`)

**Interfaces:**
- `listAssignments()` and `putAssignment(sysid, planId | null)`.
- `class AssignmentStore { getState(): ReadonlyMap<number, Assignment>; subscribe; load(); set(sysid, planId): Promise<void>; applyFrame(rows) }`.
- `useAssignments()`.
- `set` is optimistic: on failure it restores the previous row and pushes a local result pill (`cmd_assign`) with the error text.

- [ ] **Step 1:** Write failing tests:
  - `load_fills_from_get`.
  - `set_is_optimistic_and_sent`.
  - `set_rolls_back_on_failure_and_reports`.
  - `a_ws_frame_replaces_the_map`.
- [ ] **Step 2:** FAIL → implement → PASS.
- [ ] **Step 3:** Commit: `feat(ui): assignment store fed by the API and WS`.

### Task 5: Pure board logic
**Files:**
- Create: `ui/src/features/assign/logic.ts`, `logic.test.ts`

**Interfaces (all pure):**
- `cardStatus(a: Assignment | undefined, plan: {id, updated_at} | undefined, online: boolean)`. Returns `'none' | 'pending' | 'ok' | 'updated' | 'unknown'`; the rules are spec §5.
- `compatibility(plan: Mission, kind: VehicleKind) -> string | null`. Returns the i18n key of the reason, or null.
- `batteryPct(plan: Mission, kind, enduranceMin) -> number | null`. Reuses `features/plans/compare.ts` for distance and time.
- `writeTargets(vehicles, assignments, plans) -> number[]`. Online vehicles whose state is pending or updated and whose plan is compatible.
- `planColours(openRows, plans) -> Map<id, colour>` (see the colour ruling).

- [ ] **Step 1:** Write a table-driven test for each function, covering every row of spec §5 and the colour ruling.
- [ ] **Step 2:** FAIL → implement → PASS.
- [ ] **Step 3:** Commit: `feat(ui): assignment status, compatibility and write targets`.

### Task 6: Plan library loader
**Files:**
- Create: `ui/src/features/assign/usePlanLibrary.ts`, `.test.ts`

**Behaviour:**
- `usePlanLibrary()` returns `{ plans: readonly Mission[] | null, error, reload }`.
- It lists the summaries, then fetches each full plan through a cache keyed by `id:updated_at`.
- It refetches after a save or delete in the planner (subscribe to the existing save / delete results, or expose `reload`).
- Open rows that have unsaved edits are flagged `dirty` by matching `ui.savedId`.

- [ ] **Step 1:** Write failing tests:
  - `loads_summaries_then_full_plans`.
  - `cached_by_version`: the same `updated_at` causes no refetch.
  - `marks_open_dirty_plans`.
- [ ] **Step 2:** FAIL → implement → PASS.
- [ ] **Step 3:** Commit: `feat(ui): plan library for the assignment board`.

### Task 7: Drag controller
**Files:**
- Create: `ui/src/features/assign/useCardDrag.ts`, `useCardDrag.test.tsx`

**Behaviour** (spec §4.1, mock):
- Starting a drag:
  - Mouse starts after 4 px of movement.
  - Touch and pen start after a 250 ms hold; moving more than 10 px before then cancels it as a scroll.
  - On start, call `navigator.vibrate(12)` inside a try.
- During a drag:
  - A ghost element follows the pointer.
  - Hit-test targets through `document.elementFromPoint(...).closest('[data-drop]')`.
  - Ask `canDrop(target)` → `null` | reason.
  - The right list auto-scrolls within 40 px of its edges.
  - A document `touchmove` listener (`passive: false`) calls `preventDefault` only while dragging.
- On release: drop calls `onDrop(payload, target)`. Cancel and Esc end the drag. The click that follows a drag is suppressed.

- [ ] **Step 1:** Write failing tests with `fireEvent.pointerDown/Move/Up` and fake timers:
  - `mouse_starts_after_4px`.
  - `touch_needs_a_250ms_hold`.
  - `touch_move_before_hold_is_a_scroll`.
  - `drop_on_a_target_calls_onDrop`.
  - `cannot_targets_are_not_dropped_on`.
  - `the_click_after_a_drag_is_suppressed`.
  - `touchmove_is_prevented_only_while_dragging`.
- [ ] **Step 2:** FAIL → implement → PASS.
- [ ] **Step 3:** Commit: `feat(ui): pointer drag for cards (mouse and touch)`.

### Task 8: Tap-to-place and double-tap
**Files:**
- Create: `ui/src/features/assign/taps.ts`, `taps.test.ts`

**Interfaces:**
- `tap(state, target, now) -> { state, action }`. `target` is `{kind:'plan', id}` | `{kind:'vehicle', sysid}` | `{kind:'empty'}`.
- `action` is `'pick'` | `'unpick'` | `{assign: [planId, sysid]}` | `{focus: target}` | `'none'`.
- The double-tap window is 320 ms (spec §4.3).

- [ ] **Step 1:** Write failing tests:
  - `tap_picks_and_retap_unpicks`.
  - `double_tap_on_a_plan_focuses_and_keeps_it_picked`.
  - `tap_on_a_vehicle_assigns_the_picked_plan_and_keeps_it_picked`.
  - `double_tap_on_a_vehicle_assigns_once_then_focuses`.
  - `empty_or_esc_unpicks`.
- [ ] **Step 2:** FAIL → implement → PASS.
- [ ] **Step 3:** Commit: `feat(ui): tap to place and double-tap to focus`.

### Task 9: Plan cards (left panel)
**Files:**
- Create: `ui/src/features/assign/PlanCards.tsx`, `.test.tsx`, `shared/i18n/assign.ts`, `styles/assign.css`
- Modify: `shared/i18n/index.ts`, `main.tsx`

**Behaviour (as in the mock):**
- A filter box.
- Each card shows: colour chip, name, distance, 離陸あり / 地上走行, and the tag `N 機に割当` / `未割当` / `未保存の変更あり` (lock icon; not draggable).
- The picked card is lifted.
- `data-drag` hooks into `useCardDrag`.
- Clicks go through `taps.ts`.

- [ ] **Step 1:** Write failing tests:
  - `filters_by_name`.
  - `tags_show_the_vehicle_count`.
  - `a_dirty_plan_is_locked_and_says_why_on_tap`.
  - `picked_card_has_aria_pressed`.
- [ ] **Step 2:** FAIL → implement → PASS. Make sure the i18n parity test and the glyph test pass.
- [ ] **Step 3:** Commit: `feat(ui): plan cards for the assignment board`.

### Task 10: Vehicle cards (right panel)
**Files:**
- Create: `ui/src/features/assign/VehicleCards.tsx`, `.test.tsx`

**Behaviour (spec §3.3, mock):**
- A filter box (name, kind, mode).
- The grid has at most 2 columns: `repeat(auto-fill, minmax(196px, 1fr))` inside the panel width. The list scrolls inside the panel. The footer with 変更のある N 機に書き込む is pinned below it.
- Order: online first, then by name.
- Each card shows:
  - kind icon, name, link dot, mode (red `ARMED <mode>` when armed), battery %, GPS 未取得;
  - a slot with the plan chip and ×, or ここへドラッグ / タップで割り当てる / 置けません;
  - the reason line;
  - the status badge;
  - 飛行中;
  - 電池 目安 N%;
  - a per-card 書き込む button when the vehicle is a write target.
- A flash line shows short messages such as 位置が分かりません.

- [ ] **Step 1:** Write failing tests:
  - `online_first_then_name`.
  - `filters_by_name_kind_mode`.
  - `badges_follow_cardStatus`.
  - `armed_is_marked`.
  - `x_unassigns`.
  - `incompatible_cards_say_why_while_a_plan_is_picked`.
  - `footer_counts_write_targets`.
- [ ] **Step 2:** FAIL → implement → PASS.
- [ ] **Step 3:** Commit: `feat(ui): vehicle cards with write status`.

### Task 11: Assign-mode map
**Files:**
- Create: `ui/src/features/assign/assignOverlay.ts`, `.test.ts`
- Modify: `features/mission/MissionMap.tsx` (an `assign` prop that swaps the editing layers for the overlay)

**Behaviour (spec §3.4, §4.3):**
- Draw:
  - every plan in its colour (unassigned ones at 0.38 opacity);
  - vehicle markers;
  - dashed lines from each vehicle to its plan's first positioned item.
- A highlight `{plan}` or `{vehicle}` dims everything unrelated to 0.12.
- Fit:
  - Fit to all plans and positioned vehicles when the mode opens.
  - `focusPlan` reuses `features/plans/frame.ts` + `onFit`.
  - `focusVehicle` frames the vehicle and its plan start, or flashes 位置が分かりません.

- [ ] **Step 1:** Write failing tests:
  - `overlay_features_for_plans_links_and_vehicles` (pure GeoJSON builder).
  - `highlight_dims_the_rest`.
  - `fit_all_includes_vehicles`.
  - `focus_vehicle_without_position_reports`.
- [ ] **Step 2:** FAIL → implement → PASS. Run the MissionMap test suite: the editing layers must be unchanged when `assign` is absent.
- [ ] **Step 3:** Commit: `feat(ui): assignment overlay on the planner map`.

### Task 12: 編集 | 割当 mode
**Files:**
- Create: `ui/src/features/assign/AssignBoard.tsx` (wires Tasks 4–11)
- Modify: `features/mission/MissionView.tsx` (mode state next to `PlanTabs`; in assign mode render `AssignBoard` in place of the left and right panels), `features/plans/PlanList.tsx` (vehicle chips instead of the select; a click opens assign mode), `features/plans/CompareTable.tsx` (drop the write button; the vehicle column lists the assigned names)

**Behaviour:**
- The mode lives in component state, not the URL.
- Going back to 編集 restores the editor untouched.
- The mode switch is hidden while the editor is busy.

- [ ] **Step 1:** Write failing tests in `MissionView.assign.test.tsx`, rewriting the old row-select tests:
  - `assign_mode_swaps_both_panels_and_back`.
  - `row_chips_list_assigned_vehicles_and_open_assign_mode`.
  - `compare_table_has_no_write_button`.
- [ ] **Step 2:** FAIL → implement → PASS. Update the existing tests that used the row select.
- [ ] **Step 3:** Commit: `feat(ui): 編集 | 割当 modes on the flight plan screen`.

### Task 13: Writing from the board
**Files:**
- Modify: `features/plans/batch.ts` (option `missionLast` + `useSaved: true` → `uploadSaved(sysid, id)`), `features/plans/BatchWriteSheet.tsx` (armed rows: red, unchecked checkbox 飛行中の {name} のミッションを置き換える ({mode}), and the AUTO note), `features/plans/useBatchWrite.ts` (targets from `writeTargets`), `features/mission/api.ts` (`uploadSaved`)

- [ ] **Step 1:** Write failing tests:
  - `board_jobs_write_fence_rally_then_mission`.
  - `board_jobs_use_the_saved_upload`.
  - `armed_rows_start_unchecked_and_are_skipped`.
  - `checking_an_armed_row_includes_it`.
  - `one_failure_does_not_stop_the_rest`. Keep this existing test passing.
  - `the_per_card_button_opens_the_sheet_for_that_vehicle`.
- [ ] **Step 2:** FAIL → implement → PASS.
- [ ] **Step 3:** Commit: `feat(ui): write changed vehicles from the assignment board`.

### Task 14: Edit-mode write keeps the record
**Files:**
- Modify: `features/mission/useMissionIo.ts` (`upload`: saved and clean → `uploadSaved`)

- [ ] **Step 1:** Write failing tests:
  - `a_saved_clean_plan_uses_the_saved_upload`.
  - `a_dirty_plan_uses_the_content_upload`.
- [ ] **Step 2:** FAIL → implement → PASS.
- [ ] **Step 3:** Commit: `feat(ui): editor writes of saved plans are recorded`.

### Task 15: Undo toast, docs, e2e and live check
**Files:**
- Create: `ui/src/features/assign/UndoToast.tsx` (+ test), `ui/e2e/assign.spec.ts`
- Modify: `docs/spec/10-screens.md` (new §6.6 割当), `docs/spec/50-api.md` (assignments and the WS frame), `docs/spec/60-data-model.md` (`plan_assignments`)

**Steps:**
- [ ] **Step 1:** Undo toast:
  - Every assign, replace and unassign shows a toast with 元に戻す for 4.5 s.
  - 元に戻す restores the previous plan through `AssignmentStore.set`.
  - Test it.
- [ ] **Step 2:** e2e without SITL:
  - Save two plans through the API.
  - Open 割当.
  - Tap-assign plan A to two vehicles. Cards come from fake vehicles if the e2e server can't provide them; otherwise put this test under `--with-sitl`.
  - Reload: the assignments persist.
  - Unassign one vehicle.
- [ ] **Step 3:** Live check on the dev stack with a Playwright script in the scratchpad (`--sitl 1 --quadplane --rover`):
  - mouse drag, tap-to-place, double-click focus;
  - touch emulation (`hasTouch`, long press) on a 1024 × 768 viewport;
  - a board write cancelled at the sheet (no vehicle writes). The real write is left to the user.
- [ ] **Step 4:** Run the full suite: `cargo test --workspace`, clippy, `npm test -- --run`, `npx tsc`, `npm run lint`, `scripts/e2e.sh`. Update the specs.
- [ ] **Step 5:** Commit: `docs: assignment board in the specs` and `test(ui): e2e for the assignment board`.
