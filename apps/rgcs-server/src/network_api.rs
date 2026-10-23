//! `GET /api/network`: the network view's topology (spec 80 §4, plan 2026-10-23 ruling 8:
//! any logged-in user).

use axum::extract::State;
use axum::response::Response;

use crate::api::ok;
use crate::app::AppState;
use crate::auth::AuthUser;

pub async fn get(State(app): State<AppState>, AuthUser(_op): AuthUser) -> Response {
    ok(crate::network::collect(&app).await)
}
