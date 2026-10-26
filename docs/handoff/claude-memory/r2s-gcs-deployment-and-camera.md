---
name: r2s-gcs-deployment-and-camera
description: "RGCS product decisions (2026-10-16): Pi-on-vehicle server + browser UI first, MT11 Python app ported to Rust inside the GCS, login = operator (mock admin/admin), and the user's preference to see the integrated UI before any spec/plan docs"
metadata:
  node_type: memory
  type: project
  originSessionId: 5a4b6162-b5ce-40b6-b6f1-3483059b450e
  modified: 2026-10-16T09:35:10.686Z
---

Decisions the user made on 2026-10-16 (AskUserQuestion answers + follow-up messages):
- **Deployment**: the GCS backend runs on the companion Raspberry Pi *on the vehicle* (same Pi as the existing `siyi-mt11-cameracontrol` Python app, next to Rpanion-server and MediaMTX) and is used from a browser over LAN/LTE. Standalone release (1 Pi = 1 vehicle) ships first; a cloud version later aggregates the same backend (edge → hub). Tauri desktop is deferred.
- **Deployment (user, 2026-10-18)**: one topology — standalone is *not* a separate mode, just the multi-vehicle setup with a single vehicle connected. Topology: a *node* edition on each vehicle Pi + the **RGCS Hub in the cloud** that owns accounts/users/roles, modelled on **AWS IoT Core** (Thing + X.509 per vehicle, MQTT topics, Device Shadow). **Vehicle-to-vehicle mesh networking must be supported** (relay through neighbours to a ground gateway). This replaces the earlier "ground hub PC" idea. Users get video + telemetry over **WebRTC**; **Mission Planner connectivity is out of scope for now** (not shown). Network map conventions: vehicle and its node drawn as one block; routes split into direct radio vs internet; cloud hub drawn conceptually. On-site (ground) operation must also be shown: a field PC on the mesh-gateway LAN operates vehicles over direct radio without the internet.
- **MT11 integration**: port the Python app (`/Users/tsuyoshi/github/rtos/siyi-mt11-cameracontrol`) to Rust inside the GCS (`rgcs-camera` crate, `Camera` trait + capability struct; drivers SiyiMt11 / MavlinkCamera / None). The Python tests are the oracle. UI hides capabilities a camera lacks (never "disabled").
- **Login**: mock login screen, username `admin` / password `admin`; the logged-in user *is* the operator recorded in the audit log. The old "オペレータ登録" modal is removed.
- **Joystick**: attached to the operator's PC, so it is read with the browser Gamepad API and sent to the Pi over WebSocket (20 Hz gimbal rate); `gilrs` is not applicable.
- The Glass prototype (`design_base/project/RGCS Prototype Glass.dc.html`) is the adopted design; the original prototype is frozen.

**Why:** the first customer deployment is a single vehicle with an MT11 camera already served by the Python app; the user wants one Rust service to replace it, then scale to cloud.

**How to apply:** when I propose work that mixes UI design and documentation, the user said "先にジンバルカメラ操作が … インテグレーションされたUIを確認したい": **show the integrated UI (prototype + screenshots) first, write spec/plan docs only after they have reviewed it.** The spec now lives in the repo: `docs/spec/00..70-*.md` + `docs/spec/ranges.json` (validation ranges shared by Rust and zod) and `docs/plan/implementation-plan.md` (commit `7af58c5`, 2026-10-16). Update those files, not the plan file, when decisions change; next step is M1 week 1 (workspace + cross-build CI + rgcs-core types). See [[r2s-gcs-glass-design-tokens]] and [[r2s-gcs-design-base-prototype]].
