# Docomo LTE area overlay (design)

> **Superseded 2026-11-01** by [2026-11-01-plugin-overlays-design.md](2026-11-01-plugin-overlays-design.md):
> the engine below became the generic `area` overlay of plugins, and the docomo source moved to
> the internal plugin `deploy/plugins/docomo-lte/plugin.toml`. `/api/lte/*`, `lte_tile_url` and
> `lte_areas` are gone.

User request 2026-10-31: overlay NTT docomo's public LTE service-area map on the web GCS, from
tiles the server fetched for chosen rectangles and serves from the same origin.

Decisions (user, 2026-10-31): the rectangles are chosen in the UI (several, named); the overlay
shows on both the operations map and the flight-plan map; fetching is manual only; the live
check uses the Nachikatsuura area.

## Source

- Tile template: `https://servicearea.nttdocomo.co.jp/map/1014/0000000000000000/{z}/{x}/{z}_{x}_{y}.gif`
  (XYZ / Web Mercator, 256×256 GIF89a, palette index 255 transparent, so it overlays as is).
- Response headers seen 2026-10-31: `Content-Type: image/gif`, `Last-Modified` (data date,
  e.g. 2026-10-01), `Cache-Control: no-store`.
- Terms: docomo's site terms (https://www.docomo.ne.jp/utility/term/) keep the copyright with
  docomo and allow copying only for private use. Caching for business use and serving the tiles
  to other devices may need docomo's permission: **check before any external release**. The
  response also says `no-store`. Until then the feature is for internal evaluation, and the UI
  always shows the notice below.

## Server

### Storage
- Tiles: `<data_dir>/lte/{z}/{x}/{y}.gif`, written atomically (temp file + rename). A tile
  shared by two areas is stored once.
- Areas: table `lte_areas` (migration `0016_lte_areas.sql`): `id`, `name`, `south`, `west`,
  `north`, `east`, `status` (`idle` | `fetching` | `ready` | `partial` | `failed`), `tiles_total`,
  `tiles_ok`, `tiles_failed`, `fetched_at` (ms, last completed fetch), `data_modified` (ms, the
  newest `Last-Modified` seen, nullable), `last_error` (short code, nullable), `created_at`.

### Fetch
- Zoom 8–14 (`LTE_MIN_ZOOM` / `LTE_MAX_ZOOM`); every tile intersecting the rectangle at each
  zoom. A request above `LTE_MAX_TILES` = 3000 tiles is refused (`too_many_tiles`) before anything
  is fetched; the UI shows the count first.
- One background task per area; 2 requests in flight at most across the server, 100 ms between
  requests, 10 s timeout, no redirects, `User-Agent: RGCS/<version>`, 512 KiB body cap.
- A tile is accepted only when: status 200, `Content-Type` starts with `image/gif`, the body
  starts with `GIF87a` / `GIF89a`, and the logical screen is 256×256. Otherwise it counts as
  failed with a short code: `http_<status>`, `html` (a `text/html` type or a body starting with
  `<`), `not_gif`, `bad_size`, `too_large`, `timeout`, `connect`, `redirect`. A failed tile
  keeps any tile already cached. URLs and bodies are never logged.
- When done: `ready` (no failures), `partial` (some), `failed` (all failed); `fetched_at` = now.
- The template is `lte_tile_url` in config.toml (default above) so tests use a local fake server.
- Nothing here can stop the GCS: errors stay inside the task and the area row.

### API (all need a login; writes need the `X-Requested-With: rgcs` header like every write)
| Method | Path | |
|---|---|---|
| GET | `/api/lte/areas` | `LteArea[]` (with the counters, for progress polling) |
| POST | `/api/lte/areas/estimate` | `{south, west, north, east}` → `{tiles}`; 400 on a bad rectangle |
| POST | `/api/lte/areas` | `{name, south, west, north, east}` → `LteArea`, starts the fetch; 400 `bad_rect` / `too_many_tiles` |
| POST | `/api/lte/areas/{id}/refresh` | restarts the fetch (409 `busy` while fetching) |
| DELETE | `/api/lte/areas/{id}` | removes the row and the tiles no other area covers (409 while fetching) |
| GET | `/api/lte/tiles/{z}/{x}/{y}.gif` | the cached tile; a transparent GIF when there is none (never an error, so the map stays quiet); `Cache-Control: private, max-age=3600` |

Rectangle rules: `-85 < south < north < 85`, `-180 <= west < east <= 180`, name 1–60 chars.
`LteArea` is a ts-rs type (`#[ts(export)]`, `u64`/`i64` as `number`).

## UI

- Layer `lte-area` (raster source `lte`, tiles `/api/lte/tiles/{z}/{x}/{y}.gif`, `tileSize`
  256, `minzoom` 8, `maxzoom` 14 so MapLibre overzooms above 14, `bounds` = union of the ready
  areas). Added as the lowest app layer: above the base map (and its label overlay), below the
  mission path, rally, tracks and vehicles. `applyBasemap` already re-inserts the base below the
  first non-base layer, so the order survives a base-map swap.
- Both maps: operations (`MapView`) and planner (`MissionMap`).
- Controls in the base-map menu (layers button), section 「オーバーレイ」:
  - 「ドコモ LTE エリア」 on/off (`menuitemcheckbox`) and an opacity slider (10–100 %, default 60 %).
  - 「範囲を管理…」 opens a sheet: the area list (name, rectangle, status / progress,
    取得日, データ更新日, ok/failed counts, 更新 and 削除 with an in-app confirm), and
    「いま表示している範囲を追加」: a name field, the tile count (estimate endpoint), 取得.
    The list polls `GET /api/lte/areas` every second while an area is fetching.
- The on/off and opacity are per browser (localStorage `rgcs.lteOverlay`), shared by both maps.
- While the layer is on, a small notice on the map:
  「ドコモ公開LTEエリア・上空通信の保証なし(取得 2026-10-31・データ 2026-10-01)」, dates from
  the areas (newest fetch, newest data date). With no area fetched: 「LTE エリア未取得」.
- Any failure (list fetch, layer add) is caught: the overlay just does not show.

## Tests
- Rust: tile math (rectangle → tile ranges, counts), GIF / HTML validation, fetch against a local
  axum fake (ok, HTML 200, 404, wrong size, slow → timeout), area lifecycle and delete keeping
  shared tiles, routes (estimate, too_many_tiles, tile fallback). No internet.
- UI: layer placement (below the app layers, above base), prefs store, menu toggles, the sheet
  (estimate, add, polling, delete confirm), the notice text.
- Live: fetch the Nachikatsuura rectangle (about 10 km square) and check the position against the
  base map, transparency and the zoom range (8–14 tiles, overzoom above).
