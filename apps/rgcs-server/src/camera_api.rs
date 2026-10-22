//! `/api/vehicles/{sysid}/camera*` (spec 50 §2.3): caps + state, commands, profile.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::Json;
use rgcs_camera::CameraError;
use rgcs_core::{CameraCaps, CameraCommand, CameraKind, CameraProfile, CameraState, SysId, VideoSourceMode};
use rgcs_store::audit::AuditInput;
use serde::{Deserialize, Serialize};

use crate::api::{err, ok};
use crate::app::AppState;
use crate::auth::AuthUser;
use crate::roi::StopReason;

#[derive(Serialize)]
pub struct CameraView {
    pub caps: CameraCaps,
    pub state: CameraState,
}

pub async fn get_camera(
    State(app): State<AppState>,
    AuthUser(_op): AuthUser,
    Path(sysid): Path<SysId>,
) -> Response {
    let camera = app.cameras.ensure(sysid).await;
    ok(CameraView {
        caps: camera.caps(),
        state: camera.state().borrow().clone(),
    })
}

pub async fn command(
    State(app): State<AppState>,
    AuthUser(op): AuthUser,
    Path(sysid): Path<SysId>,
    Json(cmd): Json<CameraCommand>,
) -> Response {
    if matches!(cmd, CameraCommand::GimbalRate { .. }) {
        return err(
            StatusCode::CONFLICT,
            "ws_only",
            "gimbal_rate is sent over the WebSocket",
        );
    }
    cancel_roi_for_manual(&app, &op.username, sysid, &cmd).await;
    let result = app.cameras.send(sysid, cmd.clone()).await;
    let (status, code, reason) = match &result {
        Ok(()) => (StatusCode::OK, "", None),
        Err(CameraError::Unsupported(what)) => (
            StatusCode::CONFLICT,
            "unsupported_capability",
            Some(format!("{what} is not supported")),
        ),
        Err(CameraError::NotConnected) => (
            StatusCode::SERVICE_UNAVAILABLE,
            "camera_offline",
            Some("camera is not connected".into()),
        ),
        Err(CameraError::Forbidden(c)) => (
            StatusCode::CONFLICT,
            "forbidden",
            Some(format!("command 0x{c:02X} is forbidden")),
        ),
        Err(e) => (
            StatusCode::SERVICE_UNAVAILABLE,
            "camera_error",
            Some(e.to_string()),
        ),
    };
    audit(
        &app,
        &op.username,
        sysid,
        &cmd,
        if result.is_ok() { "ok" } else { "rejected" },
        reason.as_deref(),
    )
    .await;
    match reason {
        None => ok(()),
        Some(message) => err(status, code, message),
    }
}

pub async fn get_profile(
    State(app): State<AppState>,
    AuthUser(_op): AuthUser,
    Path(sysid): Path<SysId>,
) -> Response {
    match app.store.camera_profile(sysid).await {
        Ok(p) => ok(p),
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, "internal", e.to_string()),
    }
}

/// Partial update: fields left out keep their stored (or default) value.
#[derive(Deserialize)]
pub struct ProfilePatch {
    pub kind: Option<CameraKind>,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub rtsp_url: Option<String>,
    pub comp_id: Option<u8>,
    pub video_source_mode: Option<VideoSourceMode>,
    pub android_url: Option<String>,
    pub encoding_preset: Option<String>,
    pub thermal_palette: Option<u8>,
    pub thermal_overlay: Option<bool>,
    pub ai_box_px: Option<u16>,
    pub clock_sync: Option<bool>,
    pub auto_record: Option<bool>,
}

fn merge(base: CameraProfile, p: ProfilePatch) -> CameraProfile {
    CameraProfile {
        sysid: base.sysid,
        kind: p.kind.unwrap_or(base.kind),
        host: p.host.unwrap_or(base.host),
        port: p.port.unwrap_or(base.port),
        rtsp_url: p.rtsp_url.unwrap_or(base.rtsp_url),
        comp_id: p.comp_id.unwrap_or(base.comp_id),
        video_source_mode: p.video_source_mode.unwrap_or(base.video_source_mode),
        android_url: p.android_url.unwrap_or(base.android_url),
        encoding_preset: p.encoding_preset.unwrap_or(base.encoding_preset),
        thermal_palette: p.thermal_palette.unwrap_or(base.thermal_palette),
        thermal_overlay: p.thermal_overlay.unwrap_or(base.thermal_overlay),
        ai_box_px: p.ai_box_px.unwrap_or(base.ai_box_px),
        clock_sync: p.clock_sync.unwrap_or(base.clock_sync),
        auto_record: p.auto_record.unwrap_or(base.auto_record),
    }
}

pub async fn put_profile(
    State(app): State<AppState>,
    AuthUser(op): AuthUser,
    Path(sysid): Path<SysId>,
    Json(patch): Json<ProfilePatch>,
) -> Response {
    let base = match app.store.camera_profile(sysid).await {
        Ok(p) => p,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, "internal", e.to_string()),
    };
    let profile = merge(base.clone(), patch);
    if let Err(e) = profile.validate() {
        return err(StatusCode::BAD_REQUEST, "validation", e.to_string());
    }
    if let Err(e) = app.store.put_camera_profile(&profile).await {
        return err(StatusCode::INTERNAL_SERVER_ERROR, "internal", e.to_string());
    }
    let entry = AuditInput {
        operator: &op.username,
        sysid: Some(sysid),
        target: "camera",
        command: "profile",
        args: serde_json::to_string(&profile).ok(),
        result: "ok",
        reason: None,
    };
    if let Err(e) = app.store.record_audit(entry).await {
        tracing::error!(error = %e, "audit write failed");
    }
    // An unchanged profile (e.g. a settings save that only touched ROI presets) keeps the
    // driver, the video and an active ROI running.
    if profile != base {
        reload_driver(&app, &op.username, sysid).await;
    }
    ok(profile)
}

/// The driver is rebuilt: ROI stops first (with its zeros) so no stale command follows.
async fn reload_driver(app: &AppState, operator: &str, sysid: SysId) {
    if app.roi.stop(sysid, StopReason::Operator).await {
        crate::roi_api::audit_manual_stop(app, operator, sysid, "profile_reload").await;
    }
    app.cameras.reload(sysid).await;
    app.video.reload(sysid).await;
}

/// Manual gimbal pointing cancels ROI (spec 40 §4); the stop is audited when ROI was active.
async fn cancel_roi_for_manual(app: &AppState, operator: &str, sysid: SysId, cmd: &CameraCommand) {
    let manual = matches!(
        cmd,
        CameraCommand::GimbalCenter { .. } | CameraCommand::GimbalAngle { .. } | CameraCommand::GimbalMode { .. }
    );
    if manual && app.roi.stop(sysid, StopReason::Manual).await {
        crate::roi_api::audit_manual_stop(app, operator, sysid, "manual_command").await;
    }
}

async fn audit(
    app: &AppState,
    operator: &str,
    sysid: SysId,
    cmd: &CameraCommand,
    result: &str,
    reason: Option<&str>,
) {
    let entry = AuditInput {
        operator,
        sysid: Some(sysid),
        target: "camera",
        command: cmd.name(),
        args: serde_json::to_string(cmd).ok(),
        result,
        reason: reason.map(str::to_string),
    };
    if let Err(e) = app.store.record_audit(entry).await {
        tracing::error!(error = %e, "audit write failed");
    }
}
