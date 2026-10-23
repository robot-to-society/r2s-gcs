//! `POST …/confirm` and `POST …/command`: validation, confirm tokens, pre-checks against the
//! live state, audit, then hand-off to the command queue (spec 50 §2.2, 70 §1).

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::Json;
use rgcs_core::{CommandResult, LinkStatus, ServerMessage, SysId, VehicleCommand, VehicleKind, VehicleState};
use rgcs_mavlink::{Outcome, QueuedCommand};
use rgcs_store::audit::AuditInput;
use serde::{Deserialize, Serialize};
use tokio::sync::oneshot;

use crate::api::{err, ok};
use crate::app::AppState;
use crate::auth::AuthUser;
use crate::confirm::ConfirmError;

#[derive(Deserialize)]
pub struct ConfirmBody {
    pub cmd: String,
}

#[derive(Serialize)]
pub struct ConfirmReply {
    pub confirm_token: String,
    pub expires_in: u64,
}

#[derive(Deserialize)]
pub struct CommandBody {
    #[serde(flatten)]
    pub command: VehicleCommand,
    pub confirm_token: Option<String>,
}

#[derive(Serialize)]
pub struct Queued {
    pub id: u64,
}

pub async fn confirm(
    State(app): State<AppState>,
    AuthUser(_op): AuthUser,
    Path(sysid): Path<SysId>,
    Json(body): Json<ConfirmBody>,
) -> Response {
    if app.router.lock().await.state(sysid).is_none() {
        return err(
            StatusCode::NOT_FOUND,
            "not_found",
            format!("vehicle {sysid} is not connected"),
        );
    }
    let token = app.issue_confirm(sysid, &body.cmd);
    ok(ConfirmReply {
        confirm_token: token,
        expires_in: crate::confirm::TOKEN_TTL_SECS,
    })
}

/// Reason a command is refused before it reaches the queue.
pub fn precheck(cmd: &VehicleCommand, v: &VehicleState) -> Option<(StatusCode, &'static str, String)> {
    if v.link == LinkStatus::Lost {
        return Some((
            StatusCode::SERVICE_UNAVAILABLE,
            "link_lost",
            "no heartbeat for 10 s".into(),
        ));
    }
    match cmd {
        VehicleCommand::Arm if v.armed => Some((StatusCode::CONFLICT, "rejected", "already armed".into())),
        VehicleCommand::Disarm if !v.armed => {
            Some((StatusCode::CONFLICT, "rejected", "already disarmed".into()))
        }
        VehicleCommand::Other { mav_cmd, params } => crate::other_guard::check(*mav_cmd, params, v),
        VehicleCommand::Takeoff { .. } => takeoff_refusal(v),
        _ => None,
    }
}

/// Takeoff needs something that flies (spec 50 §2.2), already armed.
fn takeoff_refusal(v: &VehicleState) -> Option<(StatusCode, &'static str, String)> {
    if matches!(v.kind, VehicleKind::Rover | VehicleKind::Other) {
        return Some((
            StatusCode::UNPROCESSABLE_ENTITY,
            "not_allowed",
            "takeoff is only for copters and planes".into(),
        ));
    }
    (!v.armed).then(|| (StatusCode::CONFLICT, "rejected", "arm first".into()))
}

/// The queue job for `cmd` on `v`: its airframe and mode pick how a takeoff is sent.
pub fn queued(v: &VehicleState, cmd: VehicleCommand, done: oneshot::Sender<Outcome>) -> QueuedCommand {
    QueuedCommand {
        sysid: v.sysid,
        kind: v.kind,
        vtol: v.vtol,
        mode: v.mode.clone(),
        cmd,
        done,
    }
}

pub async fn command(
    State(app): State<AppState>,
    AuthUser(op): AuthUser,
    Path(sysid): Path<SysId>,
    Json(body): Json<CommandBody>,
) -> Response {
    let cmd = body.command;
    let Some(vehicle) = app.router.lock().await.state(sysid).cloned() else {
        return err(
            StatusCode::NOT_FOUND,
            "not_found",
            format!("vehicle {sysid} is not connected"),
        );
    };
    if let Some(reason) = cmd.invalid() {
        audit(&app, &op.username, sysid, &cmd, "rejected", Some(&reason)).await;
        return err(StatusCode::BAD_REQUEST, "invalid", reason);
    }
    if cmd.requires_confirm() {
        let verdict = body
            .confirm_token
            .as_deref()
            .map(|t| app.consume_confirm(t, sysid, cmd.name()));
        if let Some(reason) = confirm_failure(verdict) {
            audit(&app, &op.username, sysid, &cmd, "rejected", Some(reason)).await;
            return err(StatusCode::CONFLICT, "confirm_required", reason);
        }
    }
    if let Some((status, code, reason)) = precheck(&cmd, &vehicle) {
        audit(&app, &op.username, sysid, &cmd, "rejected", Some(&reason)).await;
        return err(status, code, reason);
    }
    let id = app.next_command_id();
    let (done_tx, done_rx) = oneshot::channel();
    let job = queued(&vehicle, cmd.clone(), done_tx);
    if app.queue.send(job).await.is_err() {
        return err(
            StatusCode::SERVICE_UNAVAILABLE,
            "link_lost",
            "command queue is not running",
        );
    }
    tokio::spawn(finish(app, op.username, id, sysid, cmd, done_rx));
    ok(Queued { id })
}

pub fn confirm_failure(verdict: Option<Result<(), ConfirmError>>) -> Option<&'static str> {
    match verdict {
        None => Some("confirm token required"),
        Some(Err(ConfirmError::Missing)) => Some("unknown confirm token"),
        Some(Err(ConfirmError::Expired)) => Some("confirm token expired"),
        Some(Err(ConfirmError::Mismatch)) => Some("confirm token is for another command"),
        Some(Ok(())) => None,
    }
}

/// Waits for the queue's verdict, records it and tells every client.
async fn finish(
    app: AppState,
    operator: String,
    id: u64,
    sysid: SysId,
    cmd: VehicleCommand,
    done: oneshot::Receiver<Outcome>,
) {
    let outcome = done.await.unwrap_or(Outcome::LinkClosed);
    let result = match &outcome {
        Outcome::Accepted => "ok",
        Outcome::Timeout => "timeout",
        _ => "failed",
    };
    audit(&app, &operator, sysid, &cmd, result, outcome.reason().as_deref()).await;
    let _ = app.tx.send(ServerMessage::CommandResult(CommandResult {
        id,
        sysid,
        cmd: cmd.name().to_string(),
        ok: outcome.ok(),
        reason: outcome.reason(),
        ts: crate::app::unix_ms(),
        mav_cmd: cmd.mav_cmd(),
    }));
}

async fn audit(
    app: &AppState,
    operator: &str,
    sysid: SysId,
    cmd: &VehicleCommand,
    result: &str,
    reason: Option<&str>,
) {
    let entry = AuditInput {
        operator,
        sysid: Some(sysid),
        target: "vehicle",
        command: cmd.name(),
        args: serde_json::to_string(cmd).ok(),
        result,
        reason: reason.map(str::to_string),
    };
    if let Err(e) = app.store.record_audit(entry).await {
        tracing::error!(error = %e, "audit write failed");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rgcs_core::VehicleKind;

    #[test]
    fn prechecks_follow_the_live_state() {
        let mut v = VehicleState::new(1, "UAV-01");
        assert!(precheck(&VehicleCommand::Arm, &v).is_none());
        assert_eq!(precheck(&VehicleCommand::Disarm, &v).unwrap().1, "rejected");
        v.armed = true;
        assert_eq!(precheck(&VehicleCommand::Arm, &v).unwrap().2, "already armed");
        assert!(precheck(&VehicleCommand::Rtl, &v).is_none());
        v.link = LinkStatus::Lost;
        assert_eq!(precheck(&VehicleCommand::Pause, &v).unwrap().1, "link_lost");
    }

    #[test]
    fn takeoff_needs_an_armed_vehicle_that_flies() {
        let takeoff = VehicleCommand::Takeoff { alt_rel: 30.0 };
        let mut v = VehicleState::new(1, "UAV-01");
        v.kind = VehicleKind::Copter;
        let (status, code, reason) = precheck(&takeoff, &v).unwrap();
        assert_eq!(
            (status, code, reason.as_str()),
            (StatusCode::CONFLICT, "rejected", "arm first")
        );
        v.armed = true;
        assert!(precheck(&takeoff, &v).is_none());
        v.kind = VehicleKind::Plane;
        assert!(precheck(&takeoff, &v).is_none());
        for kind in [VehicleKind::Rover, VehicleKind::Other] {
            v.kind = kind;
            let (status, code, _) = precheck(&takeoff, &v).unwrap();
            assert_eq!((status, code), (StatusCode::UNPROCESSABLE_ENTITY, "not_allowed"));
        }
        v.link = LinkStatus::Lost;
        assert_eq!(precheck(&takeoff, &v).unwrap().1, "link_lost");
    }

    #[test]
    fn the_queued_job_carries_the_airframe_and_mode() {
        let mut v = VehicleState::new(4, "VTOL-1");
        v.kind = VehicleKind::Plane;
        v.vtol = true;
        v.mode = "QLOITER".into();
        let (done, _rx) = oneshot::channel();
        let job = queued(&v, VehicleCommand::Takeoff { alt_rel: 40.0 }, done);
        assert_eq!(
            (job.sysid, job.kind, job.vtol, job.mode.as_str()),
            (4, VehicleKind::Plane, true, "QLOITER")
        );
        assert_eq!(job.cmd, VehicleCommand::Takeoff { alt_rel: 40.0 });
    }

    #[test]
    fn a_raw_arm_cannot_skip_the_confirm_token() {
        let arm = VehicleCommand::Other {
            mav_cmd: 400,
            params: [1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
        };
        assert_eq!(
            precheck(&arm, &VehicleState::new(1, "UAV-01")).unwrap().1,
            "not_allowed"
        );
    }

    #[test]
    fn confirm_verdicts_map_to_reasons() {
        assert_eq!(confirm_failure(None), Some("confirm token required"));
        assert_eq!(
            confirm_failure(Some(Err(ConfirmError::Expired))),
            Some("confirm token expired")
        );
        assert_eq!(confirm_failure(Some(Ok(()))), None);
    }
}
