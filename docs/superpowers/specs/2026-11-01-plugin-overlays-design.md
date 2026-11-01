# Plugins, stage 1: declarative overlays and links (design)

User request 2026-11-01: features should be addable as plugins, by dropping a folder in a fixed
format into a `plugins` directory, so that anyone can build things like the docomo LTE map
themselves. Stage 1 (this design) covers **manifest-only plugins**: no code, only a
`plugin.toml` that declares map overlays and links. Stage 2 (UI JavaScript plugins behind a
versioned host API) and stage 3 (server-side processes) come later and are out of scope here.

Decisions (user, 2026-11-01):
- Stage 1 first.
- The project license gets a plugin exception: an additional permission under AGPL-3.0 §7, in
  `LICENSE`.

What this design changes:
- It replaces the docomo-specific LTE overlay (design 2026-10-31-docomo-lte-overlay) with a
  generic engine. The docomo URL leaves the code and lives only in an internal plugin.
- This closes the OSS-prep item "remove `DEFAULT_LTE_TILE_URL`".

## Goals
- A plugin is a directory `<plugins_dir>/<id>/` holding a `plugin.toml`. It is read at server
  start. Nothing else needs to be installed or built.
- A plugin can declare:
  - raster tile overlays, either fetched ahead for chosen rectangles and served from the same
    origin (`cache = "area"`, today's LTE behaviour) or loaded by the browser from the source
    (`cache = "direct"`);
  - links shown in the layer menu.
- A broken plugin never stops the server. It is skipped and its error is shown in the plugin list.
- Plugin text is localized (en / ja / zh / ko) with an English fallback.
- No plugin can run code, send vehicle commands or write parameters.

## Plugin directory and loading
- Config: `plugins_dir` in `config.toml`, default `<data_dir>/plugins`. A missing directory
  means no plugins.
- At start, every direct subdirectory holding `plugin.toml` is read, in id order:
  - The manifest is capped at 64 KiB and parsed strictly (unknown keys are errors, so typos show).
  - The `id` must equal the directory name and match `^[a-z0-9][a-z0-9-]{0,39}$`.
- A plugin that fails to read or validate gets `status = "error"` and a short code: `parse`,
  `bad_id`, `id_mismatch`, `api_version`, `bad_url`, `bad_zoom`, `duplicate_overlay`,
  `too_large`, `no_en_text`. It is logged once at warn level, without URLs, and stays in the
  list.
- Loading only happens at start. Changing a plugin means restarting the server (no hot reload
  in stage 1).

## Manifest format (`api = 1`)

```toml
id = "docomo-lte"                 # = directory name
api = 1                           # manifest format version; other values → status error
version = "1.0.0"                 # the plugin's own version, free text ≤ 20 chars
name = { en = "docomo LTE area", ja = "ドコモ LTE エリア" }
description = { en = "...", ja = "..." }   # optional
author = "..."                    # optional, ≤ 80 chars
homepage = "https://..."          # optional, https only

[[overlay]]
id = "lte"                        # unique in the plugin, same id rule
name = { en = "docomo LTE area", ja = "ドコモ LTE エリア" }
tiles = "https://servicearea.nttdocomo.co.jp/map/1014/0000000000000000/{z}/{x}/{z}_{x}_{y}.gif"
cache = "area"                    # "area" | "direct"
format = "gif"                    # "gif" | "png" (checked on fetch for "area")
tile_size = 256                   # 256 | 512
min_zoom = 8                      # 0–22; "area" fetches min_zoom..=max_zoom
max_zoom = 14                     # MapLibre overzooms above
default_opacity = 60              # 10–100, optional (default 60)
attribution = { en = "© NTT DOCOMO", ja = "© NTT ドコモ" }      # optional
notice = { en = "docomo public LTE area. No guarantee in the air.", ja = "ドコモ公開LTEエリア・上空通信の保証なし" }  # optional

[[overlay.legend]]                # optional, shown under the overlay in the menu
color = "#ff7f00"
label = { en = "LTE", ja = "LTE" }

[[link]]
label = { en = "docomo coverage map", ja = "ドコモ公式エリアマップ" }
url = "https://www.docomo.ne.jp/area/map/"
```

Rules:
- **Localized text**: either a plain string (used for every language) or a table with
  `en` required and `ja` / `zh` / `ko` optional. The UI picks the current language, then `en`.
  Each value is ≤ 200 chars, plain text, and rendered as text, never as HTML.
- **`tiles`**: `https` (or `http` for local tests). It must contain `{z}`, `{x}` and `{y}`, and
  only those placeholders. It is ≤ 500 chars.
- **`cache = "area"`**:
  - Fetching keeps today's limits: at most `max_tiles` tiles per area (3000), 2 requests in
    flight across the server, 100 ms between requests, 10 s timeout, no redirects, a 512 KiB
    body cap and `User-Agent: RGCS/<version>`.
  - A tile is accepted only when its magic bytes and dimensions match `format` and `tile_size`.
    For `gif` that is `GIF87a` / `GIF89a` plus the logical screen; for `png` it is the PNG
    signature plus the IHDR width and height.
  - HTML is detected as today.
  - `max_zoom - min_zoom ≤ 8`.
- **`cache = "direct"`**: the browser loads `tiles` itself. Nothing is fetched or stored on the
  server.
- Up to 8 overlays and 16 links per plugin.
- **`link.url`**: `https` only. It opens in a new tab with `noopener noreferrer`.
- The `notice` text gets ` (fetched {date} · data {date})` appended for an `area` overlay, as
  today's LTE notice does. With no area fetched, the notice reads "{name}: no area fetched".

## Server

### Modules (replacing `lte_*`)
| New | From | Role |
|---|---|---|
| `crates/rgcs-core/src/plugin.rs` | new | `Manifest`, `Overlay`, `Link`, `LocalText`, validation (pure), the ts-rs `PluginInfo` |
| `crates/rgcs-core/src/overlay_area.rs` | `lte.rs` | `OverlayArea`, `AreaStatus` (ts-rs) |
| `apps/rgcs-server/src/plugins.rs` | new | directory scan, `PluginRegistry` (in `AppState`), enable state |
| `apps/rgcs-server/src/overlay_tiles.rs` | `lte_tiles.rs` | tile math, GIF/PNG validation, tile paths, transparent tiles (GIF + PNG) |
| `apps/rgcs-server/src/overlay_fetch.rs` | `lte_fetch.rs` | the fetcher, keyed by (plugin, overlay); template from the manifest |
| `apps/rgcs-server/src/overlay_api.rs` | `lte_api.rs` | routes below |
| `apps/rgcs-server/src/overlay_fake.rs` | `lte_fake.rs` | local fake tile server for tests |
| `crates/rgcs-store/src/overlay_areas.rs` | `lte_areas.rs` | area rows |

- Removed: `DEFAULT_LTE_TILE_URL`, the `lte_tile_url` config key and `AppState::with_lte`.
- A config file still holding `lte_tile_url` fails to start with a clear message that names the
  plugin replacing it, rather than being silently ignored.

### Storage
- Migration `0017_overlay_areas.sql`:
  - Table `overlay_areas`: the `lte_areas` columns plus `plugin_id TEXT NOT NULL` and
    `overlay_id TEXT NOT NULL`, with an index on `(plugin_id, overlay_id)`.
  - It also runs `DROP TABLE lte_areas`.
  - The LTE overlay was internal only (one area), so its rows are not carried over. It is
    re-fetched after the docomo plugin is installed.
- Tiles: `<data_dir>/overlays/<plugin_id>/<overlay_id>/{z}/{x}/{y}.<format>`, written
  atomically.
  - A tile shared by two areas of the same overlay is stored once.
  - Deleting an area removes only the tiles no other area of that overlay covers (as today).
  - The old `<data_dir>/lte/` is left alone; the release note says it can be deleted.
- Areas of a plugin that is missing or disabled stay in the table. They show again when the
  plugin returns, and are not listed while it is gone.
- Enabled state: table `plugin_state (plugin_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL)` in
  the same migration. No row means enabled: placing the folder is the admin's decision.

### API
All routes need a login. Writes need `X-Requested-With: rgcs`. `{p}` = plugin id and
`{o}` = overlay id; both are checked against the registry, and an unknown or disabled one
returns 404.

| Method | Path | |
|---|---|---|
| GET | `/api/plugins` | `PluginInfo[]`: id, version, name, description, author, homepage, status (`ok` / `error` + code), enabled, overlays, links |
| PUT | `/api/plugins/{p}` | admin only (`AdminUser`): `{enabled}` |
| GET | `/api/plugins/{p}/overlays/{o}/areas` | `OverlayArea[]` |
| POST | `/api/plugins/{p}/overlays/{o}/areas/estimate` | `{south, west, north, east}` → `{tiles}` |
| POST | `/api/plugins/{p}/overlays/{o}/areas` | `{name, south, west, north, east}` → `OverlayArea`, starts the fetch |
| POST | `/api/plugins/{p}/overlays/{o}/areas/{id}/refresh` | 409 `busy` while fetching |
| DELETE | `/api/plugins/{p}/overlays/{o}/areas/{id}` | 409 while fetching |
| GET | `/api/plugins/{p}/overlays/{o}/tiles/{z}/{x}/{y}` | the cached tile in the overlay's format; a transparent tile of that format with `no-cache` when there is none |

- The area routes return 404 for a `direct` overlay.
- The `/api/lte/*` routes are removed.
- `PluginInfo` sends every language of each text. The UI picks the language, so switching
  languages needs no refetch.
- The tile URL template is sent only for `direct` overlays, because the browser needs it.

### Security notes
- Users choose only rectangles. Every URL comes from a manifest the admin placed, so the area
  routes cannot be turned into an open proxy.
- Ids pass the id regex before they touch a path, so there is no path traversal. Tile paths are
  built from integers.
- Manifests are never executed. Strings are rendered as text.
- Plugins add no route that reaches the vehicle.

## UI
`features/lte` becomes `features/overlays`. The logic stays (layer placement, area store,
polling, sheet); it is keyed by `(pluginId, overlayId)`.

- **Plugin list**: `usePlugins()` fetches `/api/plugins` once per session, with a store shared by
  both maps. Only `ok` + enabled plugins contribute overlays and links.
- **Layers**:
  - One raster layer per visible overlay: `ov-<plugin>-<overlay>`, source of the same name.
  - `area` overlays: tiles `/api/plugins/{p}/overlays/{o}/tiles/{z}/{x}/{y}?v=`, `bounds` = the
    union of the fetched areas.
  - `direct` overlays: the manifest `tiles`, no bounds.
  - `minzoom` / `maxzoom` and `tileSize` come from the manifest.
  - All overlays sit above the base map and below every app layer, in plugin-id then manifest
    order. `orderLayers` / `applyBasemap` treat the `ov-` prefix as the overlay band.
- **Menu** (layers button), section 「Overlays」:
  - Per overlay: on/off (`menuitemcheckbox`), an opacity slider, the legend when on, and
    「Manage areas…」 for `area` overlays (today's sheet, titled with the overlay name).
  - Then the plugin links, under each plugin's name.
  - The built-in carrier links and 「copy the map centre」 stay where they are (core, not plugin).
- **Prefs**: `rgcs.overlays` = `{ "<p>/<o>": { on, opacity } }`, per browser. The old
  `rgcs.lteOverlay` key is ignored.
- **Notice**: one line per visible overlay that has a `notice`, stacked in today's notice spot.
- **Attribution**: the manifest `attribution` joins the map attribution control while the
  overlay is on.
- **Settings**: a 「Plugins」 page in the app settings.
  - It lists name, id, version, author, status (an error code with its explanation) and the
    overlay and link counts, with an enable switch for admins (read-only for others).
  - Text: 「Plugins are read from `<plugins_dir>` at server start.」
- **Strings**: the `lte*` keys become generic `ov*` keys. The docomo words leave the core
  dictionaries; the `lteCarrier*` / `lteCopy*` keys stay under the carrier links. All four
  languages are kept complete (the "zh and ko translate every key" test).
- Any failure (plugin list, area list, layer add) is caught, and the overlay simply does not show.

## Plugin docs and examples (public)
- `PLUGINS.md` at the repo root is the **Plugin Interface** that the license exception refers to.
  It covers the manifest format (`api = 1`), the loading rules, the error codes and the tile
  limits. It is English and goes into the public export.
- `examples/plugins/`: one small working example, copied by hand into `plugins_dir`:
  - an OpenSeaMap seamark overlay (`cache = "direct"`, CC BY-SA, attribution set).
  - The README says the plugin author is responsible for the tile source's terms.
- The docomo plugin is internal: `deploy/plugins/docomo-lte/plugin.toml`. The public export
  excludes it (it goes on the export script's exclude list).

## License exception
`LICENSE` = the AGPL-3.0 text, followed by "Additional permission under GNU AGPL version 3
section 7: RGCS Plugin Exception 1.0".
- In short: a plugin that uses RGCS only through the Plugin Interface (`PLUGINS.md`) may be
  conveyed and offered over a network under any terms. It does not have to be AGPL, and its
  source does not have to be provided.
- RGCS itself and any modification of RGCS stay under the AGPL.
- The exception covers stage 2 / 3 plugins too, once `PLUGINS.md` documents their interface.
- `license = "AGPL-3.0-only"` in `Cargo.toml` (workspace) and `package.json`. The exception is
  stated in `LICENSE` and the README, because SPDX has no identifier for it.

## Tests (TDD, no internet)
- **Rust core**: manifest parsing and validation.
  - Valid, plus each error code.
  - Localized text as a string or a table, with a missing `en`.
  - Overlay and link limits, `area` vs `direct`, the zoom span.
- **Rust server**:
  - Loader: a temp `plugins_dir` with one good, one broken and one mismatched plugin. Only the
    good one is `ok`; the server still starts.
  - Validation: PNG accept/reject (signature, IHDR size).
  - Fetch against `overlay_fake` for both GIF and PNG overlays; the existing LTE cases
    (HTML 200, 404, wrong size, slow → timeout) move here.
  - Routes: unknown or disabled plugin → 404; `direct` overlay → 404 on the area routes;
    PUT enabled is admin-only (403 for operators); the tile fallback has the overlay's
    format; `/api/lte/*` is gone.
  - Config: `lte_tile_url` gives a clear start error.
- **rgcs-store**: the migration creates `overlay_areas` and `plugin_state` and drops `lte_areas`;
  areas are scoped by `(plugin, overlay)`.
- **UI**:
  - Layer band placement with two overlays and a base swap.
  - Prefs keyed by overlay.
  - Menu: two plugins, a legend and links.
  - A `direct` overlay has no 「Manage areas」.
  - The notice per overlay, the settings plugin list (admin vs operator) and language fallback
    for plugin text.
- **Live**: put the internal docomo plugin into `.dev/data/plugins` and re-fetch the
  Nachikatsuura rectangle. The map should match the 2026-10-31 check. Then add the
  OpenSeaMap example and check `direct` loading and the layer order.

## Steps and commits
1. `docs: plugin exception and AGPL-3.0 license` (`LICENSE`, license fields). Done with this design.
2. `feat(core): plugin manifest format and validation`
3. `feat(server): load plugins from plugins_dir`, including `/api/plugins` and enable state
   (migration 0017).
4. `refactor(server)!: generic overlay areas and tiles from plugins` (drops `lte_*`,
   `lte_tile_url` and `/api/lte`).
5. `refactor(ui)!: overlays from plugins` (`features/lte` → `features/overlays`, generic strings).
6. `feat(ui): plugins settings page`
7. `docs: PLUGINS.md and an example plugin`, plus the internal docomo plugin under `deploy/`.
8. Update the earlier LTE design with a superseded note.

## Out of scope (later stages)
- Stage 2:
  - JavaScript UI plugins (`ui.js` plus the `rgcs.*` host API: map layers, menu sections,
    panels, read-only telemetry, i18n).
  - GeoJSON / vector overlays.
- Stage 3: server-side plugins as supervised external processes behind
  `/api/plugins/{p}/...`.
- Installing plugins from the UI, hot reload, signing.
