---
name: r2s-gcs-design-base-prototype
description: design_base is a Claude Design handoff bundle (HTML prototype on the dc-runtime); how to edit and verify it headlessly
metadata:
  node_type: memory
  type: project
  originSessionId: 5a4b6162-b5ce-40b6-b6f1-3483059b450e
  modified: 2026-10-15T04:41:41.162Z
---

`design_base/project/RGCS Prototype.dc.html` is the primary design for the Rust+Tauri ArduPilot GCS (RGCS). It is a single-file React-based prototype rendered by `support.js` (dc-runtime: `sc-if`/`sc-for`/`{{ }}` templates, `renderVals()` supplies all bindings; `on*` attrs map to React events; controlled `<select value>` works). Mission planner commands live in the `CMDS` table (MAVLink id/name, field specs with param index, vehicle applicability) and altitude frames in `FRAMES` (REL/ABS/TER). Terrain/DSM enters only through `Component#groundElev`.

**Why:** The user is iterating on this prototype's fidelity (as of 2026-10-15) before implementing it in Rust/Tauri; knowing the runtime conventions avoids re-reading 150 KB each session.

**How to apply:** Edit the template + `renderVals` together. Verify with `node --check` on the extracted script and a headless smoke test; the Claude Chrome extension was not connected, but headless Google Chrome driven over CDP (`--headless=new --remote-debugging-port --use-angle=swiftshader`) against a local `python3 -m http.server` renders the page (3D canvas repaint is unreliable there, DOM/console checks are fine). Related: [[r2s-gcs-mission-ui-conventions]]
