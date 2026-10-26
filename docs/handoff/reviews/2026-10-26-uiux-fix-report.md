# RGCS UI/UX fix report (branch `fix/ux-review`, 2026-10-26)

Source: `report.md` (UX-01..UX-62). BEFORE shots: `shots/`. AFTER shots (headless Chromium, 1440×900, dark, ja): `after/`, same file names.
Extra AFTER shots without a BEFORE twin: `after/ops-show-all.png` (全機を表示), `after/ops-basemap-closed.png` (menu closed by Esc), `after/mission-picker-confirm.png` (write confirm), `after/mission-target-picked.png` (planner with a picked target).

No vehicle commands or writes were sent. Dialogs were opened and cancelled.

## Status per finding

| ID | Sev | Result | Commit | Before → after shots |
|----|-----|--------|--------|----------------------|
| UX-01 | High | **Skipped**: ruled out of scope (desktop GCS; the 1280 px frame was not touched) | – | phone-*.png → – |
| UX-02 | Med | Fixed: the warning count is muted at 0, amber only when > 0; titled 「警告中の機体」 | d58afa9 | ops-desktop → ops-desktop |
| UX-03 | Low | Fixed: translated airframe titles; every zero count hides | d58afa9 | ops-desktop → ops-desktop |
| UX-04 | Low | Fixed: no footer clock | 66f47f5 | ops-desktop → ops-desktop |
| UX-05 | Low | Fixed: log pill lead 「全機」/"All vehicles" | 66f47f5 | ops-desktop → ops-desktop |
| UX-06 | Med | Fixed: map type menu closes on Esc and on an outside press (it already closed on a pick) | d58afa9 | ops-basemap → ops-basemap, ops-basemap-closed |
| UX-07 | Low | Fixed: slogan removed | 2b93637 | login-light → login-light |
| UX-08 | Med | Fixed: inert 2D/3D chip removed; both themes show the server pill | 2b93637 | login-dark → login-dark |
| UX-09 | Low | Fixed: the English "SERVER" eyebrow is gone (the host was shown twice); the pill is titled 「接続先: host · …」 | 2b93637 | login-dark → login-dark |
| UX-10 | High | Fixed: (1) the first view is kept per map instance, so the live map frames the fleet (StrictMode had moved the thrown-away map); (2) Lucide `Scan` 「全機を表示」 under the map type button (clears follow); (3) selecting an off-screen vehicle eases it into view | 52b7c83, 0c66797 | ops-desktop, ops-detail-v1, ops-detail-v4, ops-commands-v1 → same + ops-show-all |
| UX-11 | High | Fixed: unknown battery = empty dashed bar, "—", title 「バッテリー残量不明」 (list + detail); the confirm context no longer prints "—%" | cbc1ecb | ops-desktop, video-grid → same |
| UX-12 | High | Fixed: detail header shows mode badge + 「アーム中」/「ディスアーム」 chip (Power / PowerOff); armed list rows have a Power mark in a filled badge; video tile and cockpit share it (ModeBadge); maintenance header too | 55f4636, d58afa9, 874d523, 8a94c7c | ops-detail-v4, maint-calib-rover → same |
| UX-13 | Med | Fixed: the mode badge never truncates; the name shrinks instead (badge 10 px, arm mark inside the badge so STABILIZE and UAV-01 both fit) | 2057f47 | ops-desktop, ops-follow-v4, ops-follow-v1 → same |
| UX-14 | Med | Fixed: dot = link/health only (no blue for copters) | 2057f47 | ops-desktop → ops-desktop |
| UX-15 | Med | Fixed: Navigation2 arrow rotated to the heading (none when unknown); IconAltitude before the altitude | 2057f47 | ops-desktop → ops-desktop |
| UX-16 | Med | Fixed: rover shows distance from home (House icon, 「ホームから」) in the list, detail panel and video stats; the confirm context drops 高度 for rovers | ee79bbc | ops-detail-v4, video-grid, confirm-mission-start-v4 → same |
| UX-17 | Med | Fixed: the vehicle z-index rule never matched (`rg-mk` is on the marker element), so vehicles now draw above home tiles; home tiles titled 「UAV-01 のホーム」. Markers isolated inside the map so they never draw over the maintenance / video panels | 2057f47, 874d523 | ops-follow-v1, ops-3d, ai → same |
| UX-18 | High | Fixed: rover has no 着陸 / 高度変更; emergency row 一時停止 / 帰還; first group 「走行」/"Drive". set_mode / RTL / LAND keep no confirm | c506284 | ops-detail-v4, ops-commands-v4 → same |
| UX-19 | Med | Fixed: 「ミッション」 label, nowrap; unknown total "WP 0 / —" titled 「機体のミッション件数を未取得」; 「書込…」 button with Upload icon; buttons wrap as a group | 89147c8, 8a94c7c | ops-detail-v1, ops-detail-v4 → same |
| UX-20 | Med | Fixed: finished mission → 「最初から再実行」, confirm adds 「ミッションは完了しています。WP 1 から再実行します。」 | 89147c8 | ops-detail-v4, confirm-mission-start-v4 → same |
| UX-21 | Med | Fixed: entries not from today read 「昨日 21:29」 or "10/24 21:29" (detail panel and log sheet) | 89147c8, eafa289 | ops-detail-v1 → ops-detail-v1 |
| UX-22 | Low | Fixed: the count shows once (メッセージ); tile 「メッセージ履歴」 | 66f47f5 | ops-detail-v1 → ops-detail-v1 |
| UX-23 | Low | Fixed: ロック / 追従 / FPV from the dict (status row + cockpit bar); MoveHorizontal / MoveVertical icons (↔ ↕ added to the glyph guard) | 6652326 | ops-detail-v1 → ops-detail-v1 |
| UX-24 | Low | Fixed: battery caption added; captions 11 px text-2 | 66f47f5 | ops-detail-v1 → ops-detail-v1 |
| UX-25 | Med | Fixed: rover = compass only, larger; captions ロール / ピッチ / 方位 everywhere | ee79bbc | ops-detail-v4, ops-commands-v4 → same |
| UX-26 | Med | Fixed: カメラ・ジンバル opens camera settings; 「その他の対応コマンド」 removed | d58afa9 | ops-commands-v4 → ops-commands-v4 |
| UX-27 | Med | Fixed: inline 「アーム後に使用できます」 under the disabled takeoff; arm / disarm lead the 飛行 group | d58afa9 | ops-commands-v1, ops-commands-v2 → same |
| UX-28 | Low | Fixed: 「Guided 移動」 everywhere | 66f47f5 | – |
| UX-29 | High | Fixed: 「対象: アーム中の 1 機 (3 機は対象外)」, skipped list with 未アーム / 通信断; 実行 disabled with 「アーム中の機体がありません」 when none | ae03eac | fleet-rtl-confirm, fleet-pause-confirm → same |
| UX-30 | High | Fixed: click selects; 「UAV-04 に書き込む」 opens an in-app confirm (ConfirmDialog look, portalled) naming mission and vehicle; dates `YYYY/MM/DD HH:MM` (also in the briefing picker). Not done: marking missions with commands the airframe cannot fly (the saved-mission list has no item data) | 6533909, 8a94c7c | mission-picker → mission-picker, mission-picker-confirm |
| UX-31 | Low | Fixed: 「ミッション読込 18:32:31」 | 66f47f5 | – |
| UX-32 | High | Fixed: the write target is exactly the active row's assignment (no fallback to the mission's or the first vehicle); both selects show 未割当; 機体に書き込む disabled with 「書込先の機体を選んでください」; fence / rally panels name the target 「対象機体: UAV-01」. Follow-up: a saved (or read) mission whose vehicle is connected opens with it visibly assigned in both selects (unless another open mission holds it); if not connected: 未割当 + 「保存時の機体 UAV-03 は未接続」. Without a target, 機体から読込 offers the ops-list selection (「UAV-02 から読込」) and the read mission opens assigned to it | 386f3cc, 5869739 | mission, mission-loaded → same (+ mission-target-picked) |
| UX-33 | Med | Fixed: ミッション / フェンス / ラリー | 5772d32 | mission, mission-fence → same |
| UX-34 | Med | Fixed: 「ライブラリに保存」, 「書き出し (.waypoints)」/「書き出し (.rgcsmission)」, 「ファイルを読み込む」; 機体から読込 beside 機体に書き込む; header buttons wrap as a group | 5772d32, 3c0bc4c | mission, mission-loaded → same |
| UX-35 | Med | Fixed: rover target hides frame / default altitude, ▲ altitude in rows, 最大高度 (summary + HUD); palette drops TAKEOFF / LAND / LOITER_TO_ALT / VTOL; TAKEOFF in a rover mission warns 「ローバーは離陸コマンドを無視します」. Not done: 3D altitude poles for a rover | ee79bbc, 3c0bc4c | mission-rover-target → mission-rover-target |
| UX-36 | Med | Fixed: palette opaque; MAV names shrink to fit; commands filtered by the target airframe (no VTOL for a copter) | ee79bbc, 5772d32 | mission-palette → mission-palette |
| UX-37 | Med | Fixed: Lucide chevrons for reorder; 「高度 50 m REL」 (▲ / ▼ added to the glyph guard) | 5772d32 | mission-loaded → mission-loaded |
| UX-38 | Low | Partly: zero delay / radius fields skipped. MAV names kept on rows (existing project convention: full MAV_CMD names shrink with length) | 5772d32 | mission-loaded → mission-loaded |
| UX-39 | Low | Fixed: HUD only while the right summary is folded; 「項目数」; 「6 分 08 秒」 | 75f2c6b | mission-loaded → mission-loaded |
| UX-40 | Low | Fixed: 3D chips "80 m REL" | 75f2c6b, 8bd6894 | mission-rover-target (3D) → – |
| UX-41 | Low | Fixed: the shortcut legend is removed from the list (already in the ? guide) | 5772d32 | mission-loaded → mission-loaded |
| UX-42 | Med | Fixed: 「機体に書込」; notices are TriangleAlert caution lines, 「フェンスは無効です (FENCE_ENABLE = 0)」 | 5772d32 | mission-fence → mission-fence |
| UX-43 | Med | Fixed: tile stats in the cockpit's glass pill | d58afa9 | video-grid → video-grid |
| UX-44 | Low | Fixed: source / latency chip titled 「映像遅延 (カメラ: MT11)」 | 6652326 | – |
| UX-45 | Low | Fixed: 「バージョン」「待受アドレス」; 役割 row dropped (subtitle says スタンドアロン); 6em label column, no wrapping | fc39aff | network → – |
| UX-46 | Low | Fixed: FC line hover title spells out components; legend 「直接リンク」 | fc39aff | network → – |
| UX-47 | Low | **Skipped**: collapsing unconfigured columns is a change to the network graph layout engine (layout.ts), out of proportion for a Low item | – | network → – |
| UX-48 | Med | Fixed: the dropdown is removed (the vehicle list is always visible in maintenance, list or rail); header 「対象機体 UAV-01」 + mode + arm chip; hidden on アプリ設定 | 874d523 | maint-params, maint-calib-rover → same |
| UX-49 | Med | Fixed: 「18 件 (前回取得)」 without a bar when nothing was received this session | 874d523 | maint-params → maint-params |
| UX-50 | Med | Fixed: 「テストを開始」 on the motor card; 「RC 校正」「ESC 校正」 | 874d523 | maint-tab1 → maint-tab1 |
| UX-51 | Med | Fixed: the record tables scroll inside the panel (the surface was not a flex column); `a.btn` has no underline | 874d523 | maint-tab3 → maint-tab3 |
| UX-52 | Low | Fixed: Lucide Check / TriangleAlert (VerifiedMark) in results and a 検証 column; 機体 column dropped | d3a8d1c | maint-tab4 → – |
| UX-53 | Med | Fixed: own 「観客用画面」 card, 「リンクとロゴを管理…」 | 874d523 | maint-tab6 → maint-tab6 |
| UX-54 | Med | Fixed per ruling: card titled 「ログイン画面のテーマ」 (app shell stays dark-only), note shortened to 「自動は OS の設定に従います。」 | 874d523 | maint-tab6 → maint-tab6 |
| UX-55 | Low | Fixed: headline 「旋回が不安定です (トイレットボウル) — 手動で引き継いでください」 in the client banner and the server alert text (Rust test updated); card explains the term | 66f47f5 | – |
| UX-56 | Low | **Skipped**: changing the settings fields to apply on blur is a save-behaviour change across several forms (RGCS SYSID, track minutes) with server writes; not a copy fix | – | maint-tab6 → – |
| UX-57 | Med | Fixed: axis / button functions in words (パン, 録画 開始/停止, ROI 3 を追跡 …) | d58afa9 | camera-settings-tab1 → camera-settings-tab1 |
| UX-58 | Low | Fixed: 緯度 / 経度 / 標高 (MSL); 速度制御 / 角度制御 | 6652326 | camera-settings-tab2 → – |
| UX-59 | Low | Fixed: 「自動」 | 6652326 | camera-settings → – |
| UX-60 | Low | Fixed: 「ロゴを選択…」 button (ImageUp) over a hidden input; ラベル / トークン / 状態 headers | d3a8d1c | present-settings → – |
| UX-61 | Med | Fixed: 「直近 500 件を表示しています。」 | 874d523 | ops-logsheet → ops-logsheet |
| UX-62 | Low | Fixed: operator-facing AI-not-configured copy | 66f47f5, 451fdc0 | ai → ai |

## Notes and side fixes

- Map markers now use `isolation: isolate` on the map container: once the UX-17 z-index rule started matching, vehicle markers drew over the maintenance and video panels. Fixed in 874d523.
- The detail header name no longer breaks beside the new chips; the planner header buttons wrap as a group; row sub-lines no longer end in "· —" (8a94c7c, 3c0bc4c).
- Server change: `apps/rgcs-server/src/guard_vehicle.rs` headline text (+ `guard_hub_tests.rs`). No type changes, so no ts-rs bindings to regenerate.
- The dev server (:8000) was not restarted, so the live server still sends the old guard headline text until it is rebuilt.

## Verification

- `npx tsc --noEmit -p tsconfig.app.json`: clean.
- `npx vitest run --testTimeout=30000`: 257 files, 1613 tests, all passing (after the follow-up).
- `cargo test -p rgcs-server`: 409 passed, 0 failed. `cargo clippy -p rgcs-server --all-targets -D warnings`: clean.
- `scripts/e2e.sh` (its own server on :8010, no SITL), run on HEAD including the coordinator's e2e expectation fix (660dafd): 10 passed, 10 skipped (they need SITL, the simulator or video), 0 failed.
- After the UX-32 follow-up (5869739): `tsc` clean; vitest 257 files / 1613 tests, all passing.
