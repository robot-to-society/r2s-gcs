---
name: r2s-gcs-design-polish
description: "Glass prototype polish round (2026-10-18) on worktree ../r2s-gcs-design, branch design-polish — Lucide sprite, marker/message/log redesign, pending user review"
metadata:
  node_type: memory
  type: project
  originSessionId: b60f0b35-82a8-4b96-bf78-56c6215ac71a
  modified: 2026-10-18T11:54:56.810Z
---

Started 2026-10-18 in parallel with P6 (P6 runs in the main checkout on `p6-deploy`; design work lives in worktree `../r2s-gcs-design`, branch `design-polish`, only `design_base/` touched). First commit 5b38e4a.

User feedback that drove it: glass text unreadable over bright map; unsure the per-message read checkbox is needed; rover icon didn't read as a rover; map icons hard to see; wants globally understood icons (incl. maintenance); asked what happens when footer messages pile up.

User adopted the first round on 2026-10-18 (「採用」). Second round: gimbal FOV fan on markers (`.vmk .fov`, `poseMarkers()`, `CAM_HFOV`) and explicit layer order via `orderLayers()` — user-specified order: map < DSM < mission path < flight trails < vehicle icons (heading + gimbal direction).

Third round: 3D camera frustum (`camRays()` marches corner rays against groundElev, `updateCamFrustum()`, `cam-air3d` AirPathLayer + `cam-foot` fill); 2D fan and sight line hidden in 3D. User then decided: gimbal shows direction only by default (120 m cone, pitch up allowed); ground projection/footprint only when アプリ設定 › 地図表示 › ジンバルを地面に投影 (`state.camProject`) is on. Video-mode seg moved onto the detail feed to stop the camera strip overflowing.

Fourth round (62a919b, then network commit): translucent image plane at the frustum tip (`AirPlaneLayer`, shared `airFoldMatrix`), projected mode drapes it as the footprint. New ネットワーク view draft (`view:'network'`, `renderNet()` builds SVG into `netRef`, `netInspector()` feeds the right panel; mock `NET_VEH/NET_TERM/NET_INET`) — reworked into standalone / multi-vehicle cloud modes with vehicle mesh (`netMode`, `netSvgCloud/netSvgStandalone`, `netRoute`, `NET_MESH`); see [[r2s-gcs-deployment-and-camera]]. Later: single topology + field PC route, then an infinite canvas (user: no scrolling, Canva-like) with semantic zoom (`netLod`: full/compact/site), multi-site layout (`netLayout`, `netSiteSvg`), BFS routes (`netLocal`), 100-vehicle preview fleet (`netDemoFleet`, state `netDemo`). User adopted the whole network view on 2026-10-18 (f0416b9) and asked to treat it as the latest design: `main` fast-forwarded to f0416b9 (p6-deploy still branches from 974c016; merge, design_base only). Further design tweaks may follow on `design-polish`; reference screenshots retaken 2026-10-18 (a83e98b, main fast-forwarded): 32 glass_*.png incl. new ops_log / 3d_gimbal / network*, pre-Glass ones moved to screenshots/legacy/. Retake procedure: serve design_base/project on :8765, Playwright channel 'chrome', reset each shot to a base state and restore vehicle cameras (gimbal shots mutate UAV-03); spec updated 2026-10-18 (8e664a9, main fast-forwarded): 00/10/20/40/50/60/70 + new 80-network.md; 30-architecture §7 (--role) deliberately left until P6 (which edits 30) is merged. Screenshots now regenerate with `node scripts/design-shots.cjs [--only x] [--out dir]` (needs ui node_modules + Google Chrome); open minors: site-LOD summary overlaps tiles, GW/field cards unreadable when zoomed out, optional minimap.

Decisions taken:
- Glass: `backdrop-filter … brightness(.6)` (.5 for g-strong), `--glass` alpha .62, text-3/4 lifted.
- Icons: one Lucide (ISC) sprite injected by the script (`ICON_SPRITE`, `<use href="#i-name">`, `ico(name,size)` helper for innerHTML markers) plus a custom `drone` symbol; `{{ x.icon }}` inside `href` binds fine in dc-runtime.
- Markers: `.vmk` disc (white ring) + rotating `.arrow` holding `.hd` caret; home is a separate `.rg-home` marker.
- Messages: log entries `{id,time,kind:info|ok|warn|error,src,key|text}`; only warn/error from a vehicle need a single 確認 (state `acks`); footer pill = latest entry + unread-warning badge → `.logsheet` history (all / warnings / per vehicle, keep 500).

**Why:** the user wants the prototype refined before it is synced into the app; app sync (scripts/sync-css.py, icons.tsx) waits until P6 is merged.

**How to apply:** continue edits in the worktree; screenshot harness lives in the scratchpad (`shoot.cjs`, run with NODE_PATH=<main>/apps/rgcs-server/ui/node_modules; 3D and mission map don't render with the bundled headless shell, but DO render with `chromium.launch({channel:'chrome',args:['--headless=new']})`). Related: [[r2s-gcs-glass-design-tokens]], [[r2s-gcs-design-sync]].
