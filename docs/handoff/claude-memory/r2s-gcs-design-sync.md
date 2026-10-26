---
name: r2s-gcs-design-sync
description: How the RGCS UI stays faithful to the Glass prototype after the 2026-10-18 design sync (sync-css script, prototype class names, screenshot comparison workflow) and the user's decisions
metadata:
  type: project
---

On 2026-10-18 the user said the implementation "微妙にデザインがあっていない" and asked for it to match the Glass prototype before moving on; decision: **follow the design as-is, keep only a dot for the server link in the header** (no text chip).

How it is kept in sync now (branch `design-sync`, commits a217f29 / 99b4158 / b8c7645):
- `scripts/sync-css.py` extracts the prototype's `<style>` verbatim into `apps/rgcs-server/ui/src/styles/prototype.css` (generated, never hand-edited); `app.css` holds only app-specific layout; `tokens.css` / `components.css` are gone.
- Components use the prototype's class names and inline-style values (spec 20 §5): `.vrow` / `.wrow` / `.wbadge` / `.rg-wp` / `.rg-mid` / `.form` / `.kv` / `.inset` / `.cmd-btn` / `.seg.n5` icon nav / `.tile-btn` icons, line icons in `shared/ui/icons.tsx`.
- Visual check workflow: screenshot the running dev stack with Playwright at 1440×813 (the design PNGs' size) in the same states as `design_base/screenshots/glass_*.png`, write `.dev/design-sync/compare.html` with side-by-side pairs, view both with the Read tool and list diffs. The throwaway script lived in the scratchpad (copy it into the ui dir to resolve `playwright`).
- Copy decisions: command labels are the design's Japanese (アーム / ディスアーム / 帰還), arm/disarm/camera/other sit under 機体・ペイロード, mission command / field names come from the prototype's `wpCmd` / `fields` tables (`wp_<KEY>` / `fld_<key>` i18n keys), 「ファイルに保存」 writes `.waypoints`, `.rgcsmission` is a small secondary button.

**Why:** the user approves screens against the Glass prototype; approximating from the spec text produced visible drift (nav, login, camera strip, mission panels).

**How to apply:** for every new screen (P4 params, P5 checklists/logbook) copy the prototype's markup/classes for that view first, re-run `scripts/sync-css.py` if the prototype changed, and finish with the screenshot comparison before asking the user to review. See [[r2s-gcs-glass-design-tokens]], [[r2s-gcs-mission-ui-conventions]].
