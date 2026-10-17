//! `POST …/confirm` and `POST …/command`: validation, confirm tokens, pre-checks against the
//! live state, audit, then hand-off to the command queue (spec 50 §2.2, 70 §1).

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::Json;
use rgcs_core::{CommandResult, LinkStatus, ServerMessage, SysId, VehicleCommand, VehicleState};
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
        _ => None,
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
    let job = QueuedCommand {
        sysid,
        kind: vehicle.kind,
        cmd: cmd.clone(),
        done: done_tx,
    };
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

fn confirm_failure(verdict: Option<Result<(), ConfirmError>>) -> Option<&'static str> {
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
    fn confirm_verdicts_map_to_reasons() {
        assert_eq!(confirm_failure(None), Some("confirm token required"));
        assert_eq!(
            confirm_failure(Some(Err(ConfirmError::Expired))),
            Some("confirm token expired")
        );
        assert_eq!(confirm_failure(Some(Ok(()))), None);
    }
}
