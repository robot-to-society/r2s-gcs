# Network View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable the ネットワーク screen (spec 10 §8, `glass_network*.png`). It is drawn from **real data that this standalone server has**. The parts of the M5 picture that do not exist yet are drawn as honest 「未構成」 placeholders, never as fake numbers. The work has four parts:
- **Link statistics (`rgcs-mavlink`):** per (sysid, compid):
  - received msg/s and bytes/s;
  - packet loss from MAVLink sequence gaps;
  - MAV_TYPE from HEARTBEAT;
  - last-rx age.
  - Per link: connected state, connected since, reconnect count and last error.
- **Topology (`rgcs-server`):** `GET /api/network` → `NetworkTopology`:
  - this server (version, build, hostname, listen, role, uptime);
  - the MAVLink link (config `mavlink_url`, stats);
  - each vehicle (sysid, name, kind, link status, heartbeat age, components, camera link, video path);
  - MediaMTX (WHEP upstream, reachable);
  - connected UI clients (WS sessions: user, role, address, browser, since);
  - the list of unconfigured M5 elements.
  - WS `network_status` sends the full topology at 1 Hz.
- **Canvas (UI):** `.netmap` infinite canvas (pan / zoom / fit / LOD / select-and-dim) laid out like the prototype.
  - Vehicles sit in the site zone. MAVLink edges run from each vehicle's dot to the **rgcs-server** card, which takes the GW slot. Client cards hang under it on a 「WS（ローカル）」 pill.
  - Placeholders (dashed and dim, 「未構成」) take the places where the design draws:
    - the per-vehicle LTE pills;
    - the mesh GW and its 上り回線;
    - the Internet band;
    - the RGCS Hub;
    - remote users;
    - the NTRIP caster.
- **Inspector (UI):** right panel (340 px) for the server, link, vehicle, component, client, media and placeholders. The vehicle route reads `UAV-01 → MAVLink (tcp:127.0.0.1:5760) → rgcs-server → クライアント 2`. The nav item is enabled, with ja + en strings.

**Architecture:**
- **`LinkStats`** (`crates/rgcs-mavlink/src/link_stats.rs`) is a cloneable `Arc<std::sync::Mutex<…>>` counter set, like `Inspector`. `connection.rs` calls `record` for every received frame (no await while locked) and `on_connected` / `on_disconnected` around `receive_loop`. Rates use 1 s buckets over the last `STATS_WINDOW_S = 5` complete seconds.
- **Topology assembly is a pure function.** `network::assemble(&NetworkInputs) -> NetworkTopology` takes plain snapshots. The router states and heartbeat ages, the `LinkStatsSnapshot`, camera profiles + camera snapshots, video statuses, the media probe result, the session list and the `NetworkConfig` are each gathered by `network::collect(&AppState)` with one lock at a time.
- **`network::run_status`** broadcasts `ServerMessage::NetworkStatus { topology }` every 1 000 ms. It skips the tick when `tx.receiver_count() == 0`. It is not part of the WS `snapshot`; the view GETs `/api/network` when it opens.
- **`SessionRegistry`** (`apps/rgcs-server/src/sessions.rs`) gets one entry per WS session, held by a `SessionGuard` whose `Drop` removes it, so every exit path of `ws::session` cleans up. The client address comes from `ConnectInfo<SocketAddr>`. For that, `main.rs` serves with `into_make_service_with_connect_info::<SocketAddr>()`. The handler extracts `Option<Extension<ConnectInfo<SocketAddr>>>`, so `oneshot` tests without ConnectInfo still work and report `addr: null`.
- **`MediaProbe`** (`apps/rgcs-server/src/media_probe.rs`) TCP-connects to the WHEP upstream host:port every 5 s with a 1 s timeout. Its result is `Option<bool>`, and it stays `None` until the first probe.
- **UI.** `features/network/` holds pure modules and thin components on top:
  - `graph` (topology → nodes / edges with ids);
  - `layout` (port of the prototype's `netLayout`, `netLod`, `netFitView`, `netZoomAt`);
  - `relations` (port of `netRel`, reduced to the real path);
  - `inspect` (selection → kv / tables).
  - The components are `NetworkCanvas` (SVG, pointer / wheel), `NetworkInspector` and `NetworkView`.
  - The reducer keeps `network: NetworkTopology | null`.
  - It uses the prototype's class names (`.netwrap`, `.netbar`, `.netmap`, `.netsvg`, `.nn`, `.ne`, `.npl`, `.nzone`, `.mdot`, `.netctl`, `.nethint`, `.ntable`, `.stage.net`). Placeholder styling goes in a new `styles/network.css`.

**Tech stack:** Rust (tokio, axum 0.8, mavlink 0.19.1 `ardupilotmega` dialect, ts-rs), React 19 + TypeScript (vitest, @testing-library), lucide-react, Playwright (headless check only).

**Specs (binding):**
- `docs/spec/80-network.md`:
  - §1 (one configuration; standalone = one vehicle connected; the vehicle and its node are one block; Internet and direct paths are drawn apart; Mission Planner is never drawn);
  - §2 (COMPID 1 autopilot, 100 camera, 154 gimbal);
  - §3 (loss 3 % threshold, reused as the warn threshold);
  - §4 (`GET /api/network` → `NetworkTopology`, WS `network_status` 1 Hz; marked 案, and the deviations are below);
  - §6 (undecided items: this plan decides none of them).
- `docs/spec/10-screens.md`:
  - §1 (nav `.seg.n6`, network is the 4th button);
  - §8 (layout: canvas + 340 px panel, title / summary / legend, zones left → right, vehicle block lines, selection dims the unrelated, canvas controls 6–250 %, LOD 55 % / 28 %, 8-row grid for 9+ vehicles, 1 Hz values);
  - §9 (`netSel` default, view state client-only);
  - §10 (the 6 / 100 preview toggle is prototype-only);
  - the P7 note (nav disabled until M5, which this plan lifts).
- `docs/spec/50-api.md`: §2.8 (`/api/network`) and §3 (`network_status`), both updated in Task 8.
- Design:
  - `design_base/screenshots/glass_network.png` (default selection = Hub panel; this plan uses the rgcs-server panel);
  - `glass_network_route.png` (vehicle selected: related elements bright, others `.dim`; panel kv + COMPID table + endpoint table);
  - `glass_network_field.png` (Field PC selected: local path highlighted);
  - `glass_network_100_compact.png` (28–55 %: name + status dot cards);
  - `glass_network_100_detail.png` (8-row grid);
  - `glass_network_100_sites.png` (< 28 %: site summary + coloured tiles).
- Prototype: `design_base/project/RGCS Prototype Glass.dc.html`:
  - lines 695–727 (markup);
  - lines 1890–2080 (`netLocal`, `netRoute`, `netRel`, `netKit`, `netVehicle`, `netLod`, `netLayout`, `netSiteSvg`, `netSvg`, `netFitView`, `renderNet`, `netZoomAt`, `netBind`, `netInspector`).

## Global Constraints
- TDD: every test is written and seen failing first.
- Immutable state: never mutate shared objects. In Rust, return new values where the codebase does (`fn tick(&self, …) -> (Self, …)`, `..self.clone()`).
- Files ≤ 400 lines typical, 800 max. Functions < 50 lines.
- UI:
  - single quotes, no semicolons, never run prettier;
  - Lucide icons only (`shared/ui/icons.tsx`);
  - never hand-edit `styles/prototype.css`;
  - no `window.confirm`.
- UI type check: `npx tsc --noEmit -p tsconfig.app.json`, run from `apps/rgcs-server/ui`.
- UI tests: `npx vitest run <paths>`.
- Rust:
  - `export PATH="$HOME/.cargo/bin:$PATH"`;
  - `cargo test -p <crate>`;
  - `cargo clippy --workspace --all-targets -- -D warnings`.
- ts-rs bindings (`apps/rgcs-server/ui/src/shared/api/generated/`) are committed.
- Commit messages are conventional (`feat(...)`) and end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never commit `.claude/`, `auto.crt`, `auto.key`.
- Never send vehicle commands or write vehicle params to the dev stack (ports 5760-5793, 8000, 5173, 14550, 14551, 37260). Live checks run only against a scratch server (8110), a scratch Vite (5181) and a scratch SITL (`-I6`, tcp:5820) (Task 8).
- Never use `pkill` / `killall` / pattern kills. Stop only processes you started, by the PID you recorded (`$!`).

## Fixed values (tests assert these)

| Value | Fixed at | Source |
|---|---|---|
| Stats window | 1 s buckets. Rates = sum of the buckets for seconds `[now_s − 5, now_s − 1]` ÷ 5 (`STATS_WINDOW_S = 5`); the current, incomplete second is excluded | ruling 4 |
| Frame bytes | `mavlink::MAVLinkV2MessageRaw` serialized length of (header, msg): 10 header + truncated payload + 2 CRC. HEARTBEAT (`mavlink_version` 3) = **21** | ruling 3 |
| Sequence gap | `gap = seq.wrapping_sub(last.wrapping_add(1))`. 0 = in order; 1..=127 → `lost += gap`; ≥ 128 (duplicate / reorder / restart) → resync, nothing lost. The first frame of a (sysid, compid), and the first after a reconnect, only sets the baseline | ruling 4 |
| Loss % | `lost ÷ (received + lost) × 100` over the window; 0 when both are 0. Link loss = sums over all components | ruling 4 |
| Warn | loss > 3.0 % (80 §3), link `delay` / `lost`, link disconnected, media `reachable == false` | ruling 12 |
| Component kind | HEARTBEAT `MAV_TYPE` wins: 6 GCS → `gcs`; 18 ONBOARD_CONTROLLER → `companion`; 26 GIMBAL → `gimbal`; 30 CAMERA → `camera`; any type with autopilot ≠ 8 (INVALID) → `autopilot`. Without a heartbeat, by compid: 1 → `autopilot`; 100..=105 → `camera`; 154, 171..=175 → `gimbal`; 191..=194 → `companion`; 190 → `gcs`; else `other`. Short labels AP / CAM / GMB / CC / GCS / OTH | ruling 5, 80 §2 |
| Components kept | at most `MAX_COMPONENTS = 256` (sysid, compid) pairs; the least recently seen is evicted (same rule as `Inspector::MAX_ROWS`) | review focus 1 |
| Broadcast | `network_status` every 1 000 ms, full topology, skipped while `receiver_count() == 0` | ruling 2 |
| Media probe | TCP connect to the WHEP upstream host:port (port defaults 80 / 443 by scheme), timeout 1 000 ms, every 5 000 ms | ruling 13 |
| Canvas | zoom clamp 0.06–2.5 (6–250 %); LOD `k ≥ 0.55` full, `≥ 0.28` compact, else site; buttons ×1.25 / ×0.8; double-click ×2; drag threshold 4 px; fit `k = min(1.2, cw/W, ch/H) × 0.97` | 10 §8, prototype `netLod` / `netFitView` / `netZoomAt` |
| Layout | `RH 77`, `CWD 306`, `VW 236`, `VH 70`; first vehicle at `[176, 62]` (1 column), `vx = 150` when columns > 1; ≤ 8 rows per column | prototype `netLayout` |

## Rulings (spec gaps / open questions decided here)
1. **`NetworkTopology` shape (deviation from 80 §4 案).**
   - There are no `sites`, `mesh`, `users` or `external` lists, and no vehicle `node`, `lte`, `route` or `local_route`. None of these exists in a standalone server, and the spec forbids inventing values.
   - New fields: `server`, `links`, `clients`, `media` and `unconfigured: Unconfigured[]`. The last lists what is drawn as 未構成: `hub`, `lte`, `mesh`, `gateway`, `ntrip` and `node`.
   - Vehicles keep `sysid`, `name`, `kind` and `components` (`compid`, `kind`, plus stats). They gain `link`, `link_id`, `heartbeat_age_ms`, `camera` and `video`.
   - M5 adds the missing fields additively and removes entries from `unconfigured`.
   - The UI derives the only real route: vehicle → link → server → clients.
2. **`network_status` sends the full topology, not a diff.** The frame is `{t: 'network_status', topology}` at 1 Hz. A standalone topology is a few kB, and a full frame removes the diff-merge and missing-key edge cases. The cost is that 50 §3's `{diff}` is replaced; Task 8 updates the spec. The frame is not part of `snapshot`, and the view GETs `/api/network` on open.
3. **Bytes/s is an estimate.** It is the re-serialized MAVLink 2 length of each decoded frame. It excludes the signature (13 bytes) and any bytes the parser dropped, and counts MAVLink 1 frames at their v2 size. The `mavlink` crate exposes no raw byte count through `AsyncMavConnection::recv`. The inspector label reads 「受信 (推定)」 / "rx (est.)".
4. **Loss is from per-(sysid, compid) sequence gaps over a 5 s window.** Gaps of 128 or more resync without counting, because duplicates through a second router, reordering on UDP and FC reboots must not read as loss. A reconnect clears all baselines. Loss is a receive-side figure. TX loss and round-trip latency are out of scope: there is no ping protocol on the link today.
5. **Components** are classified as in the fixed-values table. A component appears once any frame from it arrives, with or without a heartbeat. Note that ArduPilot reports a SIYI / servo gimbal and its camera from compid 1, so on SITL the table shows only `AP 1`. That is the truth, not a bug.
6. **`LinkStats` is new and does not reuse `Inspector`.**
   - Inspector rows are per message, with 2 s windows that open at different times. Rows are evicted at 4 096, and they carry no sequence numbers or byte sizes.
   - Summing them every second would be costly and inconsistent.
   - The inspector stays as is. The network inspector links to it in one line: 「詳細は MAVLink インスペクター」.
7. **Clients = WS sessions.**
   - Each browser tab is one row: `username`, `role`, `addr` (TCP peer `ip:port`), `browser`, `connected_since_unix_ms`.
   - `X-Forwarded-For` is not trusted. Behind the Vite dev proxy every client therefore reads `127.0.0.1`.
   - `browser` = `browser_label(User-Agent)`: `Edg/` → `Edge`, `Firefox/` → `Firefox`, `Chrome/` → `Chrome`, `Safari/` → `Safari`, else `Other`, checked in that order.
   - Presentation viewers (`/present`, token based, no WS) and WHEP-only sessions are not listed.
8. **Access.** Any logged-in user (`AuthUser`, operator or admin) may GET the topology and receives the broadcast, the same as the vehicle list. Userinfo (`user:pass@`) is stripped from `whep_upstream` before it is exposed. `mavlink_url` has no credentials by grammar (`link.rs`). No tokens, cookies or presentation tokens are ever included.
9. **Placement on the canvas (one site zone, label 「現場 · 直接」 / "Site · direct").**
   - Vehicle blocks sit where the design puts them. The left dot (`.mdot`, id `r:<sysid>`) is the vehicle's MAVLink endpoint.
   - MAVLink edges (`.ne.mesh`) run from each dot to the **rgcs-server** card in the GW slot (`[vx − 110, gwY]`, 220×48). The card's subtitle is `<listen> · スタンドアロン`. One link pill `MAVLink · tcp:127.0.0.1:5760` (`link:link0`) sits on the server card's top-left.
   - Client cards (220×48 each, 58 px apart) hang under the server on the pill `WS（ローカル）` (`.npl.rtc`) with the column label 「地上操作」.
   - The 「メッシュ GW · 未構成」 placeholder card sits below the clients and carries its `上り回線 · 未構成` pill into the Internet band.
   - Each vehicle gets an `LTE · 未構成` placeholder pill (the bundled `LTE × n · 未構成` above 8 vehicles), with dashed edges to the dim **RGCS Hub · 未構成** card in the cloud zone.
   - The users column shows one 「遠隔ユーザー · Hub 未構成」 card, and the external column one 「NTRIP caster · 未構成」 card.
   - Placeholders carry class `ph` (`.nn.ph`, `.npl.ph`, `.ne.ph`), defined in `styles/network.css`: dashed stroke, opacity .45, no flow animation. They are selectable and their inspector explains M5.
10. **Vehicle block line 3** shows the **camera link** instead of `rgcs-node · IP`, because no node exists:
    - `MT11 · 192.168.144.25:37260 · 接続` (`未接続` in amber when disconnected);
    - `MAVLink カメラ · FC 経由 · CAM 100`;
    - `カメラなし`.
    - Line 2 is `FC · AP 1 · CAM 100 · GMB 154` from the real components. When no frames have arrived it reads `FC · —`.
    - The vehicle inspector shows `rgcs-node` as a 未構成 kv row, and the endpoint table is replaced by a camera table and a video table.
11. **Default selection is `server`** (the design defaults to `hub`, which is unconfigured). A click on empty canvas selects `server`. `netSel` and the view transform stay client-only (10 §9). The 6 / 100 preview toggle is dropped (10 §10). The bar shows the summary `1 リンク · 2 機体 · 1 警告 · 3 クライアント` and the four-entry legend:
    - インターネット (placeholders only);
    - 直接波 (MAVLink);
    - WebRTC (the label reads `WS / WebRTC` because local clients use WS + WHEP);
    - RTCM (placeholder only).
12. **Warn colours.** A vehicle block is `.warn` (amber) when its `link` is `delay` or `lost`. The link pill is `.warn` when the link is disconnected or loss > 3 %. A component row is `warn` when loss > 3 %. The media row is `warn` when unreachable. Lost vehicles stay on the canvas (the router keeps them), with status 「通信断」.
13. **Video path** per vehicle comes from `VideoHub::status`: `source`, `probe_ok` (RTSP DESCRIBE reachable), `scanning` and `whep_path`. MediaMTX liveness is server-wide (`media.reachable`, TCP connect, ruling 8 strips userinfo). The UI shows 「映像 · MediaMTX 到達不可」 when `reachable == false` and 「確認中」 while it is `None`.
14. **Links.** `links` is a list with one entry today (`id: "link0"`, from `config.mavlink_url`, `kind` from `LinkUrl`). Systems on the link with no FC heartbeat (e.g. another GCS) are listed only in the link inspector's システム table, never as vehicle blocks.
15. **80 §6 stays open.** The screen decides no undecided item: Hub necessity, rgcs on the GW, mesh model, LTE thresholds, RTCM without internet, multi-site, MQTT granularity.

## Review Focus (untested-in-isolation failure modes most likely to bite an operator)
1. **The receive loop stalls.**
   - `LinkStats::record` runs for every frame on the link task. It must take a `std::sync::Mutex` for a map update only: no await, no allocation per frame beyond first-seen keys, bounded at 256 keys.
   - A slow `collect()` must never hold that lock while it awaits the router or the store.
   - Check this live: at 50 Hz ATTITUDE, the inspector's ATTITUDE rate is unchanged with the network view open.
2. **False loss.**
   - Loss can read wrong when:
     - two routers forward the same component (duplicates);
     - MAVLink 1 frames arrive;
     - the FC reboots;
     - a udpin link has two senders with the same ids.
   - The ≥ 128 resync and the per-reconnect reset cover the common cases. Only the live check (SITL, loss 0.0 % for 60 s) proves there is no systematic bias.
3. **The client address is silently missing.** If `main.rs` loses `into_make_service_with_connect_info`, every client shows `—` and no test fails, because `oneshot` tests run without ConnectInfo. Task 3 adds a bound-listener test, and the live check asserts `127.0.0.1:` on the card.
4. **Ghost sessions.** The registry entry must disappear on every `ws::session` exit: close, error, lagged-then-send-failure, server shutdown. The `SessionGuard` `Drop` is the only remover. Test it with a real socket close, not just a direct `drop`.
5. **Information exposure and broadcast load.**
   - Every logged-in user receives client IPs, usernames and the WHEP URL each second; userinfo must be stripped.
   - The 1 Hz full frame shares the 1 024-slot broadcast channel with telemetry. It must stay small (no per-message rows), or slow clients lag and get resnapshotted more often.
   - Check the serialized size in a test: ≤ 8 KB for 6 vehicles × 3 components and 5 clients.

---

### Task 1: `LinkStats` — per-component rates, bytes, sequence loss (`rgcs-mavlink`)

**Files:**
- Create: `crates/rgcs-mavlink/src/link_stats.rs`.
- Modify:
  - `crates/rgcs-mavlink/src/connection.rs` (`LinkChannels.stats`; `record` next to `inspector.record`; `on_connected` / `on_disconnected` in `run_link`);
  - `crates/rgcs-mavlink/src/lib.rs` (`pub mod link_stats; pub use link_stats::{LinkStats, LinkStatsSnapshot, ComponentStats, component_kind, frame_bytes};`);
  - `crates/rgcs-core/src/network.rs` (only `ComponentKind` here; the rest comes in Task 2, and the module is created now);
  - `crates/rgcs-core/src/lib.rs`;
  - `apps/rgcs-server/src/main.rs` (pass `stats` into `LinkChannels`; `AppState.link_stats` comes in Task 4, so use a local `LinkStats::default()` clone for now).

**Interfaces — Produces:**
```rust
// rgcs-core network.rs — Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, snake_case
pub enum ComponentKind { Autopilot, Camera, Gimbal, Companion, Gcs, Other }

// link_stats.rs
pub const STATS_WINDOW_S: u64 = 5;
pub const MAX_COMPONENTS: usize = 256;
#[derive(Debug, Clone, Default)]
pub struct LinkStats { inner: Arc<Mutex<Inner>>, started: Instant }   // std::sync::Mutex
impl LinkStats {
    pub fn now_ms(&self) -> u64;                                   // ms since created, like Inspector
    pub fn on_connected(&self, unix_ms: u64);                      // 2nd and later calls → reconnects += 1; clears seq baselines
    pub fn on_disconnected(&self, error: Option<String>);
    pub fn record(&self, header: &MavHeader, msg: &MavMessage, now_ms: u64);
    pub fn snapshot(&self, now_ms: u64) -> LinkStatsSnapshot;
}
#[derive(Debug, Clone, PartialEq)]
pub struct LinkStatsSnapshot {
    pub connected: bool, pub connected_since_unix_ms: Option<u64>, pub reconnects: u32,
    pub last_error: Option<String>, pub rx_msgs_per_s: f32, pub rx_bytes_per_s: f32,
    pub loss_pct: f32, pub last_rx_age_ms: Option<u64>, pub components: Vec<ComponentStats>, // sorted (sysid, compid)
}
#[derive(Debug, Clone, PartialEq)]
pub struct ComponentStats {
    pub sysid: u8, pub compid: u8, pub mav_type: Option<u8>, pub autopilot: Option<u8>,
    pub kind: rgcs_core::ComponentKind, pub rx_msgs_per_s: f32, pub rx_bytes_per_s: f32,
    pub loss_pct: f32, pub last_rx_age_ms: u64,
}
pub fn component_kind(compid: u8, mav_type: Option<u8>, autopilot: Option<u8>) -> rgcs_core::ComponentKind;
pub fn frame_bytes(header: &MavHeader, msg: &MavMessage) -> usize;
// connection.rs
pub struct LinkChannels { /* existing … */ pub stats: crate::link_stats::LinkStats }
```

- [ ] **Step 1: Write failing tests** (`link_stats.rs` `mod tests`; `hb(seq)` builds a HEARTBEAT with `mavlink_version: 3` from (1, 1)):
  - `heartbeat_frame_is_21_bytes`: `frame_bytes(&hdr(1, 1, 0), &hb()) == 21`.
  - `rate_counts_complete_seconds_only`:
    - 50 frames, seq 0..49, at `now_ms = 1000 + 100·i`;
    - `snapshot(6000)` → `rx_msgs_per_s == 10.0`, `rx_bytes_per_s == 210.0`, `loss_pct == 0.0`;
    - `snapshot(6999)` gives the same values;
    - `snapshot(12000)` → `rx_msgs_per_s == 0.0`.
  - `gap_counts_as_lost`: seq 0, 1, 2, 5 at t = 1000, 1100, 1200, 1300 → `snapshot(2000)`: component loss is `2 ÷ 6 × 100`, i.e. `(loss_pct − 33.33).abs() < 0.01`.
  - `wrap_and_reorder_are_not_loss`:
    - seq 254, 255, 0, 1 → 0 lost;
    - then 1 (duplicate, gap 255) → 0 lost, and the baseline stays 1;
    - then 2 → 0 lost.
  - `reconnect_resets_baselines`: `on_connected(…)`, seq 10, `on_connected(…)` again, seq 200 → 0 lost; `reconnects == 1`.
  - `components_are_kept_per_pair_and_classified`:
    - frames from (1, 1) HEARTBEAT `MAV_TYPE_QUADROTOR` / `MAV_AUTOPILOT_ARDUPILOTMEGA`, from (1, 100) CAMERA_SETTINGS with no heartbeat, and from (1, 154) HEARTBEAT `MAV_TYPE_GIMBAL` / `INVALID`;
    - → kinds `[Autopilot, Camera, Gimbal]` in compid order.
  - `component_kind_table`:
    - `(1, None, None) → Autopilot`;
    - `(101, None, None) → Camera`;
    - `(172, None, None) → Gimbal`;
    - `(191, None, None) → Companion`;
    - `(190, None, None) → Gcs`;
    - `(42, None, None) → Other`;
    - `(42, Some(6), Some(8)) → Gcs`;
    - `(42, Some(2), Some(3)) → Autopilot`;
    - `(1, Some(18), Some(8)) → Companion`.
  - `components_are_bounded`: 300 distinct compids (sysid 1..=2 × compid 0..150) → `components.len() == 256`, and the earliest-seen pair is gone.
  - `last_rx_age_and_connection_state`:
    - a fresh `snapshot(0)` → `connected false`, `last_rx_age_ms None`;
    - `on_connected(1_700_000_000_000)`, a frame at 500, `snapshot(1500)` → `connected true`, `connected_since_unix_ms == Some(1_700_000_000_000)`, `last_rx_age_ms == Some(1000)`;
    - `on_disconnected(Some("eof"))` → `connected false`, `last_error == Some("eof")`.
- [ ] **Step 2:** `cargo test -p rgcs-mavlink link_stats`. Expected: FAIL to compile.
- [ ] **Step 3: Implement.**
  - `Inner { connected, since, reconnects, connects, last_error, comps: HashMap<(u8, u8), Comp> }`.
  - `Comp { last_seq: Option<u8>, mav_type, autopilot, last_ms, buckets: [Bucket; 8] }`, where `Bucket { second: u64, frames: u32, bytes: u32, lost: u32 }`. `record` writes `bucket[(now_s % 8)]` and resets it when `second` differs.
  - In `run_link`:
    - after `connect_async` succeeds: `ch.stats.on_connected(unix_now_ms())`;
    - after `receive_loop` returns: `ch.stats.on_disconnected(Some("link closed".into()))`;
    - on a connect error / timeout: `on_disconnected(Some(e.to_string()))` (or `"connect timed out"`).
  - In `receive_loop`: `ch.stats.record(&header, &msg, ch.stats.now_ms())` right after `inspector.record`.
- [ ] **Step 4:** `cargo test -p rgcs-mavlink` → PASS. `cargo build -p rgcs-server`. clippy.
- [ ] **Step 5:** commit `feat(mavlink): per-component link stats with sequence-gap loss`.

### Task 2: Core types — `NetworkTopology` and `network_status`

**Files:**
- Modify:
  - `crates/rgcs-core/src/network.rs` (all types below plus tests);
  - `crates/rgcs-core/src/ws.rs` (`ServerMessage::NetworkStatus`);
  - `crates/rgcs-core/src/lib.rs` (re-exports).
- Regenerated: `apps/rgcs-server/ui/src/shared/api/generated/{NetworkTopology,ServerNode,MavLinkInfo,MavLinkKind,NetSystem,NetComponent,ComponentKind,NetVehicle,CameraLink,CameraTransport,VideoPath,MediaServer,ClientSession,Unconfigured,ServerMessage}.ts`.
- Modify: `apps/rgcs-server/ui/src/shared/api/types.ts` (re-export the new types).

**Interfaces — Produces** (all `Debug, Clone, PartialEq, Serialize, Deserialize, TS, #[ts(export)]`; enums snake_case; `u64` fields get `#[ts(type = "number")]` / `"number | null"`):
```rust
pub struct NetworkTopology { pub server: ServerNode, pub links: Vec<MavLinkInfo>, pub vehicles: Vec<NetVehicle>,
    pub clients: Vec<ClientSession>, pub media: MediaServer, pub unconfigured: Vec<Unconfigured>, pub at_unix_ms: u64 }
pub struct ServerNode { pub hostname: String, pub version: String, pub build: String, pub listen: String,
    pub role: String /* "standalone" | "edge" | "hub" */, pub uptime_s: u64, pub started_unix_ms: u64 }
pub enum MavLinkKind { Udpin, Udpout, Tcp, Serial }
pub struct MavLinkInfo { pub id: String, pub url: String, pub kind: MavLinkKind, pub connected: bool,
    pub connected_since_unix_ms: Option<u64>, pub reconnects: u32, pub last_error: Option<String>,
    pub rx_msgs_per_s: f32, pub rx_bytes_per_s: f32, pub loss_pct: f32, pub last_rx_age_ms: Option<u64>,
    pub systems: Vec<NetSystem> }
pub struct NetSystem { pub sysid: u8, pub vehicle: bool, pub components: Vec<NetComponent> }
pub struct NetComponent { pub compid: u8, pub kind: ComponentKind, pub mav_type: Option<u8>,
    pub rx_msgs_per_s: f32, pub loss_pct: f32, pub last_rx_age_ms: u64 }
pub struct NetVehicle { pub sysid: SysId, pub name: String, pub kind: VehicleKind, pub link: LinkStatus,
    pub link_id: String, pub heartbeat_age_ms: Option<u64>, pub components: Vec<NetComponent>,
    pub camera: Option<CameraLink>, pub video: Option<VideoPath> }
pub enum CameraTransport { TcpUdp, ViaFc }
pub struct CameraLink { pub kind: CameraKind, pub transport: CameraTransport, pub endpoint: String,
    pub connected: bool, pub firmware: Option<String>, pub last_error: Option<String> }
pub struct VideoPath { pub source: VideoSource, pub probe_ok: bool, pub scanning: bool, pub whep_path: String }
pub struct MediaServer { pub whep_upstream: String, pub reachable: Option<bool> }
pub struct ClientSession { pub id: u64, pub username: String, pub role: crate::operator::Role,
    pub addr: Option<String>, pub browser: String, pub connected_since_unix_ms: u64 }
pub enum Unconfigured { Hub, Lte, Mesh, Gateway, Ntrip, Node }
pub const UNCONFIGURED_STANDALONE: [Unconfigured; 6] = [Hub, Lte, Mesh, Gateway, Ntrip, Node];
// ws.rs
ServerMessage::NetworkStatus { topology: NetworkTopology }   // t = "network_status"
```

- [ ] **Step 1: Write failing tests** (`network.rs`):
  - `network_status_tag`: `serde_json::to_value(ServerMessage::NetworkStatus { topology: sample() })["t"] == "network_status"` and `["topology"]["server"]["role"] == "standalone"`.
  - `enums_are_snake_case`:
    - `CameraTransport::TcpUdp` → `"tcp_udp"`;
    - `CameraTransport::ViaFc` → `"via_fc"`;
    - `MavLinkKind::Udpin` → `"udpin"`;
    - `Unconfigured::Gateway` → `"gateway"`;
    - `ComponentKind::Companion` → `"companion"`.
  - `sample_round_trips`: serialize → deserialize equals.
  - `topology_stays_small`: 6 vehicles × 3 components + 5 clients + camera + video → `serde_json::to_vec(..).len() <= 8192` (review focus 5).
- [ ] **Step 2:** `cargo test -p rgcs-core network`. Expected: FAIL to compile.
- [ ] **Step 3: Implement.** Then run `cargo test -p rgcs-core` to regenerate the bindings. Add the re-exports in `types.ts`. Fix any exhaustive `switch` in the UI that tsc reports (the `reducer.ts` default branch should already absorb the new tag).
- [ ] **Step 4:** `cargo test -p rgcs-core` → PASS. `npx tsc --noEmit -p tsconfig.app.json` → clean.
- [ ] **Step 5:** commit `feat(core): network topology types and network_status frame`.

### Task 3: WS session registry and client address

**Files:**
- Create: `apps/rgcs-server/src/sessions.rs`.
- Modify:
  - `apps/rgcs-server/src/lib.rs` (`pub mod sessions;`);
  - `apps/rgcs-server/src/app.rs` (`pub sessions: SessionRegistry` in `AppState`, default in `new`);
  - `apps/rgcs-server/src/ws.rs` (the handler takes `Option<Extension<ConnectInfo<SocketAddr>>>` and the `User-Agent`; `session` holds a `SessionGuard` for its whole life);
  - `apps/rgcs-server/src/main.rs` (`axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())`).

**Interfaces — Produces:**
```rust
#[derive(Clone, Default)]
pub struct SessionRegistry { inner: Arc<std::sync::Mutex<BTreeMap<u64, ClientSession>>>, next: Arc<AtomicU64> }
impl SessionRegistry {
    pub fn register(&self, username: &str, role: Role, addr: Option<SocketAddr>, user_agent: Option<&str>,
                    now_unix_ms: u64) -> SessionGuard;
    pub fn list(&self) -> Vec<ClientSession>;          // ordered by id (= connect order)
}
pub struct SessionGuard { registry: SessionRegistry, id: u64 }   // Drop removes `id`
impl SessionGuard { pub fn id(&self) -> u64; }
pub fn browser_label(user_agent: Option<&str>) -> String;
// ws.rs
pub async fn handler(ws: WebSocketUpgrade, headers: HeaderMap,
    connect: Option<Extension<ConnectInfo<SocketAddr>>>, State(app): State<AppState>, AuthUser(op): AuthUser) -> Response;
async fn session(socket: WebSocket, app: AppState, operator: Operator, addr: Option<SocketAddr>, user_agent: Option<String>);
```

- [ ] **Step 1: Write failing tests:**
  - `sessions.rs`:
    - `register_lists_and_drop_removes`:
      - two `register` calls → `list()` has ids `[1, 2]`; the first row is `username "admin"`, `role Admin`, `addr Some("10.0.0.5:51000")`, `browser "Chrome"`, `connected_since_unix_ms 1000`;
      - drop guard 1 → `list()` ids `[2]`.
    - `browser_labels`:
      - `"… Chrome/129.0 Safari/537.36 Edg/129.0"` → `"Edge"`;
      - `"… Firefox/131.0"` → `"Firefox"`;
      - `"… Chrome/129.0 Safari/537.36"` → `"Chrome"`;
      - `"… Version/18.0 Safari/605.1.15"` → `"Safari"`;
      - `"curl/8.7"` → `"Other"`;
      - `None` → `"Other"`.
  - `apps/rgcs-server/tests/network_sessions.rs` (integration, real listener):
    - bind `127.0.0.1:0`, serve `app::build(state.clone(), None).into_make_service_with_connect_info::<SocketAddr>()`, log in, then open `/ws` with `tokio-tungstenite` (already a dev-dependency if `ws` tests use it; otherwise add it as a dev-dependency), sending the session cookie and `User-Agent: test Firefox/131.0`;
    - after the snapshot frame: `state.sessions.list()` has one row whose `addr` starts with `"127.0.0.1:"` and `browser == "Firefox"`;
    - close the socket → within 1 s (poll every 20 ms) `list()` is empty (review focus 3 and 4).
- [ ] **Step 2:** `cargo test -p rgcs-server sessions` and `cargo test -p rgcs-server --test network_sessions`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `let _guard = app.sessions.register(...)` is the first line of `session`. Pass the whole `Operator` (username + role); `perform` / `close_session` keep using `op.username`.
  - `addr` from `connect.map(|Extension(ConnectInfo(a))| a)`.
- [ ] **Step 4:** `cargo test -p rgcs-server` → PASS. clippy.
- [ ] **Step 5:** commit `feat(server): track WebSocket sessions with client address`.

### Task 4: Topology assembly, media probe, `GET /api/network`, 1 Hz `network_status`

**Files:**
- Create:
  - `apps/rgcs-server/src/network.rs` (`NetworkConfig`, `NetworkInputs`, `assemble`, `collect`, `run_status`);
  - `apps/rgcs-server/src/network_api.rs`;
  - `apps/rgcs-server/src/media_probe.rs`.
- Modify:
  - `apps/rgcs-server/src/lib.rs`;
  - `apps/rgcs-server/src/app.rs`:
    - fields `link_stats: rgcs_mavlink::LinkStats`, `network: Arc<NetworkConfig>`, `media: MediaProbe`;
    - builder `with_network(NetworkConfig) -> Self`;
    - `started_unix_ms` stored next to `started`;
    - route `.route("/network", get(network_api::get))`;
  - `apps/rgcs-server/src/main.rs`:
    - `LinkChannels.stats = state.link_stats.clone()`;
    - `.with_network(NetworkConfig { listen: config.listen, mavlink_url: config.mavlink_url.clone(), role: config.role })`;
    - `tokio::spawn(rgcs_server::network::run_status(state.clone(), Duration::from_secs(1)))`;
    - `state.media.spawn(&config.whep_upstream)`.

**Interfaces — Produces:**
```rust
#[derive(Debug, Clone)]
pub struct NetworkConfig { pub listen: SocketAddr, pub mavlink_url: String, pub role: crate::config::Role }
impl Default for NetworkConfig { /* Config::default() values */ }
pub struct NetworkInputs {
    pub config: NetworkConfig, pub hostname: String, pub uptime_s: u64, pub started_unix_ms: u64, pub now_unix_ms: u64,
    pub vehicles: Vec<(VehicleState, Option<u64> /* heartbeat age ms */)>,
    pub link: LinkStatsSnapshot,
    pub cameras: Vec<(CameraProfile, Option<CameraSnapshot>)>,
    pub video: Vec<(SysId, VideoSourceStatus)>,
    pub media: MediaServer, pub clients: Vec<ClientSession>,
}
pub fn assemble(i: &NetworkInputs) -> NetworkTopology;            // pure
pub async fn collect(app: &AppState) -> NetworkTopology;         // gathers, one lock at a time
pub async fn run_status(app: AppState, period: Duration);         // 1 Hz broadcast
pub fn redact_url(url: &str) -> String;                           // strips user:pass@
// media_probe.rs
#[derive(Clone, Default)]
pub struct MediaProbe { url: Arc<StdMutex<String>>, reachable: Arc<StdMutex<Option<bool>>> }
impl MediaProbe {
    pub fn spawn(&self, whep_upstream: &str);                     // probe every 5 s
    pub fn status(&self) -> MediaServer;                          // redacted url + reachable
}
pub async fn probe_once(url: &str, timeout: Duration) -> bool;  // TCP connect host:port
// network_api.rs
pub async fn get(State(app): State<AppState>, AuthUser(_op): AuthUser) -> Response;   // ok(collect(&app).await)
```

- [ ] **Step 1: Write failing tests:**
  - `network.rs` (pure `assemble`, fixture `inputs()` = vehicle sysid 1 `UAV-01` copter link `Ok` hb age 400; link stats with components (1, 1) AP 30.0 msg/s, (1, 100) CAM 2.0 msg/s, (255, 190) GCS; MT11 profile `192.168.144.25:37260` with snapshot `connected: true`; video `mt11` `probe_ok: true`, `whep_path "mt11"`; 2 clients):
    - `vehicle_gets_its_components_and_camera`:
      - `vehicles[0].components` compids `[1, 100]`;
      - `camera == Some(CameraLink { kind: SiyiMt11, transport: TcpUdp, endpoint: "192.168.144.25:37260", connected: true, .. })`;
      - `video.unwrap().probe_ok`;
      - `heartbeat_age_ms == Some(400)`;
      - `link_id == "link0"`.
    - `mavlink_camera_is_via_fc`: profile kind `Mavlink`, `comp_id 100` → `transport ViaFc`, `endpoint "FC · compid 100"`.
    - `kind_none_has_no_camera`: profile kind `None` → `camera None`.
    - `non_vehicle_system_only_in_link`: sysid 255 → in `links[0].systems` with `vehicle false`, not in `vehicles`.
    - `link_fields_from_config_and_stats`:
      - `mavlink_url "tcp:127.0.0.1:5760"` → `links[0].kind Tcp`, `url "tcp:127.0.0.1:5760"`;
      - `"udpin:0.0.0.0:14550"` → `Udpin`;
      - `"/dev/ttyAMA0,921600"` → `Serial`.
    - `server_node_fields`: `role "standalone"`, `listen "127.0.0.1:8110"`, `uptime_s 42`, `version == env!("CARGO_PKG_VERSION")`.
    - `unconfigured_is_the_standalone_list`: `== UNCONFIGURED_STANDALONE.to_vec()`.
    - `redact_url_strips_userinfo`: `"http://u:p@10.0.0.2:8889/mt11/whep"` → `"http://10.0.0.2:8889/mt11/whep"`; an unparsable string passes through unchanged.
  - `media_probe.rs`:
    - `probe_reaches_listener`: a bound `TcpListener` on `127.0.0.1:0` → `probe_once("http://127.0.0.1:<port>/mt11/whep", 1s) == true`;
    - `probe_fails_on_closed_port`: bind, read the port, drop the listener → `false`;
    - `status_before_first_probe_is_none`: `MediaProbe::default().status().reachable == None`.
  - `apps/rgcs-server/tests/network_api.rs`:
    - `get_network_requires_login`: no cookie → 401.
    - `get_network_returns_topology`: logged in → 200, JSON `data.server.role == "standalone"`, `data.links[0].id == "link0"`, `data.unconfigured` has 6 entries.
    - `status_broadcasts_every_second` (`#[tokio::test(start_paused = true)]`): subscribe to `state.tx`, spawn `run_status(state, 1s)`, advance 2 100 ms → 2 frames with `t == "network_status"` (the first at t = 1 000 ms).
- [ ] **Step 2:** `cargo test -p rgcs-server network media_probe` and `--test network_api`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `collect`:
    - `router.lock().await.states()` and `message_age_ms(sysid, 0)`, with the lock dropped before the next await;
    - `link_stats.snapshot(link_stats.now_ms())`;
    - for each `store.camera_profile_sysids()` → `store.camera_profile(sysid)` + `cameras.snapshot()` matched by sysid;
    - `video.snapshot()`, `media.status()`, `sessions.list()`.
  - `run_status`: `tokio::time::interval(period)` with `MissedTickBehavior::Skip`; skip the tick when `app.tx.receiver_count() == 0`; `let _ = app.tx.send(..)`.
  - Firmware string: `firmware.camera` when non-empty.
- [ ] **Step 4:** `cargo test -p rgcs-server` → PASS. clippy.
- [ ] **Step 5:** commit `feat(server): network topology API and 1 Hz network_status`.

### Task 5: UI data, strings, nav, route

**Files:**
- Create:
  - `apps/rgcs-server/ui/src/features/network/api.ts`;
  - `apps/rgcs-server/ui/src/features/network/useNetwork.ts`;
  - `apps/rgcs-server/ui/src/shared/i18n/network.ts`;
  - `apps/rgcs-server/ui/src/styles/network.css`;
  - `apps/rgcs-server/ui/src/features/network/NetworkView.tsx` (a skeleton here; filled in Tasks 6–7).
- Modify:
  - `app/view.ts` (`ENABLED_VIEWS` adds `'network'`);
  - `app/Nav.test.tsx`;
  - `features/vehicles/reducer.ts` + `reducer.test.ts` (`network`);
  - `shared/i18n/index.ts` (merge `networkJa` / `networkEn`);
  - `app/Shell.tsx`: when `view === 'network'`, render `<main className="stage net" style={{ position: 'absolute', inset: 0 }}><NetworkView …/>{logDock}</main>` and hide the map stage the same way `mission` does;
  - `main.tsx` (`import './styles/network.css'`);
  - `shared/ui/icons.tsx` (`IconServer`, `IconRouter`, `IconLaptop`, `IconGlobe`, `IconCpu`, `IconRadioTower`, `IconScan`, `IconCable` from lucide-react).

**Interfaces — Produces:**
```ts
// api.ts
export function fetchNetwork(): Promise<NetworkTopology>   // apiFetch('/api/network')
// reducer.ts
readonly network: NetworkTopology | null                   // initialState: null
case 'network_status': return { ...state, network: msg.topology }
// useNetwork.ts — GET once on mount, then the reducer's WS value wins when newer (at_unix_ms)
export function useNetwork(ws: NetworkTopology | null): { readonly topology: NetworkTopology | null; readonly error: string | null }
// network.ts — keys (ja shown; en mirrors, typed Record<keyof typeof networkJa, string>)
netTitle 'ネットワーク', netSummary '{links} リンク · {vehicles} 機体 · {warn} 警告 · {clients} クライアント',
netInet 'インターネット', netDirect '直接波', netRtc 'WS / WebRTC', netRtcm 'RTCM', netZoneSite '現場 · 直接',
netZoneInet 'インターネット', netZoneCloud 'クラウド', netUsersRemote 'ユーザー（遠隔）', netExternal '外部サービス',
netFieldOp '地上操作', netWsLocal 'WS（ローカル）', netUnconfigured '未構成', netServerSub 'スタンドアロン',
netHub 'RGCS Hub', netGateway 'メッシュ GW', netUplink '上り回線', netNode 'rgcs-node', netNtrip 'NTRIP caster',
netRemoteUsers '遠隔ユーザー', netFit '全体表示', netHint 'ドラッグで移動 · ホイール / ピンチで拡大縮小 · ダブルクリックで拡大',
netNoCamera 'カメラなし', netViaFc 'FC 経由', netConnected '接続', netDisconnected '未接続', netLost '通信断',
netRoute '経路', netVia '通信経路', netMavDirect 'MAVLink 直結', netCloudRoute 'クラウド経路', netNoHub '未構成（Hub なし）',
netComponents 'コンポーネント', netRxEst '受信 (推定)', netLoss 'ロス', netLastRx '最終受信', netHeartbeat 'ハートビート',
netSince '接続から', netReconnects '再接続', netUptime '稼働時間', netListen '待受', netRole '役割', netVersion '版',
netClients 'クライアント', netBrowser 'ブラウザ', netAddr 'アドレス', netMedia '映像サーバー', netReachable '到達可',
netUnreachable '到達不可', netChecking '確認中', netVideo '映像', netSystems 'システム', netSeeInspector '詳細は MAVLink インスペクター',
netNoteM5 'クラウド Hub・LTE・メッシュ・GW・NTRIP は M5 で構成します。この画面は現在のスタンドアロン構成を実データで表示します。',
netLoading 'ネットワーク情報を取得中', netLoadFailed 'ネットワーク情報を取得できません'
```

- [ ] **Step 1: Write failing tests:**
  - `Nav.test.tsx` `network_is_enabled`: the network button has no `aria-disabled`, and clicking it calls `onView('network')`.
  - `reducer.test.ts` `network_status_replaces_topology`: `reduce(initialState, { t: 'network_status', topology: T1 }).network === T1`, then T2 replaces it; the other slices are referentially unchanged.
  - `useNetwork.test.ts`:
    - the fetch resolves `at_unix_ms 1000` and the ws prop is null → `topology.at_unix_ms === 1000`;
    - rerender with ws `at_unix_ms 2000` → 2000;
    - rerender with ws 500 (stale) → still 2000;
    - a fetch reject → `error === 'ネットワーク情報を取得できません'` key `netLoadFailed`, mapped by the caller.
  - `lang.test.ts` (existing key-parity test): it fails until `networkEn` mirrors every key.
- [ ] **Step 2:** `npx vitest run src/app/Nav.test.tsx src/features/vehicles/reducer.test.ts src/features/network/useNetwork.test.ts src/shared/i18n/lang.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `styles/network.css`:
    - `.nn.ph .card { stroke-dasharray: 4 4; fill: rgba(255,255,255,.02) }`;
    - `.nn.ph, .npl.ph, .ne.ph { opacity: .45 }`;
    - `.ne.ph .flow { display: none }`;
    - `.ne.ph .base { stroke-dasharray: 3 5 }`.
  - These selectors only add to the prototype classes; `prototype.css` is never edited.
- [ ] **Step 4:** the same vitest command → PASS. tsc clean.
- [ ] **Step 5:** commit `feat(ui): enable the network view with live topology data`.

### Task 6: Canvas — graph, layout, relations, pan / zoom / LOD

**Files:**
- Create (all under `apps/rgcs-server/ui/src/features/network/`):
  - `graph.ts` + `graph.test.ts`;
  - `layout.ts` + `layout.test.ts`;
  - `relations.ts` + `relations.test.ts`;
  - `viewport.ts` + `viewport.test.ts`;
  - `NetworkCanvas.tsx` + `NetworkCanvas.test.tsx`;
  - `svgParts.tsx` (card / pill / edge / zone renderers, a port of `netKit`, `netCard`, `netVehicle`, `netZone`).

**Interfaces — Produces:**
```ts
// graph.ts — ids: 'server', 'link:<id>', 'v:<sysid>', 'r:<sysid>' (dot), 'e:v:<sysid>' (vehicle→server edge),
// 'ws' (WS pill), 'c:<id>' (client), 'e:c:<id>', 'media', and placeholders 'ph:hub', 'ph:lte:<sysid>' | 'ph:lte',
// 'e:ph:lte:<sysid>', 'ph:gw', 'ph:uplink', 'ph:users', 'ph:ntrip'
export type NetStatus = 'ok' | 'warn'
export interface NetGraph { readonly vehicles: readonly NetVehicle[]; readonly clients: readonly ClientSession[];
  readonly link: MavLinkInfo | null; readonly status: ReadonlyMap<string, NetStatus>; readonly warnCount: number }
export function toGraph(t: NetworkTopology): NetGraph
export function vehicleStatus(v: NetVehicle): NetStatus           // warn ⇔ link !== 'ok'
export function linkStatus(l: MavLinkInfo): NetStatus             // warn ⇔ !connected || loss_pct > 3
export function compLine(v: NetVehicle): string                   // 'FC · AP 1 · CAM 100 · GMB 154' | 'FC · —'
// layout.ts
export interface NetLayout { readonly pos: ReadonlyMap<number, readonly [number, number]>; readonly cols: number;
  readonly rows: number; readonly vx: number; readonly gwY: number; readonly zone: Rect; readonly W: number;
  readonly H: number; readonly S: number; readonly IX: number; readonly IW: number; readonly HX: number;
  readonly HW: number; readonly HH: number; readonly HY: number; readonly UX: number }
export const RH = 77, CWD = 306, VW = 236, VH = 70
export function layoutNetwork(g: NetGraph): NetLayout   // clients extend the zone: h = rows·RH + 192 + max(0, clients − 1)·58 + 70 (GW placeholder)
// viewport.ts
export interface View { readonly k: number; readonly tx: number; readonly ty: number }
export type Lod = 'full' | 'compact' | 'site'
export function lodFor(k: number): Lod
export function fitView(cw: number, ch: number, W: number, H: number): View
export function zoomAt(v: View, f: number, px: number, py: number): View   // clamp 0.06–2.5, cursor-anchored
export function panBy(v: View, dx: number, dy: number): View
// relations.ts
export function related(sel: string, g: NetGraph): ReadonlySet<string> | null   // null = nothing dimmed ('server')
// NetworkCanvas.tsx
export function NetworkCanvas(props: { readonly graph: NetGraph; readonly selected: string;
  readonly onSelect: (id: string) => void; readonly dict: Dict }): React.ReactElement
```

- [ ] **Step 1: Write failing tests:**
  - `graph.test.ts`:
    - `compLine`: components AP 1, CAM 100, GMB 154 → `'FC · AP 1 · CAM 100 · GMB 154'`; none → `'FC · —'`;
    - `vehicleStatus`: link `'delay'` → `'warn'`, `'ok'` → `'ok'`;
    - `linkStatus`: loss 3.0 → `'ok'`, 3.01 → `'warn'`, disconnected → `'warn'`;
    - `warnCount` for 2 vehicles (`ok`, `lost`) and a healthy link → 1.
  - `layout.test.ts`:
    - 1 vehicle → `pos.get(1)` `[176, 62]`, `cols 1`, `gwY 62 + 77 + 6 = 145`;
    - 9 vehicles → `cols 2`, `vx 150`, the 9th at `[456, 62]`, `rows 8`;
    - `S === 1` for 1 vehicle.
  - `viewport.test.ts`:
    - `lodFor(0.55) 'full'`, `lodFor(0.5499) 'compact'`, `lodFor(0.28) 'compact'`, `lodFor(0.2799) 'site'`;
    - `zoomAt({k: 2.4, tx: 0, ty: 0}, 1.25, 100, 100).k === 2.5`;
    - `zoomAt({k: 0.07, …}, 0.8, …).k === 0.06`;
    - the cursor stays anchored: `zoomAt({k: 1, tx: 0, ty: 0}, 2, 100, 50)` → `{k: 2, tx: −100, ty: −50}`;
    - `fitView(1000, 600, 2000, 800).k === 0.485` (`min(1.2, 0.5, 0.75) × 0.97`).
  - `relations.test.ts` (2 vehicles, 2 clients):
    - `related('server')` → `null`;
    - `related('v:1')` ⊇ `{'v:1', 'r:1', 'e:v:1', 'link:link0', 'server', 'ws', 'c:1', 'c:2', 'e:c:1', 'e:c:2'}` and excludes `'v:2'`;
    - `related('c:1')` ⊇ `{'c:1', 'e:c:1', 'ws', 'server', 'link:link0', 'e:v:1', 'e:v:2', 'v:1', 'v:2'}`;
    - `related('ph:hub')` ⊇ `{'ph:hub', 'ph:lte:1', 'e:ph:lte:1', 'ph:uplink', 'ph:users', 'ph:ntrip'}`.
  - `NetworkCanvas.test.tsx` (jsdom; `clientWidth` / `clientHeight` stubbed to 1000 × 600):
    - it renders `g.nn[data-id="v:1"]` with the text `UAV-01`, `SYSID 1` and `FC · AP 1 · CAM 100`;
    - `g.nn.ph[data-id="ph:hub"]` contains `未構成`;
    - clicking `v:1` calls `onSelect('v:1')`;
    - clicking the svg background calls `onSelect('server')`;
    - pointerdown + pointermove of 10 px + pointerup + click → `onSelect` is not called (a drag is not a click);
    - with `selected 'v:1'`, `g[data-id="v:2"]` has class `dim`;
    - clicking the `+` button changes `.netctl .z` from the fit % to round(k × 1.25 × 100) %;
    - a `wheel` with `ctrlKey` and `deltaY: −100` zooms in.
- [ ] **Step 2:** `npx vitest run src/features/network`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Port the prototype functions named above. Pills scale by `S`. The site LOD draws coloured tiles plus the site summary card (`site:A`, selectable → server).
  - The wheel handler is a non-passive listener added in `useEffect`, because React's `onWheel` is passive. A trackpad pans and a mouse or Ctrl+wheel zooms, using the prototype's `mouse` heuristic.
  - The view transform lives in a `useRef` + state for re-render. Fit runs on mount and when the vehicle set changes (sysid list key).
  - Icons are drawn as `<svg x y width height>` wrappers around the Lucide components.
- [ ] **Step 4:** `npx vitest run src/features/network` → PASS. tsc clean.
- [ ] **Step 5:** commit `feat(ui): network canvas with pan, zoom, LOD and selection`.

### Task 7: Inspector panel and view assembly

**Files:**
- Create (all under `apps/rgcs-server/ui/src/features/network/`):
  - `inspect.ts` + `inspect.test.ts`;
  - `NetworkInspector.tsx`;
  - `NetworkView.test.tsx`.
- Modify: `NetworkView.tsx` (the `.float.top1.netwrap` section with the `.netbar` (`.h1` title, summary `.t3.num`, `.grow`, four `.lg` legend entries) + `.netmap.g` canvas, and the `aside.g.panel.float.float-r` inspector).

**Interfaces — Produces:**
```ts
export interface KvRow { readonly k: string; readonly v: string; readonly cls?: 'warn' | 'ok' | 'dim' }
export interface Table { readonly title: string; readonly cols: string; readonly head: readonly string[];
  readonly rows: readonly (readonly { readonly v: string; readonly cls?: string }[])[] }
export interface Inspection { readonly icon: 'server' | 'cable' | 'copter' | 'rover' | 'laptop' | 'router' | 'globe' |
  'radio-tower' | 'video'; readonly title: string; readonly sub: string; readonly kv: readonly KvRow[];
  readonly tables: readonly Table[]; readonly note?: string }
export function inspect(sel: string, t: NetworkTopology, dict: Dict, now: number): Inspection
export function fmtRate(n: number): string        // 9.96 → '10.0', 0 → '0.0'
export function fmtBytes(bps: number): string     // 210 → '210 B/s', 2048 → '2.0 KB/s', 1_500_000 → '1.4 MB/s'
export function fmtAge(ms: number | null): string // null → '—', 400 → '0.4 s', 65_000 → '1 分 5 秒' (ja) / '1 min 5 s' (en)
export function summary(t: NetworkTopology, dict: Dict): string
```

- [ ] **Step 1: Write failing tests** (`inspect.test.ts`, fixture = the Task 4 shape in TS, ja dict):
  - `server`:
    - title `rgcs-server`, sub `スタンドアロン`;
    - kv includes `版 0.1.0 (dev)`, `待受 127.0.0.1:8110`, `役割 standalone`, `稼働時間 42 s`;
    - a `クライアント` table with rows `admin | admin | 127.0.0.1:51000 | Chrome`;
    - a `映像サーバー` kv `http://127.0.0.1:8889/mt11/whep · 到達可`.
  - `v:1`:
    - title `UAV-01`, sub `Copter · SYSID 1`;
    - kv `経路` = `UAV-01 → MAVLink (tcp:127.0.0.1:5760) → rgcs-server → クライアント 2`;
    - `通信経路 MAVLink 直結`;
    - `クラウド経路 未構成（Hub なし）` with `cls 'dim'`;
    - `ハートビート 0.4 s`;
    - `rgcs-node 未構成`.
    - The `コンポーネント` table head is `['COMPID', '種類', 'msg/s', 'ロス', '最終受信']`, row 1 is `['1', 'AP', '30.0', '0.0 %', '0.1 s']`.
    - Camera kv `MT11 · 192.168.144.25:37260 · 接続`; video kv `mt11 · RTSP OK · /mt11`.
  - A `v:1` with link `lost` → the route kv has `cls 'warn'` and the status kv reads `通信断`.
  - `link:link0`:
    - kv `受信 (推定)` = `32.0 msg/s · 1.4 KB/s` (fixture link `rx_msgs_per_s 32`, `rx_bytes_per_s 1434`), `ロス 0.0 %`, `再接続 0`;
    - a `システム` table listing sysid 1 (機体) and 255 (GCS 190);
    - note `詳細は MAVLink インスペクター`.
  - `c:1`: title `admin`, sub `admin · Chrome`, kv `アドレス 127.0.0.1:51000`, `接続から` formatted with `fmtAge(now − since)`.
  - `ph:hub` / `ph:lte:1` / `ph:gw` / `ph:ntrip`: the title is the element name, kv `状態 未構成` with `cls 'dim'`, `note === dict.netNoteM5`.
  - Formatting:
    - `fmtBytes(210) '210 B/s'`, `fmtBytes(2048) '2.0 KB/s'`;
    - `fmtRate(9.96) '10.0'` (not 9.95: JS `toFixed(1)` gives `'9.9'` there);
    - `summary` for 1 link, 2 vehicles (1 lost), 2 clients → `'1 リンク · 2 機体 · 1 警告 · 2 クライアント'`.
  - `NetworkView.test.tsx`:
    - with a topology prop it renders `.netbar .h1` 「ネットワーク」, the summary text, and four `.lg` entries;
    - the default panel title is `rgcs-server`;
    - clicking `g[data-id="v:1"]` → the panel title becomes `UAV-01`;
    - with `topology null` and no error → 「ネットワーク情報を取得中」.
- [ ] **Step 2:** `npx vitest run src/features/network`. Expected: FAIL.
- [ ] **Step 3: Implement.** The panel markup follows the prototype lines 711–725:
  - `.panel-h` with the 34 px icon tile, `.h1.ell` title and `.t3.ell` sub;
  - `.kv` rows;
  - `.ntable` with `grid-template-columns: tb.cols` and `th` / `mono` / `warn` / `dim` cells;
  - the note `.t3` at 12 px.
  - Values refresh at 1 Hz with the WS frame. `netSel` survives refreshes; a selected id that disappears (vehicle gone, client closed) falls back to `server`.
- [ ] **Step 4:** `npx vitest run` (the whole UI suite) → PASS. tsc clean.
- [ ] **Step 5:** commit `feat(ui): network inspector panel and view`.

### Task 8: Docs, full checks, headless visual check on a scratch stack

**Files:**
- Modify:
  - `docs/spec/80-network.md`:
    - header 状態: add 「§4 は 2026-10-23 にスタンドアロン分を実装」;
    - §4: mark 実装 (2026-10-23) and list what is real (server, link stats, vehicles + components, camera link, video path, MediaMTX reachability, WS clients) versus 未構成 (Hub, LTE, mesh, GW, NTRIP, rgcs-node, sites, users, external, `route` / `local_route`), with rulings 1–4 and 7;
    - §6 is unchanged.
  - `docs/spec/10-screens.md`:
    - §8: append 「(2026-10-23 実装)」 with the placement (ruling 9), vehicle line 3 (ruling 10), the default selection `server` (ruling 11), warn colours (ruling 12), and the dropped preview toggle;
    - the P7 note: 「ネットワーク画面は無効のまま」 → enabled with a standalone topology;
    - §9: `netSel` default `server`.
  - `docs/spec/50-api.md`:
    - §2.8: `GET /api/network` implemented, with the field list;
    - §3: `network_status` = `{topology: NetworkTopology}` full at 1 Hz (ruling 2).
- [ ] **Step 1: Docs** as listed.
- [ ] **Step 2: Full checks.**
  - `cargo test --workspace`.
  - `cargo clippy --workspace --all-targets -- -D warnings`.
  - `npx tsc --noEmit -p tsconfig.app.json`.
  - `npx vitest run`.
- [ ] **Step 3: Headless visual check on a scratch stack only.**
  - **Hard rules.**
    - Never touch ports 5760-5793 / 8000 / 5173 / 14550 / 14551 / 37260.
    - Record every PID with `$!` and stop only those PIDs.
    - Work in a fresh scratchpad directory `$S`, which is SITL's cwd.
  1. Start SITL from `$S` with `run_in_background`: `~/github/rtos/ardupilot-latest/build/sitl/bin/arducopter --model + --speedup 1 --defaults ~/github/rtos/ardupilot-latest/Tools/autotest/default_params/copter.parm --home 36.2509,137.6385,1505,0 -I6 -w`. Record the PID. It listens on tcp:5820.
  2. Scratch `$S/config.toml`: `listen = "127.0.0.1:8110"`, `mavlink_url = "tcp:127.0.0.1:5820"`, `data_dir = "$S/data"`. Then `cargo build -p rgcs-server`, start `RGCS_CONFIG=$S/config.toml ./target/debug/rgcs-server` with `run_in_background`, and record the PID.
  3. From `apps/rgcs-server/ui`, start `RGCS_SERVER=http://127.0.0.1:8110 npx vite --port 5181 --strictPort` with `run_in_background` and record the PID.
  4. Log in by curl (`admin` / `admin`, header `X-Requested-With: rgcs`). Then `PUT /api/vehicles/1/camera/profile {kind: "siyi_mt11", host: "127.0.0.1", port: 37299}` (an unused port, so the camera shows 未接続 honestly). After 15 s, `GET /api/network` must show:
     - `links[0].connected true`;
     - `rx_msgs_per_s > 10`;
     - `loss_pct == 0`;
     - `vehicles[0].components[0] == {compid: 1, kind: 'autopilot', …}`;
     - `camera.connected false`;
     - `clients` = the browser session(s) once Playwright connects.
  5. Write `$S/shot.cjs` with Playwright from the UI's `node_modules`, headless chromium, viewport 1440 × 813:
     - log in at `http://127.0.0.1:5181`, click the 4th nav button and wait for `g.nn[data-id="v:1"]`;
     - screenshot `$S/net_default.png`;
     - click `v:1` → `$S/net_route.png`;
     - click `c:1` → `$S/net_client.png`;
     - press `−` 3 times → `$S/net_compact.png`, and 3 more → `$S/net_site.png`.
     - Assertions in the script:
       - nav button 4 has no `aria-disabled`;
       - the panel title is `rgcs-server`, then `UAV-01`;
       - in `net_route`, `g[data-id="ph:hub"]` has class `dim`;
       - the client card text contains `127.0.0.1:`;
       - `document.scrollingElement.scrollHeight <= 813` (no page scroll);
       - the WS frame count of `network_status` over 3 s is 3 ± 1.
  6. Compare with the Read tool side by side:
     - `net_default.png` ↔ `design_base/screenshots/glass_network.png`;
     - `net_route.png` ↔ `glass_network_route.png`;
     - `net_client.png` ↔ `glass_network_field.png`;
     - `net_compact.png` ↔ `glass_network_100_compact.png`;
     - `net_site.png` ↔ `glass_network_100_sites.png`.
     - Check zones, card sizes, pill style, the dimming, the panel structure and the `.netctl` position. Fix deviations in `features/network/*` or `styles/network.css` (never `prototype.css`), then re-shoot.
  7. Stop the Vite, server and SITL PIDs (`kill <pid>`), then delete `$S`.
- [ ] **Step 4:** commit `docs: network view implemented for the standalone topology`.

## Out of scope
- RGCS Hub (AWS IoT Core, Cognito, MQTT topics, Device Shadow), accounts / roles beyond the WS session list, and offline accounts in the account table.
- LTE modem state, mesh radio SNR / neighbours / BFS routes (`netLocal`), mesh GW and its uplink, LTE↔mesh failover, multi-site layout data, and the 100-vehicle preview data.
- `rgcs-node` (mavlink-router endpoints table, node IP / version) and NTRIP / RTCM injection.
- Remote WebRTC users, TURN, and presentation (`/present`) viewers or WHEP-only sessions in the client list.
- More than one MAVLink link, TX statistics, round-trip latency / ping, and MAVLink signing stats.
- Editing network settings from this screen (the link URL stays in `config.toml` / settings), and `X-Forwarded-For` / proxy-aware client addresses.
- 80 §6 undecided items and the 80 §7 M5 acceptance tests.
