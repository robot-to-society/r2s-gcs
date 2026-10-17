//! `GET /api/settings/app` (spec 50 §2.4): what the UI needs that is not per-vehicle.
//! P1 serves the language default and the map tile source; P2+ persist more in `app_settings`.

use axum::extract::State;
use axum::response::Response;
use serde::Serialize;

use crate::api::ok;
use crate::app::AppState;
use crate::auth::AuthUser;

#[derive(Serialize, ts_rs::TS)]
#[ts(export)]
pub struct AppSettings {
    pub lang: String,
    pub map_tile_url: String,
    pub map_attribution: String,
}

pub async fn app_settings(State(app): State<AppState>, AuthUser(_op): AuthUser) -> Response {
    ok(AppSettings {
        lang: "ja".into(),
        map_tile_url: app.map_tile_url.clone(),
        map_attribution: app.map_attribution.clone(),
    })
}
