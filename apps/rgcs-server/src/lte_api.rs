//! `/api/lte/*`: docomo LTE overlay areas and their cached tiles (LTE overlay design § API).

use axum::extract::{Path, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use rgcs_core::{LteArea, LteEstimate};
use rgcs_store::StoreError;
use serde::Deserialize;

use crate::api::{err, ok};
use crate::app::AppState;
use crate::auth::AuthUser;
use crate::lte_fetch::{prune_tiles, spawn_area};
use crate::lte_tiles::{count, in_range, parse_tile_name, tile_path, Rect, LTE_MAX_TILES, TRANSPARENT_GIF};

/// Longest area name, in characters.
pub const LTE_NAME_MAX: usize = 60;

#[derive(Debug, Deserialize)]
pub struct AreaBody {
    pub name: String,
    #[serde(flatten)]
    pub rect: Rect,
}

fn store_error(e: StoreError) -> Response {
    err(StatusCode::INTERNAL_SERVER_ERROR, "store", e.to_string())
}

fn not_found(id: i64) -> Response {
    err(
        StatusCode::NOT_FOUND,
        "not_found",
        format!("LTE area {id} does not exist"),
    )
}

fn busy() -> Response {
    err(StatusCode::CONFLICT, "busy", "the area is being fetched")
}

fn rect_of(a: &LteArea) -> Rect {
    Rect {
        south: a.south,
        west: a.west,
        north: a.north,
        east: a.east,
    }
}

fn bad_rect() -> Response {
    err(
        StatusCode::BAD_REQUEST,
        "bad_rect",
        "need -85 < south < north < 85 and -180 <= west < east <= 180",
    )
}

/// The tile count of a valid rectangle within the limit, else the 400 to answer.
fn checked_count(r: &Rect) -> Result<u64, Box<Response>> {
    if !r.is_valid() {
        return Err(Box::new(bad_rect()));
    }
    let tiles = count(r);
    if tiles > LTE_MAX_TILES {
        return Err(Box::new(err(
            StatusCode::BAD_REQUEST,
            "too_many_tiles",
            format!("{tiles} tiles; at most {LTE_MAX_TILES}"),
        )));
    }
    Ok(tiles)
}

/// Claims the area and starts its background fetch; answers the row as it now stands.
async fn start_fetch(app: &AppState, area: &LteArea) -> Response {
    let rect = rect_of(area);
    match app.store.begin_lte_fetch(area.id, count(&rect)).await {
        Ok(true) => {}
        Ok(false) => return busy(),
        Err(e) => return store_error(e),
    }
    spawn_area(
        app.lte.clone(),
        app.store.clone(),
        app.data_dir.clone(),
        area.id,
        rect,
    );
    match app.store.get_lte_area(area.id).await {
        Ok(Some(row)) => ok(row),
        Ok(None) => not_found(area.id),
        Err(e) => store_error(e),
    }
}

/// `GET /api/lte/areas` → `LteArea[]`, oldest first.
pub async fn list(State(app): State<AppState>, AuthUser(_op): AuthUser) -> Response {
    match app.store.list_lte_areas().await {
        Ok(rows) => ok(rows),
        Err(e) => store_error(e),
    }
}

/// `POST /api/lte/areas/estimate` `{south, west, north, east}` → `{tiles}`. Only the
/// rectangle is checked: the UI compares the count with the limit itself.
pub async fn estimate(
    State(_app): State<AppState>,
    AuthUser(_op): AuthUser,
    Json(r): Json<Rect>,
) -> Response {
    if !r.is_valid() {
        return bad_rect();
    }
    ok(LteEstimate { tiles: count(&r) })
}

/// `POST /api/lte/areas` `{name, south, west, north, east}` → the new area, fetching.
pub async fn create(
    State(app): State<AppState>,
    AuthUser(_op): AuthUser,
    Json(body): Json<AreaBody>,
) -> Response {
    let name = body.name.trim();
    if name.is_empty() || name.chars().count() > LTE_NAME_MAX {
        return err(
            StatusCode::BAD_REQUEST,
            "bad_name",
            "name must be 1–60 characters",
        );
    }
    let tiles = match checked_count(&body.rect) {
        Ok(n) => n,
        Err(res) => return *res,
    };
    let r = body.rect;
    match app
        .store
        .create_lte_area(name, (r.south, r.west, r.north, r.east), tiles)
        .await
    {
        Ok(area) => start_fetch(&app, &area).await,
        Err(e) => store_error(e),
    }
}

/// `POST /api/lte/areas/{id}/refresh` → the area, fetching again (409 `busy` while fetching).
pub async fn refresh(State(app): State<AppState>, AuthUser(_op): AuthUser, Path(id): Path<i64>) -> Response {
    match app.store.get_lte_area(id).await {
        Ok(Some(area)) => start_fetch(&app, &area).await,
        Ok(None) => not_found(id),
        Err(e) => store_error(e),
    }
}

/// `DELETE /api/lte/areas/{id}` → 204; removes the tiles no other area covers.
pub async fn delete(State(app): State<AppState>, AuthUser(_op): AuthUser, Path(id): Path<i64>) -> Response {
    let area = match app.store.get_lte_area(id).await {
        Ok(Some(a)) => a,
        Ok(None) => return not_found(id),
        Err(e) => return store_error(e),
    };
    match app.store.delete_lte_area(id).await {
        Ok(true) => {}
        Ok(false) => return busy(),
        Err(e) => return store_error(e),
    }
    let others: Vec<Rect> = match app.store.list_lte_areas().await {
        Ok(rows) => rows.iter().map(rect_of).collect(),
        Err(e) => return store_error(e),
    };
    prune_tiles(&app.data_dir, rect_of(&area), &others).await;
    StatusCode::NO_CONTENT.into_response()
}

fn gif(body: Vec<u8>, cache: &'static str) -> Response {
    (
        [
            (header::CONTENT_TYPE, "image/gif"),
            (header::CACHE_CONTROL, cache),
        ],
        body,
    )
        .into_response()
}

/// `GET /api/lte/tiles/{z}/{x}/{y}.gif` → the cached tile, or a transparent GIF when there
/// is none (never an error, so the map stays quiet). Out-of-range addresses are 404.
pub async fn tile(
    State(app): State<AppState>,
    AuthUser(_op): AuthUser,
    Path((z, x, name)): Path<(String, String, String)>,
) -> Response {
    let parsed = (z.parse::<u8>(), x.parse::<u32>(), parse_tile_name(&name));
    let (Ok(z), Ok(x), Some(y)) = parsed else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if !in_range(z, x, y) {
        return StatusCode::NOT_FOUND.into_response();
    }
    match tokio::fs::read(tile_path(&app.data_dir, z, x, y)).await {
        Ok(bytes) => gif(bytes, "private, max-age=3600"),
        // Not cached yet: a later fetch may add it, so the blank is not kept.
        Err(_) => gif(TRANSPARENT_GIF.to_vec(), "private, no-cache"),
    }
}
