# P7 Design Sync (2026-10-18 design) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring every implemented screen in line with the revised Glass prototype (`a83e98b`) and the spec v0.2 of 2026-10-18: Lucide icons and the 6-button nav, the footer log pill + history sheet backed by a server-side message log, acknowledgement of warnings/errors only (recorded and broadcast), the new vehicle markers and map layer order, the gimbal direction fan with optional ground projection, the one-row camera strip, and the 地図表示 app setting.

**Architecture:** `prototype.css` is regenerated from the prototype (`scripts/sync-css.py`, already run on the branch) and components switch to the prototype's class names and markup. Messages become a server concern: a `messages` table (migration `0005_messages.sql`) receives every STATUSTEXT, server link event and command result, the WS `vehicle_message` carries the row id, and acknowledgements go through a REST endpoint that audits and broadcasts `message_ack`. The UI keeps one global log store fed by `GET /api/messages` + WS frames. The gimbal direction is pure geometry in a `features/map/gimbal.ts` module drawn inside the DOM marker (2D fan) or as a GeoJSON polygon layer (ground projection on a flat plane at home elevation; DSM is post-demo).

**Tech Stack:** Rust (axum 0.8, sqlx SQLite, ts-rs), React 19 + TypeScript, `lucide-react`, MapLibre GL, vitest, Playwright.

**Spec:** `docs/spec/10-screens.md` v0.2 (§1 header/footer/log sheet/severity, §3.1 layers/markers/sight/gimbal, §3.3 detail items 3 and 7, §7 アプリ設定 › 地図表示, §10 differences), `docs/spec/20-design-tokens.md` v0.2 (§2 glass, classes table, §9 icons), `docs/spec/40-camera-gimbal.md` §7.2, `docs/spec/50-api.md` (messages, global log, app settings, WS `message_ack`), `docs/spec/60-data-model.md` (app setting), `docs/spec/70-safety-auth.md` (ack audit), `docs/spec/00-overview.md` §7.2. Screens: `design_base/screenshots/glass_ops_2d.png`, `glass_ops_log.png`, `glass_ops_camera*.png`, `glass_ops_2d_gimbal_projected.png`, `glass_maint_app.png`, `glass_user_pop.png`. Prototype: `design_base/project/RGCS Prototype Glass.dc.html`.

## Global Constraints

- **The design is binding** (user, 2026-10-18): copy the prototype's markup, class names and inline values for every element touched; never hand-edit `styles/prototype.css` (regenerate with `python3 -I scripts/sync-css.py`); finish with the screenshot comparison against `design_base/screenshots/glass_*.png` at 1440×813.
- Icons: Lucide only (`lucide-react`), names as in 20 §9; the multicopter is the custom `drone` icon; no text glyphs (▶ ⌂ ◎ …) as icons.
- Nav: 6 buttons `.seg.n6` (344 px): 運用マップ `map`, 全機体映像 `monitor-play`, ミッション `route`, ネットワーク `network`, AI チャット `bot-message-square`, メンテナンス・設定 `settings`. Views without an implementation stay disabled (全機体映像, ネットワーク, AI チャット).
- Severity: STATUSTEXT 0–3 → `error`, 4 → `warn`, 5–7 → `info`; successful `command_result` → `ok`, failed → `error`; server link events `link_lost` → `error`, `comms_delay` → `warn`, `link_restored` → `ok`.
- Only vehicle warnings/errors are acknowledgeable (STATUSTEXT severity ≤ 4 and the server link events `link_lost` / `comms_delay`); anything else → `400 not_ackable`.
- Global log: newest first, `limit` default 500 (max 500); the sheet shows at most 500 rows with the note 「直近 500 件を表示。それ以前はメンテナンス › ログ」.
- Out of scope (ledgered, later phases): the network view's data and canvas (M5, 80 §4), all 3D items (frustum, 3D projection), DSM hillshade, `hfov` per real camera beyond the MT11 default.
- Immutable UI state, files ≤ 400 lines, functions < 50 lines, TDD, no `console.log`, conventional commits with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, never stage `.claude/`.

## Review Focus

1. **STATUSTEXT bursts** (a vehicle spamming PreArm every second): the pill stays one line, the unread badge counts only warnings/errors, the sheet and `/api/messages` stay capped at 500, the table does not grow without bound — Task 2 `messages_are_pruned_to_the_cap`, Task 3 `burst_keeps_one_line_and_counts_alerts`.
2. **Acknowledging the wrong thing**: an `info`/`ok` message or a command result → `400 not_ackable`; acking twice is idempotent (same `acked_by`/`acked_at`, one audit row); another vehicle's message id under this sysid → 404 — Task 2 `ack_rules`.
3. **Server restart**: message history and acked state survive; message ids never collide with pre-restart ids — Task 2 `ids_and_acks_survive_a_restart`.
4. **Gimbal pointing above the horizon with projection on**: no ground polygon, the fan stays; pitch ≤ −80° shows the nadir ring; a vehicle without gimbal attitude or without `gimbal.attitude` caps draws nothing — Task 6 `projection_falls_back_above_the_horizon`, `nadir_ring_when_looking_down`, `no_fan_without_attitude`.
5. **Zoom 165× in the camera strip**: one row, no overlap at the panel width (the spec's explicit case) — Task 7 `strip_stays_one_row_at_max_zoom` (layout measured in Playwright, not jsdom).

---

### Task 1: CSS, Lucide icons, 6-button nav

**Files:** Modify `apps/rgcs-server/ui/package.json` (`lucide-react`), `src/shared/ui/icons.tsx` (re-export Lucide components under the existing `Icon*` names + custom `IconDrone`), every component that renders a text glyph or a hand-drawn icon, `src/app/view.ts` (`'network'` in `View`, `NAV_VIEWS` 6 entries), `src/app/Nav.tsx` (`.seg.n6`, icons per Global Constraints, `aria-label` = view name), `src/shared/i18n/index.ts` (`navNetwork` ネットワーク / Network), `src/styles/prototype.css` (regenerated, already on the branch), `src/app/Nav.test.tsx`, `e2e/shell.spec.ts`.

**Interfaces:**
- Produces: `IconDrone` (24 grid, stroke 2, 4 rotors + centre rounded square — copy the prototype's `#i-drone` symbol paths) and Lucide re-exports used by later tasks: `IconInfo`, `IconCircleCheck`, `IconTriangleAlert`, `IconOctagonX`, `IconChevronUp`, `IconChevronDown`, `IconChevronRight`, `IconHouse`, `IconCar`, `IconMinus`, `IconPlus`, `IconCamera`, `IconSettings`, `IconX`, `IconNetwork`, `IconMonitorPlay`, `IconRoute`, `IconMap`, `IconBotMessageSquare`, `IconWrench`, `IconHistory`, `IconGrip`.
- [ ] **Step 1: Failing tests** — `Nav.test.tsx` `renders_the_six_views_in_spec_order`: 6 buttons with aria-labels 運用マップ, 全機体映像, ミッション, ネットワーク, AIチャット, メンテナンス・設定; 全機体映像 / ネットワーク / AIチャット `aria-disabled`; each button contains an `svg.lucide` (or the drone svg); `shell.spec.ts` nav count 6 and disabled indices `[1, 3, 4]`. A source scan test `no_text_glyph_icons` (vitest reading `src/**/*.tsx`): none of `▶ ⌂ ◎ ✓ ✕ ⚠ ↗` appear in JSX text.
- [ ] **Step 2: Run** `npx vitest run src/app/Nav.test.tsx` — FAIL.
- [ ] **Step 3: Implement** (`npm install lucide-react@<latest 0.x>`; keep `icons.tsx` as the one import point).
- [ ] **Step 4: Run** `npx vitest run && npm run lint && npm run typecheck` — PASS.
- [ ] **Step 5: Commit** `feat(ui): Lucide icons, 6-button nav (network disabled), prototype.css from the 2026-10-18 design`.

### Task 2: Server message log + acknowledgement

**Files:** Create `crates/rgcs-store/migrations/0005_messages.sql`, `crates/rgcs-store/src/messages.rs`, `apps/rgcs-server/src/messages_api.rs`, `apps/rgcs-server/tests/messages_flow.rs`. Modify `crates/rgcs-core/src/ws.rs` (`VehicleMessage` gains `severity_level: Severity`, `source: MessageSource`, `acked_by: Option<String>`, `acked_at: Option<u64>`; new `ServerMessage::MessageAck { sysid, id, by, ts }`), `crates/rgcs-core/src/lib.rs`, `apps/rgcs-server/src/telemetry.rs` (persist before broadcast), `apps/rgcs-server/src/commands.rs` (persist command results), `apps/rgcs-server/src/app.rs` (routes), store `lib.rs`.

**Interfaces:**
- `0005_messages.sql`: `messages(id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL /* unix ms */, sysid INTEGER, source TEXT NOT NULL CHECK (source IN ('vehicle','link','command','system')), severity TEXT NOT NULL CHECK (severity IN ('info','ok','warn','error')), raw_severity INTEGER, text TEXT NOT NULL, acked_by TEXT, acked_at INTEGER)` + index `(sysid, id)`.
- rgcs-core: `pub enum Severity { Info, Ok, Warn, Error }` (snake_case), `pub fn severity_of_statustext(level: u8) -> Severity`, `pub enum MessageSource { Vehicle, Link, Command, System }`, `pub fn ackable(source, severity) -> bool` (Vehicle/Link with Warn/Error), `pub struct LogEntry { id: i64, ts: u64, sysid: Option<SysId>, source, severity, text, ackable: bool, acked_by: Option<String>, acked_at: Option<u64> }`.
- Store: `record_message(&NewMessage) -> Result<LogEntry>`, `messages(sysid: Option<SysId>, since_id: Option<i64>, severity: Option<SeverityFilter /* all | alerts */>, limit) -> Result<Vec<LogEntry>>` (newest first), `ack_message(sysid, id, by) -> Result<AckOutcome /* Acked(LogEntry) | Already(LogEntry) | NotFound | NotAckable */>`, `prune_messages(keep: u32 = 5000)` (called every 1000 inserts).
- WS: `vehicle_message` frames carry the store row id as `id` plus `severity_level`, `source`, `ackable`; `command_result` is persisted as a `LogEntry` and additionally broadcast as `log_entry` (`ServerMessage::LogEntry(LogEntry)`) so the footer sees it; `message_ack {sysid, id, by, ts}`.
- Routes: `GET /api/vehicles/{sysid}/messages?since=` → `[LogEntry]` (that vehicle); `GET /api/messages?since=&severity=all|alerts&sysid=&limit=` → `[LogEntry]` (limit 1..=500, default 500); `POST /api/vehicles/{sysid}/messages/{id}/ack` → `LogEntry` (`400 not_ackable`, `404 not_found`, idempotent), audit target `vehicle`, command `message_ack`, args `{id}`; WS `message_ack`.
- [ ] **Step 1: Failing tests** — store: `records_and_lists_newest_first`, `messages_are_pruned_to_the_cap` (5,100 inserts → ≤ 5,000 rows, newest kept), `ids_and_acks_survive_a_restart` (file DB: insert, ack, reopen → same rows, next id greater); core: `statustext_severity_mapping` (0..=3 error, 4 warn, 5..=7 info) and `only_vehicle_alerts_are_ackable`; server `messages_flow.rs`: `statustext_is_persisted_and_broadcast_with_its_row_id`, `ack_rules` (info → 400 `not_ackable`, command result → 400, warn → 200 then again 200 with same `acked_at`, one `message_ack` audit row, other vehicle → 404, WS `message_ack` frame), `global_log_merges_vehicle_command_and_link_entries` (newest first, `severity=alerts` filters, `limit=2`).
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** `cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings` — PASS; bindings regenerated (`LogEntry`, `Severity`, `MessageSource`, `ServerMessage`).
- [ ] **Step 5: Commit** `feat(server): persistent message log with severity, global log API and warning/error acknowledgement (audited, broadcast)`.

### Task 3: Footer log pill + history sheet

**Files:** Create `src/features/log/` (`store.ts`, `store.test.ts`, `LogPill.tsx`, `LogSheet.tsx`, `LogSheet.test.tsx`, `format.ts`, `index.ts`). Modify `src/app/Footer.tsx` (+test), `src/app/Shell.tsx`, `src/features/vehicles/reducer.ts` (route `vehicle_message` / `log_entry` / `message_ack` into the log store or a `log` slice), i18n (`logTitle` メッセージ履歴, `logAll` すべて, `logAlerts` 警告・エラー, `logEmpty`, `logKeep` 直近 500 件を表示。それ以前はメンテナンス › ログ, `logNewAlerts`, `logSystem` システム).

**Interfaces:**
- `LogState { entries: readonly LogEntry[] /* newest first, ≤ 500 */, unreadAlerts: number, open: boolean, filter: 'all' | 'alerts' | SysId }`; pure `logReduce(state, event)` for `loaded(entries)`, `entry(e)` (dedupe by id, `unreadAlerts += 1` when warn/error and the sheet is closed), `ack({id, by, ts})`, `open(filter?)` (resets `unreadAlerts` to 0), `close()`.
- `LogPill` (prototype footer markup: lead 「全体」 except in maintenance, latest entry icon + time + source + text `.ell`, `.newbadge` with `triangle-alert` 12 px and the count when > 0, chevron up/down, the whole pill a `button.logpill`); clock outside the button as today.
- `LogSheet` (`.g-strong.float.map-c.logsheet`: header `logTitle` + count, `.rg-seg` filters (すべて / 警告・エラー / vehicle name when opened from a vehicle), close `x`; `.list` of `.logrow` rows `sev-*` icon 15 px, time, `.src` (vehicle name or システム), `.txt.ell`, warnings/errors bold; empty text; footer note `logKeep`).
- [ ] **Step 1: Failing tests** — `store.test.ts`: `entry_dedupes_and_counts_only_alerts`, `opening_resets_unread`, `burst_keeps_one_line_and_counts_alerts` (600 entries → 500 kept, unread = alerts among them); `Footer.test.tsx`: latest entry shown with icon/time/source, badge count, click toggles the sheet; `LogSheet.test.tsx`: filters, empty state, note.
- [ ] **Step 2–4:** RED → implement → `npx vitest run && npm run lint && npm run typecheck` PASS.
- [ ] **Step 5: Commit** `feat(ui): footer log pill with unread alerts and the message history sheet`.

### Task 4: Detail panel messages

**Files:** Modify `src/features/detail/DetailPanel.tsx`, `messages.ts`, tests; `src/features/detail/api.ts` (create: `ackMessage(sysid, id)`).

**Interfaces:** last 3 entries of the selected vehicle (`.msg` grid: `sev-*` icon 18 px, `time + title + body`, right column `button.ackbtn` (`.err` for errors) only when `ackable && !acked_by`, otherwise `.acked` 「確認済み」 for acked alerts); acked rows `.done`; header number = this vehicle's unacknowledged alerts; header chevron opens the log sheet filtered to the vehicle; empty 「メッセージはありません」. The ack calls the API; the row turns acked on the WS `message_ack` (and optimistically on the 200).
- [ ] **Step 1: Failing tests** — `only_alerts_have_an_ack_button`, `ack_calls_the_api_and_marks_the_row`, `header_counts_pending_alerts`, `chevron_opens_the_filtered_history`, `empty_state`.
- [ ] **Step 2–4** RED → implement → PASS. **Step 5: Commit** `feat(ui): detail messages acknowledge warnings and errors only, recorded on the server`.

### Task 5: Vehicle markers, home marker, layer order

**Files:** Modify `src/features/map/markers.ts` (+test), `MapView.tsx`, `src/features/mission/*` only where the WP / ROI markers need the white border classes (CSS comes from the prototype).

**Interfaces:** marker DOM exactly as the prototype (`.rg-mk[.sel] > .vmk[.rover] > (.arrow > .hd) + .disc > svg` drone / car, + `.lbl` name pill); heading rotates `.arrow` only; `rg-home` marker with `house` at the vehicle's home (from the known mission home or `HOME_POSITION` when available — if neither, none); MapLibre layer order bottom → top: raster, labels (if any), mission path, tracks, guided target line / sight, DOM markers (an `orderLayers(map)` helper called after any layer is added).
- [ ] **Step 1: Failing tests** — `markers.test.ts`: `copter_marker_has_disc_heading_caret_and_label`, `rover_marker_uses_car_and_light_disc`, `selected_marker_gets_sel`, `heading_rotates_only_the_arrow`; `MapView.test.tsx` (mocked map): `layer_order_puts_mission_below_tracks_below_sight`.
- [ ] **Step 2–4** RED → implement → PASS. **Step 5: Commit** `feat(ui): vehicle markers with heading caret and type icon, home marker, map layer order`.

### Task 6: Gimbal direction fan + ground projection (2D)

**Files:** Create `src/features/map/gimbal.ts` (+test). Modify `markers.ts` (`.fov` svg inside `.vmk`), `MapView.tsx` (projection polygon layer `gimbal-footprint` under the markers), `crates/rgcs-core/src/camera.rs` (`CameraCaps.hfov_deg: Option<f32>`, `#[ts(type = "number | null")]`; MT11 = 62.0 until measured), `crates/rgcs-camera` caps for MT11.

**Interfaces:**
- `bearingOf(headingDeg, gimbalYawDeg) = (heading − yaw + 360) mod 360`; `hfovAt(hfov1Deg, zoom) = 2·atan(tan(hfov1/2)/zoom)` (degrees); `fanLengthPx(pitchDeg) = 48 + 64·cos(pitch)`; `isNadir(pitchDeg) = pitch ≤ −80`; `footprint(lat, lon, altAboveGroundM, headingDeg, yawDeg, pitchDeg, hfovDeg, aspect = 16/9) -> [lng, lat][] | null` — four corner rays to a flat ground plane (home elevation), `null` when any ray does not hit within 1.5 km (above the horizon or too shallow).
- Fan: `.fov` 240×240 svg centred on the marker, rotated to `bearing`, path = isoceles wedge of `hfov` and `fanLengthPx`, `.cone` stroke; nadir → dashed `.nadir` circle; drawn only when the camera caps have `gimbal.attitude` and the state has a gimbal attitude; non-selected vehicles at 0.75 opacity (CSS).
- Projection: when `map.gimbal_ground_projection` (Task 8) is on and `footprint` is non-null → GeoJSON polygon fill `rgba(95,211,155,.16)` + outline `#5fd39b`; otherwise the fan.
- [ ] **Step 1: Failing tests** — `gimbal.test.ts`: `bearing_wraps`, `hfov_narrows_with_zoom` (62° at 1×, ≈ 0.38° at 165×), `fan_shortens_when_looking_down`, `nadir_ring_when_looking_down`, `projection_falls_back_above_the_horizon` (pitch +5 → null; −45 at 100 m → 4 points, nearest edge ≈ 100 m ahead), `no_fan_without_attitude` (marker test); core: `mt11_caps_have_a_horizontal_fov`.
- [ ] **Step 2–4** RED → implement → PASS. **Step 5: Commit** `feat(ui): gimbal direction fan on vehicle markers and optional 2D ground footprint`.

### Task 7: Camera strip in one row, video type on the thumbnail

**Files:** Modify `src/features/camera/CameraStrip.tsx` (+test), `VideoThumb.tsx` (+test), `e2e/camera.spec.ts`.

**Interfaces:** strip markup as the prototype: record toggle, photo (`camera` icon), `.zstep` (− icon button, `.big.num` text ≥ 64 px, + icon button), `.grow`, settings `settings` icon; the RGB / IR / 2画面 segment moves to `VideoThumb` as `.seg.n3.sm.onmap` (left 10, bottom 10, width 168) when thermal modes exist.
- [ ] **Step 1: Failing tests** — `CameraStrip.test.tsx` `zoom_is_a_stepper_with_icons` and `no_video_type_segment_in_the_strip`; `VideoThumb.test.tsx` `video_type_segment_sits_on_the_thumbnail`; Playwright `strip_stays_one_row_at_max_zoom` (set zoom 165 via the sim, assert all strip buttons share one `offsetTop` and do not overlap).
- [ ] **Step 2–4** RED → implement → PASS. **Step 5: Commit** `feat(ui): one-row camera strip with a zoom stepper; video type on the thumbnail`.

### Task 8: App setting 地図表示 (gimbal ground projection)

**Files:** Modify `apps/rgcs-server/src/settings.rs` (`PUT /api/settings/app` accepting `{map: {gimbal_ground_projection: bool}}`, admin not required, audit `settings`/`app_settings_put`), `AppSettings` type (+ `map: MapSettings { gimbal_ground_projection: bool }`), store key `map.gimbal_ground_projection` in `app_settings`, UI `features/app-settings/AppTab.tsx` (new card 地図表示 with `.setrow` + `button.switch[role=switch][aria-checked]` + note copy from 10 §7), Shell passes the flag to `MapView`.
- [ ] **Step 1: Failing tests** — server `app_settings_map_flag_round_trips` (default false, PUT true → GET true, persists across `Store` reopen, audited); UI `map_display_switch_toggles_and_saves` (aria-checked flips, PUT body `{map:{gimbal_ground_projection:true}}`).
- [ ] **Step 2–4** RED → implement → PASS. **Step 5: Commit** `feat: 地図表示 app setting for the gimbal ground projection`.

### Task 9: Screenshot comparison, E2E, docs

**Files:** Modify `.dev/design-sync/compare.html` (rows: ops 2D, ops log sheet, camera strip, gimbal projected 2D, maint app, user popover, maint params), Playwright specs touched by markup changes, `docs/spec/10-screens.md` §10 (what remains different: network view data, 3D, DSM), `docs/plan/implementation-plan.md` (P7 row).
- [ ] **Step 1:** Run the dev stack, take the implementation screenshots at 1440×813 in the same states as the design shots (scratchpad Playwright script), open both in `compare.html`, read the pairs and fix every visible drift (spacing, colour, icon size, copy) in the owning component; ledger each fix.
- [ ] **Step 2:** `scripts/e2e.sh --with-sitl --with-sim --with-video` (dev stack stopped) — green; `tests/pi/accept-stack.sh` on the Docker Pi — green.
- [ ] **Step 3:** Docs; full `cargo test --workspace`, clippy, `npx vitest run`, lint, typecheck, build — green.
- [ ] **Step 4: Commit** `test: design comparison for the 2026-10-18 design; docs sync for P7`.

---

## Self-review notes

- Coverage against spec v0.2: 10 §1 (nav 6, pill, sheet, severity) T1/T3; §3.1 layers/markers/home/sight/gimbal 2D/projection T5/T6/T8; §3.3 strip T7, messages T4; §7 地図表示 T8; 20 §2 glass and classes (CSS regenerated) T1; 20 §9 icons T1; 40 §7.2 T6; 50 messages/global log/ack/app settings T2/T8; 60 app setting T8; 70 ack audit T2. Deferred with reasons: network view (M5 data), 3D, DSM.
- Names used across tasks: `LogEntry`, `Severity`, `MessageSource`, `ackable`, `logReduce`, `bearingOf`, `footprint`, `map.gimbal_ground_projection` — consistent.
