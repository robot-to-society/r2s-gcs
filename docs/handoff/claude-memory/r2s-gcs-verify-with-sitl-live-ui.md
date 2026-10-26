---
name: r2s-gcs-verify-with-sitl-live-ui
description: User wants to verify RGCS changes by watching the real UI while SITL streams data, but implementation progress is the top priority; scripts/dev.sh launches the stack.
metadata:
  type: feedback
---

When the user does a manual check, they want ArduCopter SITL producing live data while the GCS UI runs, so they can see real telemetry moving in the browser. Implementation progress still comes first: this is a convenience, never a reason to slow the feature work.

**Why:** said on 2026-10-17 ("SITLでデータを出しながらGCSのUIが動きながら確認できるといいな。実装を進めることが最優先だけど").

**How to apply:** when a change is ready for the user to look at, start the stack with `scripts/dev.sh` (SITL on tcp:5760 + `rgcs-server` on :8000 + Vite HMR on :5173; `--built` serves `ui/dist` from the server, `--no-sitl` reuses a running SITL; runtime files in `.dev/`) and give the user the URL plus what to look at. Don't spend implementation time polishing the harness. SITL launch details and the stale-process pitfalls are in [[r2s-gcs-dev-environment]].
