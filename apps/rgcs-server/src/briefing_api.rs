//! Briefing endpoints (spec 50 §2.2.2): named sets of saved missions.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use rgcs_core::{validate_briefing, Briefing};
use rgcs_store::audit::AuditInput;
use rgcs_store::StoreError;
use serde_json::json;

use crate::api::{err, ok};
use crate::app::AppState;
use crate::auth::AuthUser;

fn store_error(e: StoreError) -> Response {
    match e {
        StoreError::Invalid(msg) => err(StatusCode::BAD_REQUEST, "invalid", msg),
        other => err(StatusCode::INTERNAL_SERVER_ERROR, "store", other.to_string()),
    }
}

fn not_found(id: i64) -> Response {
    err(
        StatusCode::NOT_FOUND,
        "not_found",
        format!("briefing {id} does not exist"),
    )
}

/// `invalid` for a malformed briefing, `unknown_mission` for a row whose mission is gone.
/// Returns the error response to send, or `None` when the briefing is fine.
async fn check(app: &AppState, b: &Briefing) -> Option<Response> {
    if let Err(msg) = validate_briefing(b) {
        return Some(err(StatusCode::BAD_REQUEST, "invalid", msg));
    }
    for row in &b.rows {
        match app.store.get_mission(row.mission_id).await {
            Ok(Some(_)) => {}
            Ok(None) => {
                return Some(err(
                    StatusCode::BAD_REQUEST,
                    "unknown_mission",
                    format!("mission {} does not exist", row.mission_id),
                ))
            }
            Err(e) => return Some(store_error(e)),
        }
    }
    None
}

async fn audit(app: &AppState, op: &str, action: &str, id: Option<i64>, b: Option<&Briefing>) {
    let args = json!({ "id": id, "name": b.map(|b| b.name.as_str()), "rows": b.map(|b| b.rows.len()) });
    let entry = AuditInput {
        operator: op,
        sysid: None,
        target: "briefing",
        command: action,
        args: Some(args.to_string()),
        result: "ok",
        reason: None,
    };
    if let Err(e) = app.store.record_audit(entry).await {
        tracing::error!(error = %e, "audit write failed");
    }
}

/// `GET /api/briefings`
pub async fn list_briefings(State(app): State<AppState>, AuthUser(_op): AuthUser) -> Response {
    match app.store.list_briefings().await {
        Ok(rows) => ok(rows),
        Err(e) => store_error(e),
    }
}

/// `POST /api/briefings` → 201 with the new id.
pub async fn create_briefing(
    State(app): State<AppState>,
    AuthUser(op): AuthUser,
    Json(briefing): Json<Briefing>,
) -> Response {
    if let Some(r) = check(&app, &briefing).await {
        return r;
    }
    match app.store.create_briefing(&briefing, &op.username).await {
        Ok(saved) => {
            audit(&app, &op.username, "create", saved.id, Some(&saved)).await;
            (
                StatusCode::CREATED,
                Json(json!({ "success": true, "data": saved })),
            )
                .into_response()
        }
        Err(e) => store_error(e),
    }
}

/// `GET /api/briefings/{id}`
pub async fn get_briefing(
    State(app): State<AppState>,
    AuthUser(_op): AuthUser,
    Path(id): Path<i64>,
) -> Response {
    match app.store.get_briefing(id).await {
        Ok(Some(full)) => ok(full),
        Ok(None) => not_found(id),
        Err(e) => store_error(e),
    }
}

/// `PUT /api/briefings/{id}`
pub async fn update_briefing(
    State(app): State<AppState>,
    AuthUser(op): AuthUser,
    Path(id): Path<i64>,
    Json(briefing): Json<Briefing>,
) -> Response {
    if let Some(r) = check(&app, &briefing).await {
        return r;
    }
    match app.store.update_briefing(id, &briefing).await {
        Ok(Some(saved)) => {
            audit(&app, &op.username, "update", Some(id), Some(&saved)).await;
            ok(saved)
        }
        Ok(None) => not_found(id),
        Err(e) => store_error(e),
    }
}

/// `DELETE /api/briefings/{id}` → `{deleted: true}`.
pub async fn delete_briefing(
    State(app): State<AppState>,
    AuthUser(op): AuthUser,
    Path(id): Path<i64>,
) -> Response {
    match app.store.delete_briefing(id).await {
        Ok(true) => {
            audit(&app, &op.username, "delete", Some(id), None).await;
            ok(json!({ "deleted": true }))
        }
        Ok(false) => not_found(id),
        Err(e) => store_error(e),
    }
}
