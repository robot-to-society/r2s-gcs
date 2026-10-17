//! Mission endpoints (spec 50 §2.4, addendum §5.9): vehicle upload / download / progress.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use rgcs_core::{FenceInfo, Finding, LinkStatus, Mission, ServerMessage, SysId, UploadReport, VehicleState};
use rgcs_mavlink::{encode_param_request_read, Outgoing};
use rgcs_store::audit::AuditInput;
use serde::Deserialize;
use serde_json::json;

use crate::api::{err, ok};
use crate::app::{unix_ms, AppState};
use crate::auth::AuthUser;
use crate::missions::MissionError;

const FENCE_PARAMS: [&str; 3] = ["FENCE_ENABLE", "FENCE_ALT_MAX", "FENCE_RADIUS"];

#[derive(Debug, Deserialize)]
pub struct UploadSavedBody {
    pub mission_id: i64,
}

/// `409 mission_invalid` carries the findings so the UI can show them.
fn invalid_response(findings: &[Finding]) -> Response {
    (
        StatusCode::CONFLICT,
        Json(json!({
            "success": false,
            "error": { "code": "mission_invalid", "message": "the mission has fatal findings" },
            "data": { "findings": findings },
        })),
    )
        .into_response()
}

/// Fence parameters as cached from PARAM_VALUE frames (no I/O).
pub fn fence_from_cache(app: &AppState, sysid: SysId) -> FenceInfo {
    let get = |name: &str| app.params.get(sysid, name);
    FenceInfo {
        enabled: get("FENCE_ENABLE").map(|v| v >= 1.0),
        alt_max: get("FENCE_ALT_MAX"),
        radius: get("FENCE_RADIUS"),
    }
}

/// Asks the vehicle for the fence parameters we do not have yet (answers land in the cache).
pub fn request_missing_fence_params(app: &AppState, sysid: SysId, info: &FenceInfo) {
    if info.enabled.is_some() && info.alt_max.is_some() && info.radius.is_some() {
        return;
    }
    for name in FENCE_PARAMS {
        let _ = app.outgoing.try_send(Outgoing {
            message: encode_param_request_read(sysid, name),
        });
    }
}

async fn vehicle_for_write(app: &AppState, sysid: SysId) -> Result<VehicleState, Box<Response>> {
    let Some(vehicle) = app.router.lock().await.state(sysid).cloned() else {
        return Err(Box::new(err(
            StatusCode::NOT_FOUND,
            "not_found",
            format!("vehicle {sysid} is not connected"),
        )));
    };
    if vehicle.link == LinkStatus::Lost {
        return Err(Box::new(err(
            StatusCode::SERVICE_UNAVAILABLE,
            "link_lost",
            "no heartbeat for 10 s",
        )));
    }
    Ok(vehicle)
}

fn mission_error(e: MissionError) -> Response {
    match e {
        MissionError::Busy => err(StatusCode::CONFLICT, "mission_busy", e.to_string()),
        MissionError::Timeout => err(StatusCode::GATEWAY_TIMEOUT, "mission_timeout", e.to_string()),
        MissionError::Rejected(_) => err(StatusCode::CONFLICT, "mission_rejected", e.to_string()),
        MissionError::LinkClosed => err(StatusCode::SERVICE_UNAVAILABLE, "link_lost", e.to_string()),
        MissionError::Invalid(_) => err(StatusCode::BAD_REQUEST, "invalid", e.to_string()),
    }
}

async fn component_of(app: &AppState, sysid: SysId) -> u8 {
    app.router.lock().await.fc_component(sysid).unwrap_or(1)
}

async fn do_upload(app: &AppState, op: &str, sysid: SysId, mission: &Mission) -> Response {
    let vehicle = match vehicle_for_write(app, sysid).await {
        Ok(v) => v,
        Err(r) => return *r,
    };
    if vehicle.armed {
        audit(
            app,
            op,
            sysid,
            "upload",
            mission,
            "rejected",
            Some("vehicle_armed"),
        )
        .await;
        return err(
            StatusCode::CONFLICT,
            "vehicle_armed",
            "disarm before writing a mission",
        );
    }
    let fence = fence_from_cache(app, sysid);
    let findings = mission.validate(&fence);
    if Mission::has_fatal(&findings) {
        audit(
            app,
            op,
            sysid,
            "upload",
            mission,
            "rejected",
            Some("mission_invalid"),
        )
        .await;
        return invalid_response(&findings);
    }
    request_missing_fence_params(app, sysid, &fence);
    let component = component_of(app, sysid).await;
    match app
        .missions
        .upload(sysid, component, mission, &app.outgoing)
        .await
    {
        Ok(report) => {
            let result = if report.verified { "ok" } else { "mismatch" };
            audit(app, op, sysid, "upload", mission, result, None).await;
            let _ = app
                .tx
                .send(ServerMessage::CommandResult(rgcs_core::CommandResult {
                    id: app.next_command_id(),
                    sysid,
                    cmd: "mission_upload".into(),
                    ok: report.verified,
                    reason: (!report.verified).then(|| format!("mismatch at {:?}", report.mismatched)),
                    ts: unix_ms(),
                }));
            ok(UploadReport { findings, ..report })
        }
        Err(e) => {
            audit(app, op, sysid, "upload", mission, "error", Some(&e.to_string())).await;
            mission_error(e)
        }
    }
}

/// `PUT /api/vehicles/{sysid}/mission` — write the body, read back, compare.
pub async fn put_mission(
    State(app): State<AppState>,
    AuthUser(op): AuthUser,
    Path(sysid): Path<SysId>,
    Json(mission): Json<Mission>,
) -> Response {
    do_upload(&app, &op.username, sysid, &mission).await
}

/// `POST /api/vehicles/{sysid}/mission/upload {mission_id}` — write a saved mission.
pub async fn upload_saved(
    State(app): State<AppState>,
    AuthUser(op): AuthUser,
    Path(sysid): Path<SysId>,
    Json(body): Json<UploadSavedBody>,
) -> Response {
    match app.store.get_mission(body.mission_id).await {
        Ok(Some(mission)) => do_upload(&app, &op.username, sysid, &mission).await,
        Ok(None) => err(
            StatusCode::NOT_FOUND,
            "not_found",
            format!("mission {} does not exist", body.mission_id),
        ),
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, "store", e.to_string()),
    }
}

/// `GET /api/vehicles/{sysid}/mission` — read the vehicle's mission.
pub async fn get_mission(
    State(app): State<AppState>,
    AuthUser(op): AuthUser,
    Path(sysid): Path<SysId>,
) -> Response {
    if let Err(r) = vehicle_for_write(&app, sysid).await {
        return *r;
    }
    let component = component_of(&app, sysid).await;
    match app.missions.download(sysid, component, &app.outgoing).await {
        Ok(mission) => {
            audit(&app, &op.username, sysid, "download", &mission, "ok", None).await;
            ok(mission)
        }
        Err(e) => {
            audit_plain(
                &app,
                &op.username,
                sysid,
                "download",
                "error",
                Some(&e.to_string()),
            )
            .await;
            mission_error(e)
        }
    }
}

/// `GET /api/vehicles/{sysid}/mission/progress` — last `MISSION_CURRENT`, or null.
pub async fn get_progress(
    State(app): State<AppState>,
    AuthUser(_op): AuthUser,
    Path(sysid): Path<SysId>,
) -> Response {
    ok(app.missions.progress(sysid))
}

async fn audit(
    app: &AppState,
    op: &str,
    sysid: SysId,
    action: &str,
    mission: &Mission,
    result: &str,
    reason: Option<&str>,
) {
    let args = json!({ "name": mission.name, "id": mission.id, "items": mission.items.len() });
    let entry = AuditInput {
        operator: op,
        sysid: Some(sysid),
        target: "mission",
        command: action,
        args: Some(args.to_string()),
        result,
        reason: reason.map(str::to_string),
    };
    if let Err(e) = app.store.record_audit(entry).await {
        tracing::error!(error = %e, "audit write failed");
    }
}

async fn audit_plain(
    app: &AppState,
    op: &str,
    sysid: SysId,
    action: &str,
    result: &str,
    reason: Option<&str>,
) {
    let entry = AuditInput {
        operator: op,
        sysid: Some(sysid),
        target: "mission",
        command: action,
        args: None,
        result,
        reason: reason.map(str::to_string),
    };
    if let Err(e) = app.store.record_audit(entry).await {
        tracing::error!(error = %e, "audit write failed");
    }
}
