//! `/api/vehicles/{sysid}/video/*` (spec 50 §2.3): WHEP relay and source selection.

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use rgcs_core::{SysId, VideoSourceMode};
use rgcs_video::WhepError;
use serde::Deserialize;

use crate::api::{err, ok};
use crate::app::AppState;
use crate::auth::AuthUser;

/// Forwards the browser's SDP offer to MediaMTX and returns its answer (status 201).
pub async fn whep(
    State(app): State<AppState>,
    AuthUser(_op): AuthUser,
    Path(_sysid): Path<SysId>,
    body: Bytes,
) -> Response {
    relay(&app, &body).await
}

pub(crate) async fn relay(app: &AppState, offer: &[u8]) -> Response {
    match app.whep.offer(offer).await {
        Ok(answer) => (
            StatusCode::CREATED,
            [(header::CONTENT_TYPE, "application/sdp")],
            answer.sdp,
        )
            .into_response(),
        Err(WhepError::Unreachable) | Err(WhepError::Upstream(_)) => err(
            StatusCode::SERVICE_UNAVAILABLE,
            "video_unavailable",
            "media server is not answering",
        ),
        Err(e) => err(StatusCode::BAD_GATEWAY, "video_error", e.to_string()),
    }
}

pub async fn get_source(
    State(app): State<AppState>,
    AuthUser(_op): AuthUser,
    Path(sysid): Path<SysId>,
) -> Response {
    ok(app.video.status(sysid).await)
}

#[derive(Deserialize)]
pub struct ModeBody {
    pub mode: VideoSourceMode,
}

pub async fn put_source(
    State(app): State<AppState>,
    AuthUser(_op): AuthUser,
    Path(sysid): Path<SysId>,
    Json(body): Json<ModeBody>,
) -> Response {
    match app.video.set_mode(sysid, body.mode).await {
        Ok(status) => ok(status),
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, "internal", e.to_string()),
    }
}
