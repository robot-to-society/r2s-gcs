# 写真測量サーベイグリッド Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "サーベイ" item to the mission planner. It turns a polygon (drawn or loaded from KML) plus camera / overlap / altitude / angle / speed / wind / skip-n / turn settings into ArduPilot items. The items regenerate live as settings change, can be inspected item-by-item before writing, and are saved together with the settings.

**Architecture:**
- **Items are the truth.** `Mission.items` stays the flat list written to the vehicle. A survey is a tag over a contiguous range of items: on the wire `Mission.surveys: [{ id, first, count, spec }]`; in the editor `Draft.surveys` holds `uids`.
- **Pure generator.** `generateSurvey(spec) → MissionItem[]` lives under `ui/src/features/survey/` and is built from small modules: camera math → lanes → turns → items, then metrics and warnings.
- **React wrappers** add a right-panel editor, a grouped list row, map layers and a draw / KML flow.
- **Server:** the server only stores `surveys` as opaque JSON with a range check, and serves a shared camera list.

**Tech Stack:** React 19 + TypeScript (vitest, @testing-library), MapLibre GL 5, zod, Rust axum + sqlx SQLite, ts-rs.

**Spec:** `docs/superpowers/specs/2026-10-21-survey-grid-design.md`

## Global Constraints
- **UI copy:**
  - Japanese first. New strings go in a new `shared/i18n/survey.ts` (ja + en), merged in `shared/i18n/index.ts`.
  - Numbers use the existing `km` / num formatting style (`features/mission/labels.ts`).
- **Design:**
  - Never hand-edit `styles/prototype.css`. New styles go in `styles/survey.css`, imported in `main.tsx`, and reuse the existing Glass classes (`seg`, `row`, `hint caution`, `btn`, `panel-h`).
  - Lucide icons only, via `shared/ui/icons.tsx`.
  - No `window.confirm`.
- **Code rules:**
  - Immutable state.
  - Files ≤ 400 lines typical, 800 max. `MissionView.tsx` is at 399 lines, so survey wiring goes in new hooks and components, not inline.
  - Functions < 50 lines.
  - TDD: watch each test fail first.
  - Never run prettier (single quotes, no semicolons).
  - `rustfmt --edition 2021 <file>` only on files you touch, and never on a `lib.rs`.
- **Commits:** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never commit `.claude/`, `auto.crt`, `auto.key`.
- **Vehicle safety:** never write vehicle parameters. Commands or writes to a vehicle happen only in Task 14, on a scratch SITL.
- **Units:** metres, m/s, degrees, cm/px.
  - Angle 0° = lanes run north–south, increasing clockwise (compass bearing of the lane direction).
  - Altitude frame is always `rel`.
- **Fixed values from the spec:**

  | Value | Fixed at |
  |---|---|
  | Initial camera "Sony α7R IV 35mm" | sensor 35.7 × 23.8 mm, 9504 × 6336 px, focal 35 mm, shutter 1/1000 s, min interval 1.0 s, built-in |
  | Default bank angle | 30° |
  | Blur warning | > 1 px |
  | Overlap warning | worst overlap < set value − 10 percentage points |
  | Auto edge margin | half the footprint, per axis |
  | Default wind | 0 m/s |
  | Worst ground speed | airspeed + wind |

- **Constants this plan fixes** (spec §7 left them to the builder):

  | Constant | Value | Meaning |
  |---|---|---|
  | `ARC_SPLIT_DEG` | 30 | Largest angle of one split-WP arc segment |
  | Auto lead-in | ceil5(R) | |
  | Auto overshoot | ceil5(R / 2) | `ceil5` rounds up to a multiple of 5 m |
  | `ENTRY_TOL_M` | 5 | Predicted path deviation that warns |
  | `MAX_SURVEY_ITEMS` | 700 | Warns `too_many` |
  | Terrain samples | ≤ 2000 per survey | |

  Also fixed by this plan:
  - **Speed after a survey:** not restored (it carries over until the next `DO_CHANGE_SPEED`).
  - **Photo phase:** not aligned between lanes.
  - **`.rgcsmission`:** `version` stays 1; `surveys` is an optional field.

## Rulings made while planning
- **The editor tracks a survey by item `uid`s, not indices.** Inserting or deleting items before a survey therefore keeps it automatically. Indices (`first`, `count`) exist only on the wire (`toMission` / `fromMission`).
- **`reconcileSurveys` runs inside `edit()` after `remapJumps`.** It drops a survey (detaching its items to plain WPs) when an edit outside the survey ops changes, removes or reorders any item in its range. The drop is reported through `MissionUi.surveyNotice`.
- **The start corner is chosen by geography.** The four candidate entries are the first or last lane × entering from either end. `nw / ne / sw / se` picks the candidate whose entry point maximises (±lat, ±lon); `home` picks the entry nearest home.
- **Ω turn** (d < 2R; along x, lane offset d to the left, R = radius):
  - C1 = (0, −R), C2 = (√(4R² − (d/2 + R)²), d/2), C3 = (0, d + R).
  - The path is arc about C1 (clockwise), then arc about C2 (counter-clockwise), then arc about C3 (clockwise).
  - Mirror it for a turn to the right.
  - The turn starts at the farther of the two lane ends (x_turn = max of both ends along track), so both lanes are extended straight to it.
- **`DO_SET_CAM_TRIGG_DIST` params:**
  - Start of the shooting section: `[dist, 0, 1, 0]` (p3 = 1, trigger once now).
  - End of the shooting section: `[0, 0, 0, 0]`.
- **`DO_CHANGE_SPEED` params:** `[0, speed, -1, 0]` for plane (airspeed), `[1, speed, -1, 0]` for copter (ground speed).
- **`WP_RADIUS` matters.** Plane counts a WP as reached `WP_RADIUS` early (default 90 m), so split arcs get cut. The spec stores `wpRadiusM`. A warning `wp_radius` fires when `wpRadiusM` > half the split chord. The predicted path makes the effect visible. The vehicle parameter is never written.

## Review Focus
1. **A degenerate polygon:**
   - Inputs: fewer than 3 vertices, zero area, or a self-intersecting ring from a bad KML.
   - Expected: no items, a panel message (`invalid_polygon`), no throw.
   - Tested in Tasks 4 and 6.
2. **A concave polygon** where a lane line crosses it in 2+ intervals:
   - Each interval becomes its own lane.
   - The trigger is off between the intervals.
   - Tested in Task 4.
3. **Normal edits around a survey:**
   - An edit before the survey keeps it.
   - An edit inside drops it with a notice.
   - Undo brings it back.
   - Tested in Task 9.
4. **Old data loads unchanged:**
   - Inputs: an old `.rgcsmission`, a stored mission, or a `rgcs.briefing.v1` payload without `surveys`.
   - Expected: it loads exactly as before.
   - A survey whose `spec` fails the zod schema is dropped and its items kept.
   - Tested in Tasks 1 and 9.
5. **Large areas:**
   - A 2 km × 1 km area at 1 cm/px regenerates in < 200 ms in vitest.
   - The item count warning appears instead of freezing.
   - Tested in Task 6.

---

### Task 1: Core + store: `Mission.surveys`

**Files:**
- Modify: `crates/rgcs-core/src/mission.rs` (struct `Mission`, `Mission::validate`)
- Create: `crates/rgcs-store/migrations/0010_mission_surveys.sql`
- Modify: `crates/rgcs-store/src/missions.rs` (row mapping, insert, update)
- Test: the existing test module of `mission.rs` and `crates/rgcs-store` mission tests
- Regenerated: `apps/rgcs-server/ui/src/shared/api/generated/{Mission,SurveyBlock}.ts`

**Interfaces:**
- Produces:
  - Rust: `pub struct SurveyBlock { pub id: String, pub first: u32, pub count: u32, #[ts(type = "unknown")] pub spec: serde_json::Value }`.
  - `Mission` gains `#[serde(default)] pub surveys: Vec<SurveyBlock>`.
  - TS: `Mission.surveys: Array<SurveyBlock>`.

- [ ] **Step 1: Write failing tests**
  - `validate_flags_survey_out_of_range`: a mission with 3 items and `surveys: [{first: 2, count: 2}]` yields a `Fatal` finding `survey_range`.
  - `validate_flags_overlapping_surveys`: `[{first: 0, count: 2}, {first: 1, count: 2}]` yields `survey_range`.
  - `mission_without_surveys_deserializes`: JSON without the key gives `surveys == []`.
  - Store `surveys_round_trip`: create, get, update, get keeps `surveys` with the spec JSON unchanged.
- [ ] **Step 2:** `cargo test -p rgcs-core survey` and `cargo test -p rgcs-store surveys`. Expected: FAIL to compile (no field).
- [ ] **Step 3: Implement.**
  - Migration: `ALTER TABLE missions ADD COLUMN surveys TEXT NOT NULL DEFAULT '[]';`.
  - Store: read and write it like `fence` / `rally`.
  - Validate: emit `survey_range` when `first + count > items.len()`, when `count == 0`, or when ranges overlap.
  - Fix every `Mission { .. }` literal in the workspace (`cargo build --workspace` finds them).
- [ ] **Step 4:** `cargo test -p rgcs-core && cargo test -p rgcs-store && cargo test -p rgcs-server`. Expected: all PASS, and `generated/Mission.ts` now has `surveys`.
- [ ] **Step 5:**
  - Fix the TS compile: add `surveys: []` to `emptyDraft()`, and to any TS `Mission` literal `tsc` reports.
  - Run `cd apps/rgcs-server/ui && npx tsc --noEmit -p .`. Expected: clean.
  - Commit `feat(core): missions carry survey ranges`.

### Task 2: Server: shared survey camera list

**Files:**
- Create:
  - `crates/rgcs-core/src/survey_camera.rs`
  - `crates/rgcs-store/migrations/0011_survey_cameras.sql`
  - `crates/rgcs-store/src/survey_cameras.rs`
  - `apps/rgcs-server/src/survey_camera_api.rs`
  - `apps/rgcs-server/tests/survey_camera_flow.rs`
- Modify:
  - `crates/rgcs-core/src/lib.rs` (`pub mod` + re-export)
  - `crates/rgcs-store/src/lib.rs`
  - `apps/rgcs-server/src/app.rs` (routes), `apps/rgcs-server/src/lib.rs`
  - spec 50 (API list, next to §2.2.2 briefings)

**Interfaces:**
- Produces:
  - `SurveyCamera { id: Option<i64>, name: String, sensor_w_mm: f32, sensor_h_mm: f32, image_w_px: u32, image_h_px: u32, focal_mm: f32, shutter_s: f32, min_interval_s: f32, builtin: bool }` (ts-rs; `id` as `number | null`).
  - `validate_survey_camera(&SurveyCamera) -> Result<(), String>`: name non-empty and ≤ 80 chars; all numbers finite and > 0; `shutter_s` ≤ 1.
  - Routes:
    - `GET /api/survey-cameras` returns a list, built-ins first, then by name.
    - `POST /api/survey-cameras` returns the created camera.
    - `PUT /api/survey-cameras/{id}` and `DELETE /api/survey-cameras/{id}`.
  - Errors:
    - `400 invalid`.
    - `404 not_found`.
    - `409 builtin` on PUT or DELETE of a built-in.
  - A client-supplied `builtin: true` is ignored (always false).
  - Audit target `survey_camera`.

- [ ] **Step 1: Write the failing flow test** (copy the `briefing_flow.rs` setup):
  - A fresh server lists exactly one camera, `Sony α7R IV 35mm`, with the Global Constraints values and `builtin: true`.
  - Create, then update, then delete a custom camera.
  - Deleting the built-in returns 409 `builtin`.
  - Posting `focal_mm: 0` returns 400 `invalid`.
  - Unauthenticated requests return 401.
- [ ] **Step 2:** `cargo test -p rgcs-server --test survey_camera_flow`. Expected: FAIL.
- [ ] **Step 3: Implement.** The migration creates the table and seeds the built-in row. Handlers follow the `briefing_api.rs` patterns (`store_error`, `ok`, `err`, audit).
- [ ] **Step 4:** `cargo test -p rgcs-server && cargo test -p rgcs-core && cargo clippy --workspace -- -D warnings`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(server): shared survey camera list`.

### Task 3: Survey spec + camera math

**Files:**
- Create:
  - `ui/src/features/survey/spec.ts`
  - `ui/src/features/survey/photo.ts`
  - Tests: `spec.test.ts`, `photo.test.ts`

**Interfaces:**
- Produces, in `spec.ts`:
  - `SurveyCameraValues = { name, sensorWmm, sensorHmm, imageWpx, imageHpx, focalMm, shutterS, minIntervalS }`.
  - `SurveySpec`:
    ```ts
    {
      version: 1
      name: string
      polygon: LatLon[]
      camera: SurveyCameraValues
      orientation: 'landscape' | 'portrait'
      altM: number
      frontPct: number
      sidePct: number
      angleDeg: number
      start: 'nw' | 'ne' | 'sw' | 'se' | 'home'
      speedMs: number
      windMs: number
      skip: number
      turn: 'split' | 'arc'
      bankDeg: number
      leadInM: number | null
      overshootM: number | null
      marginM: number | null
      airframe: 'plane' | 'copter'
      wpRadiusM: number
    }
    ```
    `null` means automatic.
  - `surveySpecSchema` (zod).
  - `ALPHA7R4: SurveyCameraValues`.
  - `defaultSpec(polygon, camera, airframe, opts?: { bankDeg?, wpRadiusM?, speedMs? }) → SurveySpec`. Defaults: alt 100, front 80, side 70, angle = bearing of the longest polygon edge (mod 180), start `home`, speed 18 (plane) / 8 (copter), wind 0, skip 0, turn `split`, bank 30, nulls for auto, wpRadius from opts or 90.
- Produces, in `photo.ts`:
  - `Footprint = { alongM, acrossM }`.
  - `gsdCm(cam, altM)` and `altForGsd(cam, gsdCm)`.
  - `footprint(cam, altM, orientation)`: in `landscape` the long sensor side is across track.
  - `triggerDistM(fp, frontPct)` and `laneSpacingM(fp, sidePct)`.
  - `blur(cam, groundMs, gsdCm) → { cm, px }`.
  - `turnRadiusM(groundMs, bankDeg)`, with g = 9.80665.

- [ ] **Step 1: Failing tests** (α7R IV, alt 100, landscape):
  - `gsdCm` ≈ 1.0732 (±1e-3).
  - `footprint` = `{ alongM: 68.0, acrossM: 102.0 }` (±1e-6); `portrait` swaps them.
  - `triggerDistM(fp, 80)` ≈ 13.6 and `laneSpacingM(fp, 70)` ≈ 30.6.
  - `altForGsd(cam, 2)` ≈ 186.35.
  - `blur(cam, 20, 1.0732)` = `{ cm: 2.0, px ≈ 1.8635 }`.
  - `turnRadiusM(18, 30)` ≈ 57.22 and `turnRadiusM(22, 30)` ≈ 85.48.
  - Schema:
    - `surveySpecSchema` accepts `defaultSpec(...)`.
    - It rejects `frontPct: 100`, `skip: -1` and a polygon entry without `lat`.
    - Ranges: front and side in [0, 95]; skip an integer in [0, 10]; bank in [5, 60]; alt in [5, 1000].
    - `defaultSpec` for a 300 × 100 m rectangle whose long side runs east–west gives `angleDeg` 90.
- [ ] **Step 2:** `npx vitest run src/features/survey`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Re-run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(ui): survey spec and photo math`.

### Task 4: Lanes

**Files:**
- Create: `ui/src/features/survey/lanes.ts`, `lanes.test.ts`

**Interfaces:**
- Consumes: `LatLon`; the local projection `toLocal` from `features/mission/arc.ts`, or the same equirectangular approach.
- Produces:
  - `Lane = { a: LatLon; b: LatLon; y: number }`: a→b is the shooting section including the along-track margin; `y` is the across-track offset in metres.
  - `buildLanes(polygon, angleDeg, spacingM, marginAlongM, marginAcrossM) → Lane[] | null`. Returns `null` for an invalid polygon: < 3 vertices, area < 1 m², or self-intersecting.
  - `orderLanes(lanes, skip, spacingM) → number[]`.
  - `polygonAreaM2(polygon)`.
- Algorithm (fixed):
  - Rotate to a local frame with x along the lanes.
  - Width W = (ymax − ymin) + 2 × marginAcross; n = max(1, ceil(W / spacing)); offsets are centred on (ymin + ymax) / 2.
  - The x-intervals of a lane come from intersecting the ring with the line at `clamp(y, ymin + 0.01, ymax − 0.01)`. Each interval is its own lane, extended by `marginAlong` at both ends.
  - Ordering: lanes are sorted by y then x, and the sequence starts at index 0. Next is the nearest remaining lane with |Δy| ≥ (skip + 1) × spacing − 0.01, else the farthest remaining. Ties go to the lower index.
  - Start-corner selection belongs to Task 6.

- [ ] **Step 1: Failing tests**
  - A 300 m (E–W) × 200 m (N–S) rectangle near 36.25 N with angle 90°, spacing 50, margins 0 gives 4 lanes, each ≈ 300 m long.
  - The same with `marginAcross` 25 gives 5 lanes, and `marginAlong` 10 makes each lane ≈ 320 m.
  - A U-shaped concave polygon (two prongs, 100 m gap) gives two lanes at the same `y` wherever the line crosses both prongs.
  - `null` for `[]`, for 2 points, and for a bow-tie (self-intersecting) ring.
  - `orderLanes` with 6 lanes in a row (spacing 1):
    - skip 0 gives `[0, 1, 2, 3, 4, 5]`
    - skip 1 gives `[0, 2, 4, 1, 3, 5]`
    - skip 2 on 5 lanes gives `[0, 3, 1, 4, 2]`
  - `polygonAreaM2` of the rectangle is ≈ 60,000 (±0.5 %).
- [ ] **Step 2:** `npx vitest run src/features/survey/lanes.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Re-run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(ui): survey lanes and lane order`.

### Task 5: Turns

**Files:**
- Create: `ui/src/features/survey/turns.ts`, `turns.test.ts`

**Interfaces:**
- Produces:
  - `TurnArc = { center: Xy; r: number; from: number; sweepDeg: number }`. Sweep is signed: clockwise is +, matching `NAV_ARC_WAYPOINT` param1.
  - `TurnPath = { kind: 'u' | 'omega'; points: Xy[]; arcs: TurnArc[] }`, in a local frame.
  - `planTurn(end: Xy, start: Xy, headingDeg: number, radiusM: number) → TurnPath`. It turns from the end of one lane (heading `headingDeg`) to the start of the next lane (flown in the opposite heading).
  - `ARC_SPLIT_DEG = 30`.
  - `splitArc(arc) → Xy[]`: the end points of segments of ≤ 30°, excluding the arc start.
- Geometry (fixed):
  - x_turn = max(along-track of `end`, along-track of `start`).
  - If d ≥ 2R: quarter arc, then a straight of (d − 2R), then a quarter arc.
  - If d < 2R: the Ω construction from the Rulings.
  - Straight run-outs connect `end` and `start` to x_turn.

- [ ] **Step 1: Failing tests**
  - Lanes 120 m apart, R 50:
    - kind `u`, two arcs of ±90°
    - every point lies ≤ R + 0.01 beyond x_turn
    - the last point equals `start` (±0.01)
  - Lanes 30 m apart, R 57.22:
    - kind `omega`, three arcs
    - sweep signs alternate (+, −, +) for a left-hand next lane, mirrored for a right-hand one
    - consecutive arcs are tangent: the end tangent equals the next start tangent within 0.5°
  - `splitArc` of a 90° arc gives 3 points; of a 200° arc gives 7.
  - Unequal lane ends (end x = 300, start x = 260) put the turn beyond x = 300.
- [ ] **Step 2:** `npx vitest run src/features/survey/turns.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Re-run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(ui): survey turn geometry`.

### Task 6: Generator

**Files:**
- Create: `ui/src/features/survey/generate.ts`, `generate.test.ts`

**Interfaces:**
- Consumes: Tasks 3–5.
- Produces:
  - `SurveyGeometry = { lanes: Lane[]; order: number[]; turnRadiusM; triggerDistM; spacingM; footprint; leadInM; overshootM; marginAlongM; marginAcrossM }`.
  - `surveyGeometry(spec, home: LatLon | null) → SurveyGeometry | null`.
  - `generateSurvey(spec, home: LatLon | null) → { items: MissionItem[]; geometry: SurveyGeometry } | { error: 'invalid_polygon' }`.
  - `surveyNumbers(spec, geometry, items) → { photos; areaM2; lanes; intervalS; blur: {cm, px}; distanceM; timeS }`. `timeS` = distanceM / speedMs.
- Item sequence (fixed):
  1. `DO_CHANGE_SPEED` (params per the Rulings).
  2. Per lane in order:
     1. `WAYPOINT` at the lead-in start.
     2. `WAYPOINT` at the shooting start.
     3. `DO_SET_CAM_TRIGG_DIST` `[dist, 0, 1, 0]`.
     4. `WAYPOINT` at the shooting end.
     5. `DO_SET_CAM_TRIGG_DIST` `[0, 0, 0, 0]`.
     6. `WAYPOINT` at the overshoot end.
     7. Then, unless this is the last lane, the turn:
        - `split`: `WAYPOINT` at every `splitArc` point plus straight-segment ends.
        - `arc`: `NAV_ARC_WAYPOINT` (36) at each arc end, param1 = `sweepDeg`, and `WAYPOINT` at straight ends.
- More fixed rules:
  - All items have frame `rel`, `alt = spec.altM`, `autocontinue: true`. DO items have `lat = lon = 0`, `alt = 0`.
  - Copter airframe: no lead-in, overshoot or turn items. Each lane's start WP follows the previous lane's end.
  - Lane direction alternates along the order.
  - The start corner follows the Rulings.
  - Lead-in and overshoot `null` mean auto (Global Constraints). Margin `null` means `footprint/2` per axis.
  - The radius uses ground speed `speedMs + windMs`.
  - `photos` = Σ (floor(shootLen / dist) + 1).
  - `intervalS` = dist / (speed + wind).
  - Blur uses (speed + wind).

- [ ] **Step 1: Failing tests** (α7R IV, 400 × 300 m rectangle, angle 90, alt 100, 80/70):
  - The first item is `DO_CHANGE_SPEED` `[0, 18, -1, 0]`.
  - Every `DO_SET_CAM_TRIGG_DIST` alternates (13.6, then 0), and the count equals 2 × lanes.
  - No `WAYPOINT` between a trigger-on and its trigger-off other than the shooting-end WP, so no shooting in turns.
  - `turn: 'arc'` emits command 36 items whose param1 signs alternate per turn.
  - `airframe: 'copter'` emits no command 36 and no WP outside the lane ends.
  - Determinism: two calls give deep-equal items.
  - A bow-tie polygon gives `{ error: 'invalid_polygon' }`.
  - `start: 'sw'` puts the first lead-in WP south-west of the polygon centre; `start: 'home'` with home at the NE corner puts it north-east.
  - Performance: a 2 km × 1 km area at alt 30 (≈ 0.32 cm/px) generates in < 200 ms.
  - `surveyNumbers.photos` for the rectangle equals the hand-computed Σ.
- [ ] **Step 2:** `npx vitest run src/features/survey/generate.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Keep each helper under 50 lines; split into `generate.ts` and `items.ts` if it passes 400 lines.
- [ ] **Step 4:** Re-run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(ui): survey item generator`.

### Task 7: Terrain worst case + warnings

**Files:**
- Create:
  - `ui/src/features/survey/worst.ts`
  - `ui/src/features/survey/warnings.ts`
  - tests for both

**Interfaces:**
- Consumes: `ElevAt` (`features/map/air.ts`), `predictPlane` + `PLANE_DEFAULTS` (`features/flightpath`), Task 6.
- Produces:
  - `groundRange(polygon, elevAt) → { min: number; max: number } | null`: grid samples inside the polygon, ≤ 2000, step = max(√(area / 2000), 10 m); null when no sample has data.
  - `worstCase(spec, geometry, range, homeAmsl) → { gsdCm: number; frontPct: number; sidePct: number }`:
    - GSD at the highest AGL (lowest ground).
    - Overlaps at the lowest AGL (highest ground), using the fixed trigger distance and lane spacing.
  - `SurveyWarning = 'blur' | 'interval' | 'skip' | 'bank' | 'overlap' | 'arc' | 'entry' | 'wp_radius' | 'too_many' | 'no_home'`.
  - `suggestSkip(spacingM, radiusM) → number` = max(0, ceil(2R / spacing) − 1), shown next to the `skip` warning.
  - `surveyWarnings(input) → SurveyWarning[]`, in that order. `input` carries spec, geometry, numbers, worst (or null), items, home, an optional `predicted: PathPoint[]`, and an optional `rollLimitDeg` from the connected vehicle.
- Rules (fixed):
  - `blur`: px > 1 at the worst (smallest) GSD.
  - `interval`: intervalS < camera.minIntervalS.
  - `skip`: plane and (skip + 1) × spacing < 2R.
  - `bank`: `rollLimitDeg` given and bankDeg > rollLimitDeg.
  - `overlap`: worst front or side < set − 10.
  - `arc`: turn === 'arc'.
  - `entry`: plane, predicted given, and any shooting-start WP is > 5 m from the nearest predicted point.
  - `wp_radius`: plane, turn `split`, and `wpRadiusM` > chord / 2, where chord = 2R·sin(15°).
  - `too_many`: items > 700.
  - `no_home`: home null.

- [ ] **Step 1: Failing tests**, one per code, plus:
  - A fake `elevAt` (a plane rising 0 → 100 m west to east) with home at 0 m and alt 100 gives a worst front overlap below 80 and a worst GSD equal to the GSD at 100 m AGL.
  - A flat `elevAt` gives no `overlap` warning.
  - `groundRange` with an `elevAt` returning null everywhere gives null.
  - Using `predictPlane` with `wpRadius` 90 on a split survey with R 57 gives `entry`. With `wpRadiusM` 5 it does not.
- [ ] **Step 2:** `npx vitest run src/features/survey`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Re-run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(ui): survey worst case and warnings`.

### Task 8: KML import

**Files:**
- Create: `ui/src/features/survey/kml.ts`, `kml.test.ts`
- Test fixtures: `tests/fixtures/survey/{area.kml,two-areas.kml,hole.kml,not-kml.txt}` (repo root)

**Interfaces:**
- Produces: `parseKmlPolygons(text: string) → { polygons: { name: string; ring: LatLon[] }[]; holesIgnored: boolean }`.
  - Throws `KmlError` with `code: 'not_kml' | 'no_polygon'`.
  - Uses `DOMParser` with namespace-agnostic `getElementsByTagNameNS('*', ...)`.
  - Takes `Placemark > name` when present; otherwise the name is `エリア N`.
  - Drops a duplicated closing vertex.
  - Ignores altitude.

- [ ] **Step 1: Failing tests**
  - `area.kml` gives one ring with 5 vertices (closing vertex dropped), and its coordinates read lon,lat in the right order.
  - `two-areas.kml` gives 2 named polygons.
  - `hole.kml` gives `holesIgnored: true` and the outer ring only.
  - `not-kml.txt` throws `not_kml`.
  - A KML with only a LineString throws `no_polygon`.
- [ ] **Step 2:** `npx vitest run src/features/survey/kml.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Re-run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(ui): read survey areas from KML`.

### Task 9: Draft integration (surveys in the editor model)

**Files:**
- Create: `ui/src/features/survey/draftOps.ts`, `draftOps.test.ts`
- Modify:
  - `features/mission/model.ts` (`Draft`, `emptyDraft`, `fromMission`, `toMission`)
  - `features/mission/store.ts` (`edit`, `MissionUi.surveyNotice`)
  - `features/mission/files.ts` (`missionSchema` accepts optional `surveys`)
  - `features/mission/model.test.ts`, `store.test.ts`, `files.test.ts`
  - `features/briefing/persist.test.ts` (old payload)

**Interfaces:**
- Produces:
  - `DraftSurvey = { id: string; uids: readonly number[]; spec: SurveySpec }`.
  - `Draft.surveys: readonly DraftSurvey[]`.
  - Ops:
    - `addSurvey(d, afterUid | null, spec, items) → { draft; id }`, with id from `crypto.randomUUID()`.
    - `regenerateSurvey(d, id, spec, items) → Draft`, which replaces the range in place with fresh uids.
    - `expandSurvey(d, id) → Draft`.
    - `surveyAt(d, uid) → DraftSurvey | null`.
  - `reconcileSurveys(prev: Draft, next: Draft) → { draft: Draft; dropped: string[] }` (names).
  - `MissionUi.surveyNotice: readonly string[]`, cleared by the next edit.
- Rules:
  - `fromMission` maps `first` / `count` to uids. It drops a block whose spec fails `surveySpecSchema` or whose range is invalid, and keeps the items.
  - `toMission` maps uids back to indices.
  - `reconcileSurveys` keeps a survey only if it is unchanged since `prev` (same object): all its uids are present, contiguous and in order, and each item is reference-equal to `prev`. A survey whose object changed (via the ops) is trusted.

- [ ] **Step 1: Failing tests**
  - Round trip: `toMission(fromMission(m))` deep-equals `m` for a mission with two surveys.
  - Inserting a WP before a survey (`insertAfter`) keeps it, and `toMission` shows `first` + 1.
  - `updateItem` on a uid inside a survey drops it via `edit()`; `surveyNotice` holds its name; `undoUi` restores the survey.
  - `regenerateSurvey` with fewer items shrinks the range and keeps the surrounding items and DO_JUMP targets.
  - `expandSurvey` keeps the items and removes the tag.
  - `parseRgcsMission` of a v1 file without `surveys` works.
  - `restore()` of a stored briefing payload without `surveys` works.
  - A block with a bad spec is dropped on load and its items are kept.
- [ ] **Step 2:** `npx vitest run src/features/survey src/features/mission src/features/briefing`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run` (whole UI suite) and `npx tsc --noEmit -p .`. Expected: PASS and clean.
- [ ] **Step 5:** Commit `feat(ui): editor keeps surveys as tagged item ranges`.

### Task 10: Camera list client

**Files:**
- Create:
  - `ui/src/features/survey/cameraApi.ts`
  - `ui/src/features/survey/useSurveyCameras.ts`
  - `ui/src/features/survey/CameraFields.tsx`
  - tests for each

**Interfaces:**
- Consumes: Task 2 routes; `apiFetch`.
- Produces:
  - `listCameras()`, `createCamera(c)`, `updateCamera(id, c)`, `deleteCamera(id)`.
  - `toValues(c: SurveyCamera) → SurveyCameraValues`.
  - `useSurveyCameras() → { cameras; error; reload; saveAs(values, name) }`.
  - `<CameraFields values onChange cameras onPick onSaveAs dict />`, with fields: センサー幅 / 高さ (mm), 画素数 横 / 縦, 焦点距離 (mm), シャッター (1/x s input; stored as seconds), 最短撮影間隔 (s), 向き (横 / 縦 seg).
- Picking a camera copies its values into the spec (the spec never holds a camera id).

- [ ] **Step 1: Failing tests**
  - `CameraFields` renders α7R IV values; typing 500 in シャッター gives `shutterS` 0.002.
  - Picking a camera calls `onPick` with its values.
  - Save-as calls `createCamera` with `builtin: false`.
  - Edit and delete controls are absent for a built-in.
- [ ] **Step 2:** Run and see FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run and see PASS.
- [ ] **Step 5:** Commit `feat(ui): survey camera picker and editor`.

### Task 11: Survey panel (right side)

**Files:**
- Create:
  - `ui/src/features/survey/SurveyPanel.tsx`
  - `ui/src/features/survey/SurveyNumbers.tsx`
  - `ui/src/features/survey/useSurvey.ts`
  - `ui/src/shared/i18n/survey.ts`
  - `ui/src/styles/survey.css`
  - tests
- Modify:
  - `shared/i18n/index.ts`, `main.tsx`
  - `features/mission/MissionSidebar.tsx`: when the single selected item, or the selected group row, belongs to a survey, render `SurveyPanel` instead of `ItemEditor`.

**Interfaces:**
- Consumes: Tasks 3–10.
- Produces: `useSurvey({ draft, change, home, elevAt, vehicleParams }) → { surveyFor(uid), update(id, patch), expand(id), metrics(id) }`.
  - `update` regenerates through `generateSurvey` and `regenerateSurvey`.
  - During continuous input (slider or handle drag) the regeneration is throttled to one per animation frame.
  - `metrics` returns the geometry, numbers, worst case and warnings; it is memoised on the spec object.
- Panel order follows spec §5.2:
  1. Camera
  2. GSD ⇄ alt: typing a GSD sets `altM = altForGsd`
  3. Front / side overlap
  4. Angle
  5. Start
  6. Speed, wind
  7. Skip + turn method + bank
  8. Lead-in / overshoot / margin, each with an 自動 toggle
  9. Numbers
  10. Warnings
  11. 「ウェイポイントに展開」
- Numbers show the footprint, the turn radius, the ground min/max elevation, and the worst GSD / overlaps next to the nominal ones.
- Bank: the connected vehicle's `ROLL_LIMIT_DEG` is shown beside the field.
- With a copter airframe, the skip / turn / bank / lead-in / overshoot fields are hidden.
- Undo granularity: a slider or handle drag previews through the throttled regeneration without committing. Only the release commits, as one undo step (`change`). A typed value commits on blur / Enter.
- Warnings use `hint caution`; none blocks writing.
- `arc` warning copy: 「ArcWaypoint は今の Plane / QuadPlane では実行されない可能性があります」.
- `wp_radius` copy names the value: 「WP_RADIUS {n} m では分割した旋回が早めに切り上げられます」.

- [ ] **Step 1: Failing tests** (render with a fixture draft holding one survey)
  - Changing 前後オーバーラップ to 75 regenerates: the item count changes and `DO_SET_CAM_TRIGG_DIST` p1 becomes the new distance.
  - Typing 解像度 2.0 shows 高度 186.
  - 風速 4 shows the blur for 22 m/s.
  - A slider drag followed by one undo returns to the value before the drag.
  - A copter airframe hides the turn fields.
  - Choosing ArcWaypoint shows the arc warning.
  - 「ウェイポイントに展開」 removes the panel and leaves the items.
  - Every panel string comes from `dict`.
- [ ] **Step 2:** Run and see FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the whole UI suite plus `tsc`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(ui): survey settings panel`.

### Task 12: List grouping, palette entry, drawing / KML flow

**Files:**
- Create:
  - `ui/src/features/survey/useSurveyDraw.ts`
  - `ui/src/features/survey/SurveyRow.tsx`
  - `ui/src/features/survey/KmlPick.tsx`
  - tests
- Modify:
  - `features/mission/cmds.ts`: `PALETTE.pos` gains `'SURVEY'` as a pseudo key, not in `CMDS`.
  - `features/mission/CommandPalette.tsx`: shows 「サーベイ」 and 「KML から読み込む」.
  - `features/mission/MissionList.tsx`: renders a collapsible `SurveyRow` for each survey range; children are read-only, dimmed, with seq numbers.
  - `MissionView.tsx`: only hook calls and props; stay ≤ 400 lines, or extract a `SurveySlot` component.

**Interfaces:**
- Produces: `useSurveyDraw({ change, afterUid, home, cameras, vehicle }) → { drawing: LatLon[] | null; start(); addVertex(p); finish(); cancel(); fromKml(ring, name) }`.
  - `finish` (Enter, or clicking the first vertex) needs ≥ 3 vertices. It calls `addSurvey` with `defaultSpec(...)`, then selects the survey.
  - Esc cancels.
  - The airframe, bank (`min(30, ROLL_LIMIT_DEG)`) and `wpRadiusM` (`WP_RADIUS`) come from the connected vehicle when present, else plane defaults with bank 30 and wpRadius 90.
- List rules:
  - The collapsed row reads `サーベイ {name} · {n} WP · {photos} 枚`.
  - Clicking a child selects that uid (the map shows it) but opens the survey panel, not `ItemEditor`.
  - Drag, reorder and the context menu are disabled on children; the group row moves as a unit.

- [ ] **Step 1: Failing tests**
  - Palette 「サーベイ」 enters drawing.
  - Three map clicks + Enter create a survey after the selected item.
  - Esc leaves the draft unchanged.
  - KML with two polygons asks which one, via an inline list (no dialog API).
  - The list shows one collapsed row; expanding shows the children with seq numbers equal to their mission positions.
  - Children have no reorder buttons.
- [ ] **Step 2:** Run and see FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the whole UI suite plus `tsc`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(ui): add surveys from the palette, the map or KML`.

### Task 13: Map layers

**Files:**
- Create: `ui/src/features/survey/surveyMap.ts`, `surveyGeo.ts` (pure GeoJSON builders), tests
- Modify: `features/mission/MissionMap.tsx` (one hook call), `features/mission/missionAir.ts` (3D: drape the survey polygon outline)

**Interfaces:**
- Produces:
  - `surveyGeoJson(d: Draft, metrics) → FeatureCollection`, with features:
    - `area`: the polygon
    - `shoot`: a LineString per lane section, a → b
    - `link`: lead-in, turns and overshoot
    - `photo`: points
    - `foot`: the photo footprint polygons
    - `handle`: the rotate handle
  - `useSurveyMap({ map, loaded, draft, metrics, onPolygon, onAngle, showFootprints })`.
- Layer ids are prefixed `survey-`.
- Behaviour:
  - `shoot` is drawn at line width 4, `link` at 1.5 and dashed.
  - `photo` only at zoom ≥ 16.
  - `foot` is toggled by a map control button (Lucide `Grid3x3`), and remembered in localStorage `rgcs.surveyFoot`.
  - Dragging a vertex calls `onPolygon(id, ring, done)`.
  - Dragging the handle calls `onAngle(id, deg, done)`, rounded to 1°.
  - `done` is false while dragging (preview) and true on release (commits one undo step, as in Task 11).
  - The predicted path for a survey uses the existing predicted line, fed `predictPlane(items, home, {...PLANE_DEFAULTS, airspeed: speedMs, rollLimitDeg: bankDeg, wpRadius: wpRadiusM})` when no vehicle is connected.

- [ ] **Step 1: Failing tests (pure builders)**
  - Feature counts per kind for the Task 6 rectangle.
  - `photo` count equals `photos`.
  - The handle sits on the polygon centroid offset along the angle.
  - A draft without surveys gives an empty collection.
- [ ] **Step 2:** Run and see FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the whole UI suite plus `tsc`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(ui): draw surveys on the map`.

### Task 14: Docs + end-to-end check on a scratch QuadPlane SITL

**Files:**
- Modify: spec 10 (mission planner: new §6.5 サーベイ), spec 50 (if not done in Task 2)
- Scratch: a Playwright script and a pymavlink checker in the session scratchpad (not committed)

- [ ] **Step 1: Write spec 10 §6.5.** It summarises the panel, the list grouping, the warnings and the fixed constants.
- [ ] **Step 2: Start the scratch stack.**
  - Scratch QuadPlane SITL from `~/github/rtos/ardupilot-latest` (Kamikochi home), with `WP_RADIUS` 20 and `CAM_TRIGG_TYPE` per SITL defaults set **on the scratch SITL only**.
  - Scratch server + Vite on ports :8100 / :5180.
  - Never on the dev stack.
- [ ] **Step 3: Drive the planner with Playwright.**
  - Draw a ~400 × 300 m survey near home; set skip 1; screenshot 2D, 3D and the expanded list.
  - Write it with VTOL takeoff before it and RTL after it.
- [ ] **Step 4: Fly it in AUTO** and log `CAMERA_FEEDBACK` / `CAMERA_TRIGGER` with positions and roll.
  - Expected:
    - every trigger lies within 5 m of a shooting section
    - no trigger has |roll| > 10°
    - the flown track stays within 15 m of the planned turn WPs
  - Record the numbers for the report.
- [ ] **Step 5:** Commit the docs: `docs: spec 10 §6.5 survey grid`.
