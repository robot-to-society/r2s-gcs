# 複数ミッション(ブリーフィング) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the mission planner, open several missions together as a named, saved "briefing": every mission (route, fence, rally) is drawn on 2D / 3D in its own colour, the crossings / near approaches are labelled with both altitudes, a comparison table shows distance / time / battery estimate, each mission is assigned to a vehicle, and all assigned missions can be written in one go.

**Architecture:**
- The existing single-mission editor (`MissionStore`) stays as-is and always holds the **active** mission.
- A new `BriefingStore` holds the other rows, each with its own parked `MissionUi`. Switching rows swaps the active `MissionUi` in and out, so undo, selection and the dirty flag survive per mission.
- The server gets `briefings` / `briefing_missions` tables that reference saved missions by id, plus CRUD endpoints. The vehicle registry gains `endurance_minutes`.
- Overlays, crossing labels, the comparison table and the batch writer are pure functions with thin React wrappers.

**Tech Stack:** React 19 + TypeScript (vitest, @testing-library), MapLibre GL 5, Rust axum + sqlx SQLite, ts-rs.

**Spec:** `docs/superpowers/specs/2026-10-20-multi-mission-briefing-design.md`

## Global Constraints
- Converse / copy in Japanese. UI strings go in a new i18n module `shared/i18n/briefing.ts` (ja + en), merged in `shared/i18n/index.ts`.
- Glass design:
  - never hand-edit `styles/prototype.css`; new styles go in `styles/briefing.css` (imported in `main.tsx`);
  - Lucide icons only, via `shared/ui/icons.tsx`;
  - no `window.confirm`; use sheets and inline UI.
- Immutable state; files ≤ 400 lines typical (800 max); functions < 50 lines; TDD (watch each test fail first).
- Never run prettier (single quotes, no semicolons); rustfmt only on files you touch (`rustfmt --edition 2021 <file>`). Note that rustfmt on a `lib.rs` also reformats its modules.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never commit `.claude/`, `auto.crt`, `auto.key`.
- A single-mission session must look and work as today: one row, a colour chip and an assignment select are the only additions.
- The battery figure is always labelled 目安 (estimate).
- Approach threshold **30 m** horizontal. Battery warning when estimated use **> 70 %** (30 % return reserve). The reserve is a fixed constant.
- No duplicate mission in one briefing. A vehicle is assigned to at most one row; assigning it again moves it.
- Labels are judged on the **planned** WP lines (not the predicted path) and show planned altitudes with their frame.
- Last save wins (no conflict detection).

## Rulings made while planning (spec deviations / precisions)
- The spec says the unsaved briefing survives a reload "as today". It doesn't today: the mission draft lives only in memory. This plan **adds** browser persistence (`localStorage` key `rgcs.briefing.v1`). Only the present draft, `savedId`, `dirty`, colour, assignment and order are stored; undo history is not.
- "機体から読込" adds a new row (spec §5.1); "新規" adds an empty row; "開く(保存済み)" adds a row; "ファイル読込" adds a row. "ブリーフィングを開く" replaces the whole workspace (behind the existing discard guard when anything is dirty).
- Clicking another mission's route on the map does not switch rows (spec §7 leaves it to the builder). It keeps the map edit-safe; switching happens in the list or by clicking a crossing label's mission name.

## Review Focus
1. Switching the active row with unsaved edits and switching back must restore the edits, the undo stack and the selection. Tested in Task 5.
2. A corrupt or old `localStorage` payload must not break the planner; it starts empty. Tested in Task 5.
3. A briefing that references a deleted mission opens with that row marked 見つかりません; the other rows still load. Tested in Tasks 2 and 12.
4. A batch write where one vehicle is disconnected or its validation is fatal must mark that row ✗ and still write the others. Tested in Task 11.
5. Two missions that share a long parallel leg 10 m apart must not produce dozens of labels; they merge to a few per pair. Tested in Task 6.

---

### Task 1: Briefing types, tables and store

**Files:**
- Create: `crates/rgcs-core/src/briefing.rs`, `crates/rgcs-store/migrations/0008_briefings.sql`, `crates/rgcs-store/src/briefings.rs`
- Modify: `crates/rgcs-core/src/lib.rs` (module + re-exports), `crates/rgcs-store/src/lib.rs` (`pub mod briefings;`)

**Interfaces:**
- Produces (rgcs-core, `#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)] #[ts(export)]`):
  - `BriefingRow { mission_id: i64 (ts number), color: String, sysid: Option<SysId> }`
  - `Briefing { id: Option<i64> (ts number | null), name: String, active_mission_id: Option<i64> (ts number | null), rows: Vec<BriefingRow> }`
  - `BriefingSummary { id: i64, name: String, mission_count: u32, updated_at: u64 (ts number) }`
  - `BriefingFull { briefing: Briefing, missions: Vec<Option<Mission>> }`. `missions[i]` is the mission of `rows[i]`, or `None` when it was deleted.
  - `pub fn validate_briefing(b: &Briefing) -> Result<(), String>`. Rules:
    - name 1–80 chars;
    - ≤ 20 rows;
    - no duplicate `mission_id`;
    - no duplicate non-null `sysid`;
    - colour matches `^#[0-9a-fA-F]{6}$`.
- Produces (store, on `impl Store`):
  - `list_briefings() -> Result<Vec<BriefingSummary>>`, newest `updated_at` first
  - `get_briefing(id: i64) -> Result<Option<BriefingFull>>`
  - `create_briefing(b: &Briefing, created_by: &str) -> Result<Briefing>`
  - `update_briefing(id: i64, b: &Briefing) -> Result<Option<Briefing>>`
  - `delete_briefing(id: i64) -> Result<bool>`
- Migration:
  - `briefings(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, active_mission_id INTEGER, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`
  - `briefing_missions(briefing_id INTEGER NOT NULL REFERENCES briefings(id) ON DELETE CASCADE, position INTEGER NOT NULL, mission_id INTEGER NOT NULL, color TEXT NOT NULL, sysid INTEGER, PRIMARY KEY (briefing_id, position))`
  - No foreign key to `missions`: a deleted mission leaves its row, which shows as missing.

- [ ] **Step 1: Write failing tests**
  - In `crates/rgcs-core/src/briefing.rs` `#[cfg(test)]`, `validate_rejects_duplicates_bad_colours_and_long_lists`: a valid 2-row briefing is `Ok`. Each of these returns `Err`:
    - same `mission_id` twice;
    - same `sysid: Some(2)` twice (two `None`s are fine);
    - colour `"red"`;
    - 21 rows;
    - empty name.
  - In `crates/rgcs-store/src/briefings.rs`, `briefing_round_trip_keeps_order_colours_and_assignments`: create two missions, create a briefing with rows `[m2 #ff0000 Some(3), m1 #00ff00 None]` and `active_mission_id = Some(m1)`. `get_briefing` returns the same rows in order, and `missions` holds `[Some(m2), Some(m1)]`. `update_briefing` with one row replaces the rows. `list_briefings` shows `mission_count` 1.
  - In the same file, `a_deleted_mission_reads_back_as_none`: delete m1, then `get_briefing` returns `missions[1] == None` and still returns 2 rows.
- [ ] **Step 2:** `cargo test -p rgcs-core briefing` and `cargo test -p rgcs-store briefings`. Expected: compile failure or FAIL.
- [ ] **Step 3:** Implement the types, `validate_briefing`, the migration and the store functions. Write rows in one transaction (delete + insert) on create and update.
- [ ] **Step 4:** Rerun both. Expected: PASS. Run `cargo test -p rgcs-core` once more so the ts-rs files appear under `apps/rgcs-server/ui/src/shared/api/generated/`.
- [ ] **Step 5:** Add `Briefing*` exports to `apps/rgcs-server/ui/src/shared/api/types.ts`. Commit as `feat(server): briefings (named sets of saved missions with colour and vehicle per row) in the store`.

### Task 2: Briefing HTTP API

**Files:**
- Create: `apps/rgcs-server/src/briefing_api.rs`, `apps/rgcs-server/tests/briefing_flow.rs`
- Modify: `apps/rgcs-server/src/app.rs` (routes), `apps/rgcs-server/src/lib.rs`, `docs/spec/50-api.md` (new §2.2.2)

**Interfaces:**
- Consumes: the Task 1 store functions and `validate_briefing`.
- Produces routes (session auth, same as `/missions`):
  - `GET /api/briefings` → `BriefingSummary[]`
  - `POST /api/briefings` (body `Briefing`) → 201 + `Briefing`
  - `GET /api/briefings/{id}` → `BriefingFull`
  - `PUT /api/briefings/{id}` → `Briefing`
  - `DELETE /api/briefings/{id}` → `{deleted: true}`
- Errors:
  - `400 invalid` with the validate message;
  - `400 unknown_mission` when a row's `mission_id` does not exist at create/update time;
  - `404 not_found`.
- Every write is audited with target `briefing`, the same way `mission_api` audits.

- [ ] **Step 1:** Write integration tests, using `spawn_app` + `login` from `tests/common`:
  - `create_list_get_update_delete_a_briefing`
  - `rows_must_reference_existing_missions_and_be_valid` (unknown id → 400 `unknown_mission`; duplicate sysid → 400 `invalid`)
  - `a_deleted_mission_comes_back_as_null` (`data.missions[0] == null`)
- [ ] **Step 2:** `cargo test -p rgcs-server --test briefing_flow`. Expected: FAIL (404s).
- [ ] **Step 3:** Implement the handlers in the style of `mission_api.rs` (`ok` / `err` envelopes) and register the routes.
- [ ] **Step 4:** Rerun. Expected: PASS. Then run `cargo clippy -p rgcs-server --all-targets -- -D warnings`. Expected: clean.
- [ ] **Step 5:** Document the routes in spec 50. Commit as `feat(server): /api/briefings CRUD`.

### Task 3: Endurance in the vehicle registry

**Files:**
- Create: `crates/rgcs-store/migrations/0009_endurance.sql` (`ALTER TABLE vehicles ADD COLUMN endurance_minutes INTEGER;`)
- Modify:
  - `crates/rgcs-core/src/logbook.rs` (`VehicleRegistry` and `VehicleRegistryInput` gain `endurance_minutes: Option<u32>`, `#[serde(default)]` on the input)
  - `crates/rgcs-store/src/registry.rs`
  - `apps/rgcs-server/ui/src/features/logbook/schema.ts` and its test
  - `apps/rgcs-server/ui/src/features/app-settings/RegistryForm.tsx`
  - i18n (`regEndurance: '飛行可能時間 (分)'`, `regEnduranceNote: 'ブリーフィングのバッテリー目安に使います'`)

**Interfaces:**
- Produces `VehicleRegistry.endurance_minutes: number | null` (TS). It can be read through the existing `getRegistry(sysid)` in `features/logbook/api.ts`.

- [ ] **Step 1:** Write failing tests:
  - store test `registry_keeps_endurance` (put 25, read back `Some(25)`; default `None`);
  - `schema.test.ts` case: `''` → `null`, `'25'` → `25`, `'-1'` is rejected;
  - RegistryForm test: the field renders and the saved body carries `endurance_minutes: 25`.
- [ ] **Step 2:** Run `cargo test -p rgcs-store registry` and `npx vitest run src/features/logbook src/features/app-settings`. Expected: FAIL.
- [ ] **Step 3:** Implement: the column in SELECT / INSERT / ON CONFLICT, the schema field, and a number input under 製造後総飛行時間.
- [ ] **Step 4:** Rerun. Expected: PASS. Commit as `feat: vehicle endurance (minutes) in the registry`.

### Task 4: Workspace model (pure)

**Files:**
- Create: `apps/rgcs-server/ui/src/features/briefing/model.ts`, `model.test.ts`

**Interfaces:**
- Consumes: `MissionUi`, `INITIAL_MISSION_UI`, `loaded`, `fresh` from `features/mission/store.ts`.
- Produces:
  ```ts
  export const PALETTE: readonly string[] // 8 Glass-friendly hex colours, first = '#9cc9ff' (the accent)
  export interface Row { readonly key: string; readonly color: string; readonly sysid: number | null; readonly missing: boolean; readonly ui: MissionUi }
  export interface Workspace { readonly id: number | null; readonly name: string; readonly rows: readonly Row[]; readonly active: string }
  export function emptyWorkspace(): Workspace                      // one fresh row, active
  export function addRow(ws: Workspace, ui: MissionUi): Workspace   // new key, next unused colour, becomes active; if ui.savedId already in a row → that row becomes active, nothing added
  export function removeRow(ws: Workspace, key: string): Workspace  // last row removed → emptyWorkspace() rows; active moves to a neighbour
  export function moveRow(ws: Workspace, key: string, delta: -1 | 1): Workspace
  export function setColor(ws: Workspace, key: string, color: string): Workspace
  export function assign(ws: Workspace, key: string, sysid: number | null): Workspace // sysid taken by another row → that row becomes null
  export function parkActive(ws: Workspace, ui: MissionUi): Workspace // stores the live editor state into the active row
  export function activate(ws: Workspace, key: string): Workspace     // only changes `active`
  export const activeRow: (ws: Workspace) => Row
  ```

- [ ] **Step 1:** Write the tests:
  - `add_assigns_the_next_unused_colour_and_activates`
  - `adding_a_mission_already_in_the_workspace_selects_it_instead`
  - `assigning_a_taken_vehicle_moves_it`
  - `removing_the_active_row_activates_a_neighbour_and_never_leaves_zero_rows`
  - `move_and_colour_are_immutable` (the original workspace is unchanged)
- [ ] **Step 2:** `npx vitest run src/features/briefing/model.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Keys come from an incrementing counter in the module (`r1`, `r2`, …), reseeded from loaded keys.
- [ ] **Step 4:** Expected: PASS. Commit as `feat(ui): briefing workspace model`.

### Task 5: BriefingStore, row switching and persistence

**Files:**
- Create: `apps/rgcs-server/ui/src/features/briefing/store.ts`, `store.test.ts`, `persist.ts`, `persist.test.ts`

**Interfaces:**
- Consumes: Task 4, plus `MissionStore` (`getState`, `update`) from `features/mission/store.ts`.
- Produces:
  ```ts
  export class BriefingStore { getState(): Workspace; subscribe(l): () => void; update(fn: (w: Workspace) => Workspace): void }
  export const briefingStore: BriefingStore
  export function useWorkspace(store?: BriefingStore): Workspace
  /** Parks the live editor into the active row, then loads `key`'s MissionUi into the editor. */
  export function switchRow(b: BriefingStore, m: MissionStore, key: string): void
  /** Adds a row from a mission (file / saved / vehicle / new) and makes it the live editor. */
  export function openInNewRow(b: BriefingStore, m: MissionStore, ui: MissionUi): void
  /** Replaces the whole workspace (opened briefing) and loads its active row into the editor. */
  export function replaceWorkspace(b: BriefingStore, m: MissionStore, ws: Workspace): void
  // persist.ts
  export const STORAGE_KEY = 'rgcs.briefing.v1'
  export function serialize(ws: Workspace, live: MissionUi): string
  export function restore(text: string | null): Workspace | null   // null on missing / corrupt / wrong version
  ```
- Persistence: a subscriber writes `serialize(...)` to `localStorage`, debounced 500 ms and wrapped in try/catch. On startup, `MissionView` calls `restore` once.

- [ ] **Step 1:** Write the tests:
  - `switching_rows_keeps_each_missions_edits_undo_and_selection`: edit row A, select an item, switch to B, edit B, switch back to A. A's draft, `canUndo` and selection are as left; B's edit is in B.
  - `open_in_new_row_parks_the_current_one`
  - `serialize_restore_round_trip_keeps_order_colour_assignment_dirty_and_draft` (history starts fresh)
  - `restore_ignores_corrupt_or_old_payloads` (`'{'`, `'{"v":0}'` and `null` → `null`)
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
  - `switchRow`: `b.update(w => activate(parkActive(w, m.getState()), key))`, then `m.update(() => activeRow(b.getState()).ui)`.
  - Persisted shape: `{ v: 1, id, name, active, rows: [{ key, color, sysid, missing, savedId, dirty, mission }] }`, where `mission` is `toMission(ui.history.present)`.
- [ ] **Step 4:** Expected: PASS. Commit as `feat(ui): briefing store with per-mission editor state and browser persistence`.

### Task 6: Crossing / approach labels (pure)

**Files:**
- Create: `apps/rgcs-server/ui/src/features/briefing/crossings.ts`, `crossings.test.ts`

**Interfaces:**
- Consumes: `Draft` / `DraftItem` from `features/mission/model.ts`, and `hasPosition` from `features/mission/geo.ts` (use the same "positioned items" rule as the planner's path line).
- Produces:
  ```ts
  export const APPROACH_M = 30
  export const MERGE_M = 80          // labels of one pair closer than this merge into one
  export const MAX_LABELS = 40
  export interface Side { readonly key: string; readonly alt: number; readonly frame: MissionFrame }
  export interface CrossLabel { readonly lat: number; readonly lon: number; readonly kind: 'cross' | 'near'; readonly a: Side; readonly b: Side }
  export function crossLabels(missions: readonly { key: string; draft: Draft }[]): readonly CrossLabel[]
  ```
- Algorithm:
  - Each positioned item gives a leg. Use a local equirectangular projection around the first point (metres).
  - For every leg pair from different missions:
    - if the legs intersect, add a `cross` label at the intersection;
    - otherwise, if their minimum distance is ≤ 30 m, add a `near` label at the midpoint of the closest pair.
  - Altitude: linear interpolation of the leg's two item altitudes at that point. `frame` is that of the leg's end item.
  - Merge labels of the same pair (a, b) within 80 m, keeping the first. Cap the total at 40, crossings first.

- [ ] **Step 1:** Write the tests:
  - `crossing_legs_get_one_label_with_both_interpolated_altitudes` (an X of 200 m legs; altitudes 40→60 and 80→80; the label at the centre reads 50 and 80)
  - `legs_within_30m_get_a_near_label_and_31m_do_not`
  - `a_long_parallel_leg_10m_apart_merges_to_a_few_labels` (1 km leg → ≤ 13 labels)
  - `same_mission_legs_never_label_each_other`
- [ ] **Step 2:** Expected: FAIL. **Step 3:** Implement. **Step 4:** Expected: PASS.
- [ ] **Step 5:** Commit as `feat(ui): crossing and near-approach labels between missions`.

### Task 7: Comparison figures (pure)

**Files:**
- Create: `apps/rgcs-server/ui/src/features/briefing/compare.ts`, `compare.test.ts`

**Interfaces:**
- Consumes: `stats(items, home, speed)` from `features/mission/summary.ts` (`MissionStats { distance_m, duration_s, max_alt }`).
- Produces:
  ```ts
  export const RESERVE = 0.3
  export interface CompareRow { readonly key: string; readonly distanceM: number; readonly durationS: number; readonly batteryPct: number | null; readonly batteryWarn: boolean }
  export function compareRows(rows: readonly { key: string; draft: Draft; enduranceMin: number | null }[]): readonly CompareRow[]
  ```
- `batteryPct = round(durationS / 60 / enduranceMin * 100)`. It is `null` when `enduranceMin` is null or ≤ 0. `batteryWarn = batteryPct > (1 - RESERVE) * 100`.

- [ ] **Step 1:** Write the test `distance_time_and_battery_estimate`: 10 min at 20 min endurance → 50 %, no warning; 15 / 20 → 75 %, warning; no endurance → `null`. **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Commit.

### Task 8: Briefing list in the left sidebar

**Files:**
- Create: `apps/rgcs-server/ui/src/features/briefing/BriefingList.tsx`, `BriefingList.test.tsx`, `apps/rgcs-server/ui/src/shared/i18n/briefing.ts`, `apps/rgcs-server/ui/src/styles/briefing.css`
- Modify: `features/mission/MissionSidebar.tsx` (render `BriefingList` above the WP list), `features/mission/MissionView.tsx`, `features/mission/useMissionIo.ts`, `shared/i18n/index.ts`, `main.tsx`

**Interfaces:**
- Consumes: Tasks 4–5 and the `vehicles` map.
- Produces `BriefingList` props:
  ```ts
  { workspace: Workspace; liveDirty: boolean; vehicles: readonly VehicleState[]; dict: Dict;
    onSwitch(key: string): void; onAssign(key: string, sysid: number | null): void; onRemove(key: string): void;
    onMove(key: string, delta: -1 | 1): void; onColor(key: string, color: string): void }
  ```
- Row markup (one `.brief-row` per row, `aria-current` on the active one):
  - colour chip (opens an 8-swatch popover);
  - mission name;
  - `●` unsaved mark;
  - 見つかりません when `missing`;
  - `<select>` of vehicles plus 未割当;
  - ↑ / ↓ and a remove `IconClose` button.
- `useMissionIo` changes: `loadFile`, `openSaved`, `download` and `fresh` now call `openInNewRow` instead of `loaded` / `fresh` into the live store. The discard guard is dropped for these, since nothing is lost any more.
- Single-mission write: the default target = `activeRow(ws).sysid ?? the current behaviour`.

- [ ] **Step 1:** Write the tests:
  - `BriefingList.test.tsx`:
    - `rows_show_colour_name_assignment_and_unsaved_mark`
    - `clicking_a_row_switches`
    - `choosing_a_vehicle_assigns`
    - `missing_rows_say_so_and_can_be_removed`
  - `MissionView.test.tsx`:
    - `loading_a_file_adds_a_row_instead_of_replacing` (two files → two rows; the first keeps its items)
    - `the_write_button_defaults_to_the_rows_vehicle`
- [ ] **Step 2:** Expected: FAIL. **Step 3:** Implement. **Step 4:** Expected: PASS, and the existing MissionView tests are still green.
- [ ] **Step 5:** Commit as `feat(ui): several missions in the planner (list, colours, assignment, switch)`.

### Task 9: Other missions and labels on the 2D map

**Files:**
- Create: `apps/rgcs-server/ui/src/features/briefing/overlay.ts`, `overlay.test.ts`, `useBriefingOverlay.ts`
- Modify: `features/mission/MissionMap.tsx` (new optional props `others?: readonly OtherMission[]`, `labels?: readonly CrossLabel[]`, `onLabel?: (l: CrossLabel) => void`, wired to the hook)

**Interfaces:**
- Produces:
  ```ts
  export interface OtherMission { readonly key: string; readonly color: string; readonly draft: Draft; readonly predicted: PathPoint[] | null }
  export function othersGeoJson(others: readonly OtherMission[]): { paths: FeatureCollection; fences: FeatureCollection; rally: FeatureCollection } // feature property `color`
  export function useBriefingOverlay(args: { map: RefObject<MlMap|null>; loaded: RefObject<boolean>; others: readonly OtherMission[]; labels: readonly CrossLabel[]; names: ReadonlyMap<string,string>; colors: ReadonlyMap<string,string>; onLabel: (l: CrossLabel) => void }): void
  ```
- Layers, added below the active mission's layers:
  - `briefing-paths` line, width 2, opacity 0.55, `['get','color']`;
  - `briefing-predicted` dashed;
  - `briefing-fence` fill 0.08 + line 0.5;
  - `briefing-rally` circle.
- They are non-interactive: no click handlers.
- Labels are DOM markers `.brief-label`: two lines, `● 北エリア 40 m Rel`, in each mission's colour. Clicking one calls `onLabel`, which focuses the map there.

- [ ] **Step 1:** Write `overlay.test.ts`:
  - `others_carry_their_colour_on_every_feature`
  - `fences_and_rally_of_every_mission_are_included`
  - `the_active_mission_is_not_in_others` (the caller filters it out; assert the builder only uses what it is given)
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Check in the browser on the dev stack (`scripts/dev.sh` running on :5173): load the three test missions from Task 13. Screenshot to `.dev/briefing/2d.png`, read it back and check the colours and labels.
- [ ] **Step 6:** Commit as `feat(ui): every mission, fence and rally of the briefing on the 2D map, crossings labelled`.

### Task 10: Other missions in 3D

**Files:**
- Modify: `features/mission/missionAir.ts`, `features/mission/missionAir.test.ts`, `MissionMap.tsx` (pass `others`)

**Interfaces:**
- Produces `export function othersAirLines(others: readonly OtherMission[], elevAt: ElevAt): AirVertex[][]`. Each mission uses its colour mixed 45 % toward the base `#11161e`, which stands in for transparency since `AirVertex.c` has no alpha.
- In `useMissionAir`, append these lines to `layer.setLines(...)` (new arg `others`), together with fence and rally walls if the active mission draws walls today. Otherwise only the route lines.

- [ ] **Step 1:** Write the test `others_air_lines_use_the_dimmed_mission_colour_and_amsl` (a 2-item mission → one line, colour equals the mix, z from `elevAt + alt` for Rel).
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Browser check in 3D, screenshot `.dev/briefing/3d.png`. Commit as `feat(ui): briefing missions in 3D`.

### Task 11: Comparison table and batch write

**Files:**
- Create: `apps/rgcs-server/ui/src/features/briefing/CompareTable.tsx`, `CompareTable.test.tsx`, `batch.ts`, `batch.test.ts`, `BatchWriteSheet.tsx`, `BatchWriteSheet.test.tsx`, `useEndurance.ts`
- Modify: `features/mission/PlanPanels.tsx` (mission tab right panel: the CompareTable above today's summary when there are ≥ 2 rows, plus a 割当どおり書き込む button), `MissionView.tsx`

**Interfaces:**
- Consumes:
  - Task 7 `compareRows`;
  - `validateMission`, `uploadMission`, `readFence`, `readRally`, `writeFence`, `writeRally` from `features/mission/api.ts`;
  - `getRegistry` from `features/logbook/api.ts`.
- Produces:
  ```ts
  // useEndurance.ts
  export function useEndurance(sysids: readonly number[]): ReadonlyMap<number, number | null>
  // batch.ts
  export interface BatchJob { readonly key: string; readonly sysid: number; readonly mission: Mission; readonly clearFence: boolean; readonly clearRally: boolean }
  export type BatchState = { readonly key: string; readonly phase: 'waiting' | 'writing' | 'done' | 'failed'; readonly reason: string | null }
  export interface BatchDeps { validate: typeof validateMission; upload: typeof uploadMission; writeFence: typeof writeFence; writeRally: typeof writeRally; connected: (sysid: number) => boolean }
  export async function runBatch(jobs: readonly BatchJob[], deps: BatchDeps, onState: (s: BatchState) => void): Promise<void>
  export interface Leftover { readonly fence: number | null; readonly rally: number | null } // null = could not read
  export async function leftovers(jobs: readonly { sysid: number; mission: Mission }[], read: { fence: typeof readFence; rally: typeof readRally }): Promise<ReadonlyMap<number, Leftover>>
  ```
- `runBatch` handles each job in order:
  1. Not connected → `failed` 未接続.
  2. `validate`; a fatal finding → `failed`.
  3. `upload`; not verified → `failed` 照合不一致.
  4. Fence: if `mission.fence.length > 0`, write it; else if `clearFence`, write `[]`. Rally is handled the same way.
  5. `done`.
  6. Any thrown error → `failed` with its message, then continue with the next job.
- `leftovers` reads only for jobs whose mission lacks a fence or rally. A read error → `null`.
- `BatchWriteSheet` (`.sheet`):
  - one line per assigned row: colour, name → vehicle, distance;
  - when `leftover.fence > 0` and the mission has no fence: 前のフェンス N 区画が残っています with a 消す / 残す segmented control (default 残す); the same for rally;
  - `null` shows 不明;
  - buttons 書き込む / キャンセル;
  - while running, each line shows 書込中 / ✓ / ✗ and the reason.
- `CompareTable` columns: colour + name | 機体 | 距離 (`.big`) | 時間 (目安) | バッテリー (目安). The battery cell is amber (`--caution`) when `batteryWarn`, and shows `—` when null.

- [ ] **Step 1:** Write the tests:
  - `batch.test.ts`:
    - `writes_each_job_in_order_and_continues_after_a_failure` (job 2 not connected → failed, job 3 done)
    - `fatal_validation_stops_only_that_job`
    - `clear_flags_write_empty_fence_and_rally_only_when_the_mission_has_none`
    - `leftovers_reads_only_what_is_needed_and_reports_unknown_on_error`
  - `CompareTable.test.tsx`: `distance_is_prominent_and_battery_is_marked_as_an_estimate_and_warns_over_70`
  - `BatchWriteSheet.test.tsx`: `shows_leftovers_with_keep_default_and_passes_the_choice_to_the_jobs`
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit as `feat(ui): briefing comparison table and write-as-assigned with leftover fence / rally choice`.

### Task 12: Save and open a briefing

**Files:**
- Create: `apps/rgcs-server/ui/src/features/briefing/api.ts`, `persistence.ts` (save / open orchestration), `persistence.test.ts`, `BriefingPicker.tsx`, `BriefingPicker.test.tsx`
- Modify: `BriefingList.tsx` (header: name input, ブリーフィングを保存, ブリーフィングを開く), `MissionView.tsx`

**Interfaces:**
- Consumes:
  - `createMission`, `updateMission`, `getMission` from `features/mission/api.ts`;
  - Task 5 `replaceWorkspace`;
  - Task 1 types.
- Produces:
  ```ts
  // api.ts
  export const listBriefings: () => Promise<BriefingSummary[]>
  export const getBriefing: (id: number) => Promise<BriefingFull>
  export const createBriefing: (b: Briefing) => Promise<Briefing>
  export const updateBriefing: (id: number, b: Briefing) => Promise<Briefing>
  export const deleteBriefing: (id: number) => Promise<{ deleted: boolean }>
  // persistence.ts
  export async function saveWorkspace(ws: Workspace, live: MissionUi, deps: { create: typeof createMission; update: typeof updateMission; createB: typeof createBriefing; updateB: typeof updateBriefing }): Promise<Workspace>
  export function workspaceFrom(full: BriefingFull): Workspace
  ```
- `saveWorkspace` steps:
  1. Park `live` into the active row.
  2. Every row that is dirty or has `savedId === null` is saved first (create / update), and its `savedId` and `dirty: false` are updated.
  3. Missing rows are kept out of the saved briefing.
  4. Create or update the briefing.
  5. Return the workspace with `id` set.
- `workspaceFrom`: a `null` mission gives a row with `missing: true` and an empty draft. `active` = the row whose mission is `active_mission_id`, or the first row.
- Opening is `replaceWorkspace` behind the existing discard sheet when any row is dirty.

- [ ] **Step 1:** Write the tests:
  - `persistence.test.ts`:
    - `save_writes_new_and_dirty_missions_first_then_the_briefing_with_their_ids`
    - `saving_twice_updates_instead_of_creating`
    - `workspace_from_marks_deleted_missions_missing_and_restores_the_active_row`
  - `BriefingPicker.test.tsx`: `lists_briefings_newest_first_and_opens_one`
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit as `feat(ui): save and open briefings`.

### Task 13: End-to-end check, spec and docs

**Files:**
- Create: `.dev/briefing/` (screenshots; git-ignored) and `tests/fixtures/briefing/{north,east,south}.waypoints`. These are three Kamikochi survey grids (36.2509, 137.6385), one of which crosses another, and one with a fence.
- Modify: `docs/spec/10-screens.md` (new §6.4 ブリーフィング, summarising the design doc as built)

- [ ] **Step 1:** In the dev stack UI (http://127.0.0.1:5173), with a Playwright script in the scratchpad (pattern: `scratchpad/check-calib.mjs`):
  1. Load the three files.
  2. Assign the vehicle to one row.
  3. Switch rows, edit one, switch back.
  4. Save the briefing as `テスト 3 エリア`, reload the page, open it.
  5. Screenshot the 2D, 3D and comparison table.

  Read the screenshots. Expected: three colours, crossing labels between north and east, the table with three distances, edits intact after the switch and the reload.
- [ ] **Step 2:** Run the write-as-assigned flow against the QuadPlane SITL vehicle only after asking the user (it writes to the vehicle). If they agree, expect ✓ and verify with 機体から読込.
- [ ] **Step 3:** Run the full suites:
  - `cargo test --workspace` → all pass;
  - `npx tsc -b` → clean;
  - `npx vitest run` → all pass;
  - `npx oxlint src` → no new warnings.
- [ ] **Step 4:** Update spec 10 and commit as `docs: spec 10 §6.4 ブリーフィング`.
