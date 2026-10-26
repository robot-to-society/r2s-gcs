# RGCS UI/UX audit (2026-10-26)

Scope: the whole UI at http://127.0.0.1:5173 with 4 SITL vehicles (UAV-01 Copter, UAV-02 QuadPlane, UAV-03 Plane, UAV-04 Rover, armed in AUTO).
Method: headless Chromium (Playwright), 1440×900 and 390×844, dark and light (light only exists on the login screen by design), cross-checked with `apps/rgcs-server/ui/src`.
Screenshots: `scratchpad/uxaudit/shots/*.png` (same folder as this report). No vehicle commands were sent; dialogs were opened and cancelled.

Severity: **High** = misleading about vehicle state, the target, or what a button does (can cause a wrong operation). **Medium** = confusing, cluttered, or inconsistent. **Low** = polish.
Paths are relative to `apps/rgcs-server/ui/src/`. Constraints for the fixes: Lucide icons only (no text glyphs), `styles/prototype.css` stays unchanged, Glass tokens stay as they are.

---

## 1. Global: header, footer, phone width

### UX-01 High: the app cannot be used at phone width
- Shots: `phone-ops.png`, `phone-detail.png`, `phone-mission.png`, `phone-video.png`, `phone-maint.png`
- Current: `.shell > .frame { min-width: 1280px; min-height: 720px }` (`styles/app.css:6`). At 390 px the nav, the detail panel, the 2D/3D toggle and the map controls are outside the screen. Playwright found the nav buttons at x=513–793 and the 2D/3D toggle at x=1112. After a nav press the frame scrolls sideways and panels end up half-visible.
- Fix: add a `@media (max-width: 760px)` layout in `styles/app.css`, not `prototype.css`:
  - drop the frame `min-width`;
  - move the header nav (`.nav`) to a fixed bottom bar, icons only;
  - turn the vehicle list and the detail panel into bottom sheets: the list by default, the detail panel when a vehicle is selected;
  - hide the header clock and counts;
  - keep the map full-bleed.
- Maintenance and mission work can stay desktop-only, with a notice: ja「この画面は横幅 1024 px 以上で使用してください」/ en "Use this screen on a display at least 1024 px wide".

### UX-02 Medium: the warning counter always looks like a warning
- Shot: `ops-desktop.png`
- Current: `⚠ 0` is drawn in caution amber even when no vehicle has a warning (`app/Header.tsx:59`, `.row.warn`). It also has no tooltip.
- Fix: use the `t3` colour when `warns === 0` and caution only when > 0. Add `title`/`aria-label`: ja「警告中の機体」/ en "Vehicles with warnings".

### UX-03 Low: fleet count tooltips are hard-coded English, and the airframe split is unclear
- Shot: `ops-desktop.png`
- Current: `title="Copters"`, `"Rovers"`, `"Planes"` (`app/Header.tsx:45,49,54`). The QuadPlane is counted under the plane icon. The planes counter hides when 0, but the copter and rover counters never hide.
- Fix: add dict keys `kindCopter` ja「マルチコプター」/ en "Multicopters", `kindRover`「ローバー」/ "Rovers", `kindPlane`「固定翼・VTOL」/ "Fixed-wing & VTOL". Hide every zero counter the same way.

### UX-04 Low: the clock is shown three times
- Shot: `ops-desktop.png`
- Current: the header shows `2026/10/26 (月) 13:46`, the footer pill shows `13:46` (`app/Shell.tsx:151` `clock.slice(-5)`, `app/Footer.tsx:21-25`), and the log line shows its own time.
- Fix: drop the footer clock (pass `clock=""`). The header clock stays.

### UX-05 Low: the log pill lead「全体」is ambiguous
- Shot: `ops-desktop.png`
- Current:「全体」/ "All" (`features/log/LogPill.tsx:41`, `shared/i18n/index.ts:56`) sits in front of the latest message.
- Fix: ja「全機」/ en "All vehicles", or a Lucide `MessagesSquare` icon with `title`「全機のメッセージ」/ "Messages from all vehicles".

### UX-06 Medium: the basemap menu never closes by itself
- Shots: `ops-basemap.png`, `ops-logsheet.png`, `ops-3d.png`, `ops-userpop.png` (the menu stays open through every later action)
- Current: `features/map/BasemapPicker.tsx:17-23` only toggles on its own button. There is no Esc handler, no outside-click handler, and no close on pick.
- Fix: close on Esc, on a `pointerdown` outside the menu, and after a pick, the same way `UserPopover` does.

---

## 2. Login

### UX-07 Low: a design slogan is shown as UI copy
- Shots: `login-light.png`, `phone-login-light.png`
- Current: 「直射日光の下でも読みやすく。」(`shared/i18n/login.ts:5`, light theme only) is a design rationale. It tells the user nothing.
- Fix: remove it. If a subtitle is wanted, use ja「RGCS 地上局にサインイン」/ en "Sign in to the RGCS ground station".

### UX-08 Medium: an inert 2D/3D toggle on the login screen
- Shot: `login-dark.png`
- Current: `features/auth/LoginChrome.tsx:21-24` renders a 2D/3D chip that looks like a toggle. The comment there calls it "decoration".
- Fix: remove the chip, and show the same server pill (`● rgcs`) that the light theme shows, so both themes match.

### UX-09 Low: an English label in the Japanese login card
- Shot: `login-dark.png`
- Current: `SERVER rgcs` (`shared/i18n/login.ts:4`, ja value is 'SERVER').
- Fix: ja「接続先」(the key `connectedTo` already exists) / en "Server".

---

## 3. Operations map and vehicle list

### UX-10 High: the map opens on a fixed spot, not on the vehicles
- Shots: `ops-desktop.png`, `ops-detail-v1.png`, `ops-detail-v4.png`, `ops-commands-v1.png`
- Current: the map starts at the built-in `HOME = [139.372, 36.162]` (Kumagaya; `features/map/MapView.tsx:75,128`) and stayed there for the whole session. The vehicles were about 100 km away. Selecting a vehicle does not move the map; only a double-click (follow) does (`ops-follow-v1.png`). The "first view" effect (`MapView.tsx:355-367`) never framed the fleet in any run.
- Caveat: this was seen in headless Chromium. Re-check it in a real browser, but the code path does not guard against the map not being loaded yet.
- Fix:
  1. Run `firstView` after `m.once('load')`, and re-try while `opened` is false.
  2. Add a Lucide `Scan` (or `LocateFixed`) button to the ops map controls, under the layers button: `title` ja「全機を表示」/ en "Show all vehicles". The mission view already has 「機体の位置へ」.
  3. A single click on a vehicle row should ease the map to that vehicle when it is off-screen.

### UX-11 High: an unknown battery is drawn as a full battery
- Shots: `ops-desktop.png` (UAV-02 shows "—" with a full white bar), `video-grid.png`
- Current: `battWidth = ${v.battery.pct ?? 100}%` (`features/vehicles/format.ts:28-30`).
- Fix: use width `0%` when `pct === null`, add class `batt unknown` (dashed outline using the existing `--line-hi` token), and `title` ja「バッテリー残量不明」/ en "Battery level unknown".

### UX-12 High: arm state is shown only by text colour, and the detail panel shows neither mode nor arm state
- Shots: `ops-detail-v4.png` (UAV-04 is ARMED/AUTO, but the panel says neither), `maint-calib-rover.png` (only maintenance says "ARMED")
- Current:
  - In the list, armed vs disarmed is only the badge text colour (`var(--accent)` vs `--text-2`; `features/vehicles/VehicleRow.tsx:43`).
  - The detail panel header (`features/detail/DetailPanel.tsx:62-86`) has only the dot and the name.
- Fix:
  - Detail header: add the mode badge plus an arm chip: ja「アーム中」/ en "ARMED" (accent fill, Lucide `Power`) or「ディスアーム」/ "Disarmed" (muted).
  - List row: armed rows get a filled badge, or a Lucide `Power` icon before the mode, so the state is readable without colour.

### UX-13 Medium: flight mode badges are truncated
- Shots: `ops-desktop.png` (`STAB…`, `MANU…`), `ops-follow-v4.png` (`A…` for AUTO while following), `ops-follow-v1.png` (`S…`)
- Current: `.vrow .badge { flex: 0 1 auto; min-width: 0; text-overflow: ellipsis }` (`styles/app.css:46`). The follow mark and the unread badge take the remaining width.
- Fix: `.vrow .badge { flex: none }`, and let `.vrow .nm` shrink instead (`min-width: 0; overflow: hidden; text-overflow: ellipsis`). The mode is the more important of the two and must never be cut.

### UX-14 Medium: the status dot colour encodes the airframe type
- Shot: `ops-desktop.png` (UAV-01 blue, the others green)
- Current: `dotClass` returns `dot copter` (blue) for every healthy copter (`features/vehicles/format.ts:40-44`). The kind icon already shows the airframe, so blue reads as a different state.
- Fix: `dot ok` for every healthy vehicle. The dot should mean link/health only: green OK, amber warn/delay, red lost.

### UX-15 Medium: a static "heading" icon that looks like an altitude icon
- Shot: `ops-desktop.png` (the ⤒ icon under every kind icon, next to "0 m")
- Current: `IconHeading` is Lucide `ArrowUpToLine` (`shared/ui/icons.tsx:133`), rendered unrotated in `VehicleRow.tsx:31`. It shows no heading. The video tiles use a different altitude icon (`IconAltitude`, `features/video/StatLine.tsx:9`).
- Fix: either rotate a Lucide `Navigation2` by the vehicle heading (`style={{ transform: rotate(${hdg}deg) }}`), or remove it. Put `IconAltitude` in front of the altitude value in the list row so the list and the video tiles match.

### UX-16 Medium: rovers show altitude everywhere
- Shots: `ops-detail-v4.png` (高度 0 m), `video-grid.png` (UAV-04 0 m), `confirm-mission-start-v4.png` (「高度 0 m」)
- Current: `altText` (`features/vehicles/format.ts:10`), `DetailPanel.tsx:116-122` and `StatLine.tsx` always show `alt_rel`.
- Fix: for `kind === 'rover'`, show distance from home instead (the confirm dialog already computes it): ja「ホームから 354 m」/ en "354 m from home". Label: ja「距離」/ en "Distance". In the confirm body, drop「高度 …」for rovers.

### UX-17 Medium: home markers cover the vehicles on the ground and carry their labels
- Shots: `ops-follow-v1.png`, `ops-3d.png`, `ai.png`
- Current: for vehicles at home, the house icon sits on top of the vehicle icon. The `UAV-0x` label attaches to the house, and four houses are stacked. The copter and the planes are not visible at all.
- Fix:
  - Draw the vehicle above the home marker.
  - Offset the home marker (smaller, Lucide `House` at 12 px) or hide it while the vehicle is within ~5 m of home.
  - Give each home marker a tooltip: ja「UAV-01 のホーム」/ en "Home of UAV-01".

---

## 4. Detail panel (ops right panel)

### UX-18 High: rovers are offered Land, change altitude, and a "Flight" group
- Shots: `ops-detail-v4.png` (「着陸」in the emergency row), `ops-commands-v4.png` (group 「飛行」 with 着陸, and 「高度変更」)
- Current:
  - `EmergencyRow` has fixed buttons pause/rtl/land (`features/detail/EmergencyRow.tsx:14-18`).
  - The catalog has no `available` filter for `land` or `change_alt` (`features/commands/catalog.ts:100,102-108`).
  - The group title is `groupFlight`「飛行」(`shared/i18n/index.ts:81`).
- Fix:
  - Rovers: the emergency row becomes「一時停止」「帰還」 (two buttons), or adds a third button that sets HOLD: ja「停止 (HOLD)」/ en "Hold".
  - Add `available: (v) => v.kind !== 'rover'` to `land` and `change_alt`.
  - Rover group title: ja「走行」/ en "Drive".

### UX-19 Medium: the mission progress row is cryptic and wraps badly
- Shots: `ops-detail-v1.png` (「ミッション進捗 WP 0 / ?」), `ops-detail-v4.png` (「ミッション / 進捗」 and 「残 / り 0 m」 broken over two lines)
- Current: `features/detail/MissionProgressRow.tsx:26-38`. 「ミッション書込」 is a ghost button that reads like a label.
- Fix:
  - Label ja「ミッション」/ en "Mission", with `white-space: nowrap` on the label and the value.
  - Unknown total: show `WP 0 / —` with `title` ja「機体のミッション件数を未取得」/ en "Mission size not read yet".
  - Make the write button `btn btn-sm` with a Lucide `Upload` icon and the text ja「書込…」/ en "Write…".

### UX-20 Medium: 「開始」 restarts a finished mission without saying so
- Shots: `ops-detail-v4.png` (WP 4 / 4 · 残り 0 m, with a primary 「開始」), `confirm-mission-start-v4.png`
- Current: `MissionProgressRow.tsx:33-37` always shows `mStart`, and the confirm dialog doesn't mention that the mission is complete.
- Fix: when `progress.seq >= total`, label the button ja「最初から再実行」/ en "Restart", and add to the confirm body: ja「ミッションは完了しています。WP 1 から再実行します。」/ en "The mission is complete. It will run again from WP 1."

### UX-21 Medium: old alerts look current
- Shot: `ops-detail-v1.png` (「21:29:32 通信喪失」 with a red 確認 at 13:47 the next day)
- Current: `hhmmss(e.ts)` without a date (`features/detail/DetailMessages.tsx:26`).
- Fix: when the entry is not from today, show `10/25 21:29`, or ja「昨日 21:29」/ en "Yesterday 21:29". Apply the same rule in the log sheet.

### UX-22 Low: the pending-alert count appears twice
- Shot: `ops-detail-v1.png` (履歴 tile ① and メッセージ ①)
- Current: `features/detail/DetailTiles.tsx:30-33` and `DetailMessages` both show `pendingAlerts`.
- Fix: keep the badge on 「メッセージ」 only. Rename the tile ja「メッセージ履歴」/ en "Message history".

### UX-23 Low: English gimbal modes and text glyphs in the camera status row
- Shots: `ops-detail-v1.png` (`Follow | ↔ 90.5° ↕ −30.0°`), `video-cockpit.png` (Lock / Follow / FPV)
- Current: `features/camera/CameraStatusRow.tsx:15` (hard-coded `'Lock' | 'Follow' | 'FPV'`) and `:44-45` (the `↔`/`↕` glyphs).
- Fix: Lucide `MoveHorizontal` / `MoveVertical` icons instead of the glyphs. Mode labels from the dict: ja「ロック」「追従」「FPV」/ en "Lock", "Follow", "FPV".

### UX-24 Low: the telemetry row has no battery label, and its labels are tiny
- Shot: `ops-detail-v1.png`
- Current: altitude and speed have 10 px `lbl` captions; the battery has none (`DetailPanel.tsx:116-134`).
- Fix: add `<span className="lbl">{dict.battery}</span>`. Raise `.lbl` to 11 px with `--text-2`.

### UX-25 Medium: rovers get an artificial horizon and roll/pitch
- Shots: `ops-detail-v4.png`, `ops-commands-v4.png`
- Current: `InstrumentsRow` always draws the attitude indicator and `R 0° P 0°`. The labels are `instRollShort`/`instPitchShort`/`instHdgShort` = R/P/HDG (`shared/i18n/instruments.ts:8-10`).
- Fix: for rovers, show the compass only, larger. Everywhere, use readable captions: ja「ロール」「ピッチ」「方位」/ en "Roll", "Pitch", "Heading". The space is there.

---

## 5. All-commands sheet and fleet commands

### UX-26 Medium: buttons that can never be pressed
- Shots: `ops-commands-v4.png` (bottom group)
- Current: `camera` and `other` are `enabled: () => false` (`features/commands/catalog.ts:122-123`): 「カメラ・ジンバル」 and 「その他の対応コマンド」 are always grey.
- Fix: wire `camera` to open the camera settings (`opens: 'camera'` is already declared), and remove `other` until it exists.

### UX-27 Medium: takeoff is disabled with no visible reason, and Arm is at the bottom
- Shots: `ops-commands-v1.png`, `ops-commands-v2.png`
- Current: the reason 「アームしてから」 is only a hover `title` (`features/commands/CommandsSheet.tsx:180`). Arm/Disarm sit in the last group, below the fold (`catalog.ts:120-121`).
- Fix: show the hint inline under the disabled button: ja「アーム後に使用できます」/ en "Available after arming". Move arm/disarm to the top 「飛行」 group, before 離陸.

### UX-28 Low: the same command is spelled three ways
- Current: 「Guided移動」(`cmd_guided`, `shared/i18n/index.ts:77`), 「Guided 移動」(`guided`, `:134`), 「ここへ Guided 移動」, 「GUIDED に切替」.
- Fix: ja「Guided 移動」 everywhere (with a space), and the mode name「GUIDED」 only where the mode itself is meant.

### UX-29 High: 「全機 帰還」 and 「全機 一時停止」 silently target only the armed vehicles
- Shots: `fleet-rtl-confirm.png`, `fleet-pause-confirm.png` (the title says 全機, the list shows only UAV-04)
- Current: `fleetTargets` keeps only vehicles that are armed and have a link (`features/commands/fleet.ts:21-24`). `FleetConfirm` (`features/commands/FleetConfirm.tsx:25-44`) does not say that others were skipped.
- Fix: add a line under the title: ja「対象: アーム中の 1 機(未アームの 3 機は対象外)」/ en "Targets: 1 armed vehicle (3 disarmed vehicles skipped)". When nothing is armed, disable 実行 and show ja「アーム中の機体がありません」/ en "No armed vehicles".

---

## 6. Mission write from the ops panel

### UX-30 High: one click in the 「ミッション書込」 list writes to the vehicle
- Shot: `mission-picker.png`
- Current: `<li onClick={() => onPick(r)}>` (`features/mission/MissionPicker.tsx:42`) calls `writeSavedMission` straight away (`app/Shell.tsx:369, 456`). There is no confirmation and no filter by vehicle type. The dates use the browser locale (`toLocaleString()` → "10/23/2026, 11:36:24 PM", `MissionPicker.tsx:45`; the same in `features/briefing/BriefingPicker.tsx:47`).
- Fix:
  - A click selects the row only. A footer primary button, ja「UAV-04 に書き込む」/ en "Write to UAV-04", opens the standard confirm.
  - Format dates with the app's JST formatter (`YYYY-MM-DD HH:mm`).
  - Mark missions that contain commands the airframe cannot fly.

### UX-31 Low: generated mission names mix languages and use locale time
- Shot: `mission-picker.png` ("Mission read 6:32:31 PM")
- Current: `features/mission/useMissionIo.ts:95` uses `toLocaleTimeString()`.
- Fix: `${dict.mDownloaded} ${hhmmss(Date.now())}` → ja「ミッション読込 18:32:31」.

---

## 7. Mission planner

### UX-32 High: the target vehicle shows UAV-01 while the briefing row says 「未割当」, and the write goes to UAV-01
- Shots: `mission.png`, `mission-loaded.png` (left row 「未割当」, right 「対象機体 UAV-01」, 「機体に書き込む」 enabled)
- Current:
  - With one mission, the select has no 「未割当」 option (`features/mission/MissionSidebar.tsx:81-83`), so the browser shows the first vehicle.
  - The write target falls back to the first vehicle (`features/briefing/model.ts:110-112`, `writeTarget`).
  - The row select shows 「未割当」 (`features/briefing/BriefingList.tsx:108-109`).
- Fix: show the effective target in both places. Either:
  - list it as ja「自動: UAV-01」/ en "Auto: UAV-01" in both selects; or
  - remove the fallback, disable 「機体に書き込む」 until a vehicle is chosen, and show ja「書込先の機体を選んでください」/ en "Choose the vehicle to write to".

### UX-33 Medium: English tab names in the Japanese planner
- Shots: `mission.png`, `mission-fence.png`
- Current: `planMission/planFence/planRally` = 'Mission' / 'Fence' / 'Rally' in ja (`shared/i18n/plan.ts:5-7`), while the panels below say 「フェンス」.
- Fix: ja「ミッション」「フェンス」「ラリー」.

### UX-34 Medium: three "save" buttons, and the vehicle I/O is split across both panels
- Shots: `mission.png`, `mission-loaded.png`
- Current:
  - Header 「保存」 saves to the server (`MissionSidebar.tsx:73`).
  - 「ファイルに保存」 exports .waypoints (`:187`); 「.rgcsmission で保存」 exports .rgcsmission (`:190`).
  - 「ブリーフィングを保存」 sits top-left.
  - 「機体から読込」 / 「ファイルから読込」 sit bottom-left, while 「機体に書き込む」 sits bottom-right.
- Fix:
  - Rename: header ja「ライブラリに保存」/ en "Save to library". Exports: ja「書き出し (.waypoints)」「書き出し (.rgcsmission)」/ en "Export .waypoints", "Export .rgcsmission". Import: ja「ファイルを読み込む」/ en "Import file".
  - Put 「機体から読込」 next to 「機体に書き込む」 in the right footer.

### UX-35 Medium: altitude-centric planning for a rover
- Shot: `mission-rover-target.png` (target UAV-04: 既定高度 REL 50 m, ▲162 m REL, 離陸 item, 最大高度 284 m, 3D altitude poles)
- Fix: when the target is a rover:
  - hide the frame and default-altitude row;
  - drop `▲… m REL` from the row summaries;
  - hide 最大高度 in the summary and the HUD;
  - in the palette, hide TAKEOFF / VTOL / LOITER_TO_ALT (CMDS already carries the vehicle applicability);
  - warn when the mission contains a TAKEOFF item: ja「ローバーは離陸コマンドを無視します」/ en "Rovers ignore TAKEOFF".

### UX-36 Medium: the command palette is see-through, clipped, and offers VTOL commands for a copter
- Shot: `mission-palette.png` (the list text shows through the palette; the right column ends "DO_GIMBAL_MANAGER_PITC"; 「VTOL 離陸 / 着陸」 offered for the copter UAV-01)
- Current: `features/mission/CommandPalette.tsx`.
- Fix: use the opaque `g-strong` background with no bleed-through; make the second column fit, or put the MAV name in `title`; filter the commands by the target airframe.

### UX-37 Medium: the same ▲ text glyph means "altitude" and "move up" in one row
- Shot: `mission-loaded.png`
- Current: the altitude prefix `▲${alt} m` (`features/mission/labels.ts:36`) and the reorder buttons `▲` / `▼` (`features/mission/MissionRow.tsx:57-61`). These are text glyphs, which the Lucide-only rule does not allow.
- Fix: reorder buttons become Lucide `ChevronUp` / `ChevronDown`. The altitude prefix becomes `IconAltitude` (12 px), or plain text ja「高度 50 m REL」.

### UX-38 Low: row noise
- Shot: `mission-loaded.png`
- Current: `MAV_CMD_NAV_WAYPOINT` in 9 px mono on every row, and 「待機時間 0s」 even when zero.
- Fix: move the MAV name into `title`; skip fields whose value is 0 or the default.

### UX-39 Low: the summary is duplicated and uses inconsistent terms
- Shots: `mission-loaded.png` (right summary plus the bottom HUD; 「コマンド 13」 vs 「項目 13」; 「推定時間 6:08」)
- Fix:
  - Keep one of the two (the HUD on the map is enough when the sidebar is collapsed; hide it while the summary is visible).
  - Rename 「コマンド」 to ja「項目数」/ en "Items".
  - Show time as ja「6 分 08 秒」/ en "6 min 08 s".

### UX-40 Low: REL is capitalised two ways
- Shots: `mission-rover-target.png` (3D labels "50 m Rel") vs the list and the select "REL"
- Fix: use one form, "REL", everywhere (`FRAMES[...].short` and the 3D label source).

### UX-41 Low: the shortcut legend is always on screen
- Shot: `mission-loaded.png` (the 9 px 「Del 削除 · ⌘Z …」 under the list)
- Current: `mShortcuts` (`shared/i18n/index.ts:257`).
- Fix: remove it from the list. It belongs in the 「?」 map controls guide.

### UX-42 Medium: 「設定」 writes FENCE_ALT_MAX to the vehicle, and the disabled-fence notice looks like a button
- Shot: `mission-fence.png`
- Current: `fenceAltMaxSet: '設定'` (`shared/i18n/plan.ts:41`, button at `features/mission/PlanSidebar.tsx:59-65`). The 「FENCE_ENABLE = 0 (フェンス無効)」 notice (`plan.ts:44`) is a filled amber pill.
- Fix:
  - Button: ja「機体に書込」/ en "Write".
  - Notice: a hint row with Lucide `TriangleAlert`. Copy: ja「フェンスは無効です (FENCE_ENABLE = 0)」/ en "Fence is disabled (FENCE_ENABLE = 0)".

---

## 8. Video

### UX-43 Medium: tile telemetry is unreadable over bright video
- Shot: `video-grid.png` (UAV-01: 「0 m 0.0 m/s 100%」 in grey on yellow and green)
- Current: `features/video/VideoGrid.tsx:79` uses `color: var(--text-2)`, and `.vtile-shade` is too weak.
- Fix: put the stat line in the same glass pill the cockpit uses (`video-cockpit.png`, top-left), or strengthen the `.vtile-shade` gradient in `styles/app.css`.

### UX-44 Low: an unlabelled latency chip in the cockpit
- Shot: `video-cockpit.png` (「MT11 | 20 ms」)
- Fix: add `title` ja「映像遅延 (カメラ: MT11)」/ en "Video latency (camera: MT11)".

---

## 9. Network

### UX-45 Low: terse or odd inspector labels
- Shot: `network.png`
- Current: 「版」, 「待受」, 「役割 standalone」 (a raw value, and the subtitle already says スタンドアロン), 「映像サーバー」 wrapping to 「映像サーバ / ー」, client table header 「ユー…」 (`shared/i18n/network.ts:50-56`).
- Fix: ja「バージョン」「アドレス」; localise the role value or drop the row; widen the label column (min 6em) so labels don't wrap; client header ja「ユーザー」.

### UX-46 Low: cryptic node text and legend
- Shot: `network.png` (「FC · AP 1」, legend 「直接波」)
- Current: `features/network/graph.ts:24` (`SHORT = { autopilot: 'AP', … }`) and `network.ts:8`.
- Fix: `title` ja「オートパイロット (コンポーネント 1)」. Legend ja「直接リンク」/ en "Direct link".

### UX-47 Low: unconfigured parts take most of the canvas
- Shot: `network.png` (the empty インターネット / クラウド / RGCS Hub columns in 9 px low-contrast text)
- Fix: collapse the unconfigured columns into one muted card: ja「未構成: LTE・RGCS Hub・NTRIP・メッシュ GW」/ en "Not configured: LTE, RGCS Hub, NTRIP, mesh GW".

---

## 10. Maintenance and settings

### UX-48 Medium: two vehicle selectors, a misleading label, and English status
- Shots: `maint-params.png`, `maint-calib-rover.png`
- Current:
  - The left vehicle list and the 「接続機体」 dropdown both pick the vehicle (`features/params/MaintView.tsx:58-70`).
  - 「接続機体」 means "connected vehicle", not "the vehicle these tabs act on".
  - The status reads `ARMED` / `DISARMED` (`:71`).
  - The vehicle header also shows on the app-wide 「アプリ設定」 tab.
- Fix:
  - Label ja「対象機体」/ en "Vehicle".
  - Remove the dropdown while the list is visible (keep it only when the list is collapsed into the rail).
  - Status ja「アーム中」「ディスアーム」/ en "Armed", "Disarmed".
  - Hide the vehicle header on the アプリ設定 tab.

### UX-49 Medium: the parameter progress says "0 / 1431" while the list is loaded
- Shot: `maint-params.png`
- Current: `progressText` returns `${received} / ${total}` (`features/params/format.ts:9-12`). Cached parameters show as not downloaded.
- Fix: when `received === 0 && rows > 0 && !downloading`, show ja「1431 件 (前回取得)」/ en "1431 (last download)" and hide the bar.

### UX-50 Medium: 「モーターテスト」 says 「校正を開始」, and calibration is spelled two ways
- Shot: `maint-tab1.png`
- Current: `calStart` 「校正を開始」 on every card (`features/calibration/CalibCard.tsx:64`), including the motor test. The tab says 「校正」, the cards say 「RCキャリブレーション」 and 「ESCキャリブレーション」 (`shared/i18n/calib.ts:4,10-12`).
- Fix: motor card button ja「テストを開始」/ en "Start test". Names ja「RC 校正」「ESC 校正」.

### UX-51 Medium: the flight-log table runs under the footer, and the export buttons look like links
- Shot: `maint-tab3.png` (the 2026-10-20 08:54 row is hidden behind the log pill; 「PDF 出力」 and 「CSV 出力」 are underlined)
- Current: `<a className="btn">` keeps the anchor underline (`features/logbook/ExportBar.tsx:16-19`), and the scroll area has no bottom inset.
- Fix: in `styles/app.css`: `a.btn { text-decoration: none }`, and bottom padding of 72 px on the maintenance scroll bodies (`.maint` panes) so the last row clears the footer.

### UX-52 Low: a text glyph and a redundant column in the change history
- Shot: `maint-tab4.png` (「… → 300 ✓」)
- Current: `features/params/format.ts:20,27` uses `✓` and `⚠`. `HistoryTab.tsx:38,47` shows a 機体 column although the list is already filtered by vehicle.
- Fix: a 「検証」 column with Lucide `Check` / `TriangleAlert`. Drop the 機体 column.

### UX-53 Medium: the audience-view button sits in the language card, under a different name
- Shot: `maint-tab6.png`
- Current: 「ロゴ・提示用トークン」 (`shared/i18n/logbook.ts:105`, `features/app-settings/AppTab.tsx:32-43`) sits inside 「表示言語」. The same feature is 「観客用画面」 in the user menu (`ops-userpop.png`).
- Fix: give it its own card. Card title ja「観客用画面」/ en "Audience view"; button ja「リンクとロゴを管理…」/ en "Manage links and logo…".

### UX-54 Medium: a theme setting that only changes the login screen
- Shot: `maint-tab6.png` (自動 / ダーク / ライト, with the note that the app always stays dark)
- Current: `features/app-settings/DisplayCard.tsx:22`, `shared/i18n/login.ts:15`.
- Fix: retitle the card ja「ログイン画面の配色」/ en "Sign-in screen theme" and drop the note. Or move the choice onto the login screen.

### UX-55 Low: unexplained jargon 「トイレットボウル」
- Shot: `maint-tab6.png`
- Current: `shared/i18n/guard.ts:6,13,26`, and the alert headline `guardAlert.ts:6` 「トイレットボウルの兆候 — 手動で引き継いでください」.
- Fix: card note ja「AI 緊急介入: コンパス不良などで機体が渦を巻くように流れる現象 (トイレットボウル) を早期に検知して警告します。…」. Headline ja「旋回が不安定です (トイレットボウル) — 手動で引き継いでください」/ en "Unstable circling (toilet bowl) — take manual control".

### UX-56 Low: mixed save patterns in app settings
- Shot: `maint-tab6.png` (the 軌跡 and SYSID fields each have their own 「保存」; the projection toggle applies at once)
- Fix: apply on blur/Enter with an inline ja「保存しました」/ en "Saved" tick (Lucide `Check`), and drop the per-field 保存 buttons.

---

## 11. Camera settings sheet

### UX-57 Medium: raw identifiers as option labels
- Shot: `camera-settings-tab1.png` (axes `pan` / `tilt` / `none`; buttons `record_toggle`, `shutter`, `center_gimbal`, `thermal_toggle`, `none`)
- Current: `features/camera-settings/InputTab.tsx:70-72, 105-107` render `{f}` directly.
- Fix: dict labels: ja「パン」「チルト」「なし」「録画 開始/停止」「撮影」「ジンバルをセンター」「サーマル切替」/ en "Pan", "Tilt", "None", "Record start/stop", "Take photo", "Center gimbal", "Toggle thermal". Same for the `roi_1…roi_10` functions: ja「ROI {n} を追跡」/ en "Track ROI {n}".

### UX-58 Low: English column heads and raw control-mode values
- Shot: `camera-settings-tab2.png` (Lat / Lon / MSL; rate / angle)
- Current: `features/roi/RoiTab.tsx:61-63`, `features/roi/RoiControlForm.tsx:14`.
- Fix: ja「緯度」「経度」「標高 (MSL)」; control mode ja「速度制御」「角度制御」/ en "Rate", "Angle".

### UX-59 Low: video source 「AUTO」 reads like a flight mode
- Shot: `camera-settings.png`
- Fix: ja「自動」/ en "Auto" (the key `dict.auto` already exists).

### UX-60 Low: the audience-view dialog uses a native file input and has no headers
- Shot: `present-settings.png` ("Choose File / No file chosen" in the browser's language; 「ロゴ / 画像」 wraps; the token rows have no column headers)
- Current: `features/present-settings/PresentSettings.tsx:96-97`.
- Fix: a visually hidden input plus `<label className="btn">` with Lucide `ImageUp`, ja「ロゴを選択…」/ en "Choose logo…". Column headers ja「ラベル」「トークン」「状態」.

---

## 12. Log sheet and AI

### UX-61 Medium: the log sheet points to the wrong place for older messages
- Shot: `ops-logsheet.png`
- Current: `logKeep` 「直近 500 件を表示。それ以前はメンテナンス › ログで確認できます。」 (`shared/i18n/opsTools.ts:9,46`). メンテナンス › 飛行日誌 › ログ holds DataFlash logs (`features/logbook/LogsPane.tsx:1-3`), not message history.
- Fix: ja「直近 500 件を表示しています。」/ en "Showing the latest 500." Add a pointer only once a message archive exists.

### UX-62 Low: the "AI not configured" message is written for developers
- Shot: `ai.png`
- Current: 「AI は未設定です（config.toml の [ai]）」 (`shared/i18n/ai.ts:12`).
- Fix: ja「AI チャットは未設定です。管理者がサーバーの config.toml ([ai]) を設定すると使えます。」/ en "AI chat is not set up. An administrator can enable it in the server's config.toml ([ai])."

---

## Prioritised fix list

1. **UX-32**: show and enforce the real mission write target in the planner (未割当 vs UAV-01 fallback).
2. **UX-30**: 「ミッション書込」 picker: select first, then confirm (no one-click write).
3. **UX-12**: show the mode and the arm state explicitly in the detail header and the list.
4. **UX-18**: per-airframe commands: no Land or change-altitude for rovers, and 「走行」 as the group name.
5. **UX-29**: fleet commands state which vehicles are targeted and which are skipped.
6. **UX-11**: an unknown battery must not render as full.
7. **UX-10**: the map frames the fleet on open; add a 「全機を表示」 control.
8. **UX-01**: a phone layout (or at least no 1280 px frame and a reachable nav).
9. **UX-13**, **UX-14**, **UX-15**, **UX-17**: list and map readability (badge truncation, dot meaning, the heading icon, home markers hiding vehicles).
10. **UX-16**, **UX-25**, **UX-35**: hide altitude, attitude and takeoff content for rovers in the panel, the confirm dialog and the planner.
11. **UX-20**, **UX-21**, **UX-19**: mission restart wording, dated stale alerts, the progress row layout.
12. **UX-34**, **UX-33**, **UX-42**, **UX-36**, **UX-37**: planner wording and controls (save/export names, Japanese tabs, the fence write button, the palette, the glyphs).
13. **UX-48**, **UX-49**, **UX-50**, **UX-51**, **UX-53**, **UX-54**, **UX-61**: maintenance and settings wording and layout.
14. **UX-26**, **UX-27**, **UX-06**, **UX-02**, **UX-43**, **UX-57**: dead buttons, hidden reasons, popover dismissal, contrast, raw option ids.
15. All Low items (UX-03…05, 07, 09, 22–24, 28, 31, 38–41, 44–47, 52, 55, 56, 58–60, 62): copy and polish in one i18n pass.

Counts: High 8 (UX-01, 10, 11, 12, 18, 29, 30, 32), Medium 29, Low 25.
