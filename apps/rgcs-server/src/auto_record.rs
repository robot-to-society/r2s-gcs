//! ARM / DISARM auto record (spec 70 §3, ruling 12): a 2 Hz task watches `armed` per vehicle
//! and starts / stops the camera recording on the edges when the profile's `auto_record` is on.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use rgcs_core::{
    CameraCommand, CameraState, MessageSource, RecordingState, Severity, StorageInfo, StorageStatus, SysId,
    VehicleMessage,
};
use rgcs_store::audit::AuditInput;
use tokio::task::JoinHandle;

use crate::app::AppState;

/// How often `router.states()` is sampled.
pub const POLL_EVERY: Duration = Duration::from_millis(500);
/// Operator name in the audit log.
pub const OPERATOR: &str = "auto_record";
/// Message code the UI translates (like `comms_delay`).
pub const SD_WARNING_TEXT: &str = "sd_card_problem";
/// MAV_SEVERITY warning.
const SD_WARNING_SEVERITY: u8 = 4;

/// Ids for minted messages; the message log replaces them with its row id.
static NEXT_MESSAGE_ID: AtomicU64 = AtomicU64::new(crate::telemetry::LINK_MESSAGE_ID_BASE + (1 << 39));

/// The command for one observation. The first sight of a vehicle (`prev_armed: None`) is no edge.
pub fn decide(prev_armed: Option<bool>, armed: bool, enabled: bool, rec: RecordingState) -> Option<CameraCommand> {
    let prev = prev_armed?;
    match (enabled, prev, armed) {
        (true, false, true) if rec != RecordingState::Recording => Some(CameraCommand::RecordStart),
        (true, true, false) if rec == RecordingState::Recording => Some(CameraCommand::RecordStop),
        _ => None,
    }
}

/// True when the SD card cannot take the recording (warn the operator on ARM).
pub fn sd_warning(storage: Option<&StorageInfo>, rec: RecordingState) -> bool {
    let card_bad = storage.is_some_and(|s| s.status != StorageStatus::Ok);
    card_bad || matches!(rec, RecordingState::NoCard | RecordingState::CardError)
}

/// Spawns the 2 Hz watcher.
pub fn spawn(app: AppState) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut prev: HashMap<SysId, bool> = HashMap::new();
        loop {
            prev = tick(&app, &prev).await;
            tokio::time::sleep(POLL_EVERY).await;
        }
    })
}

/// One observation of every vehicle; returns the new `armed` map.
async fn tick(app: &AppState, prev: &HashMap<SysId, bool>) -> HashMap<SysId, bool> {
    let armed: Vec<(SysId, bool)> = {
        let router = app.router.lock().await;
        router.states().iter().map(|s| (s.sysid, s.armed)).collect()
    };
    for (sysid, now) in &armed {
        let before = prev.get(sysid).copied();
        if before.is_some_and(|b| b != *now) {
            on_edge(app, *sysid, before, *now).await;
        }
    }
    armed.into_iter().collect()
}

async fn on_edge(app: &AppState, sysid: SysId, prev: Option<bool>, armed: bool) {
    let Some(camera) = app.cameras.get(sysid).await else {
        return;
    };
    if !camera.caps().record {
        return;
    }
    let enabled = match app.store.camera_profile(sysid).await {
        Ok(p) => p.auto_record,
        Err(e) => {
            tracing::warn!(sysid, error = %e, "auto record: profile read failed");
            return;
        }
    };
    let snap: CameraState = camera.state().borrow().clone();
    let Some(cmd) = decide(prev, armed, enabled, snap.recording) else {
        return;
    };
    if cmd == CameraCommand::RecordStart && sd_warning(snap.storage.as_ref(), snap.recording) {
        warn_sd(app, sysid);
    }
    let result = app.cameras.send(sysid, cmd.clone()).await;
    if let Err(e) = &result {
        tracing::warn!(sysid, error = %e, cmd = cmd.name(), "auto record command failed");
    }
    audit(app, sysid, &cmd, result.err().map(|e| e.to_string())).await;
}

fn warn_sd(app: &AppState, sysid: SysId) {
    app.messages.submit(VehicleMessage::with_level(
        sysid,
        NEXT_MESSAGE_ID.fetch_add(1, Ordering::Relaxed),
        SD_WARNING_SEVERITY,
        SD_WARNING_TEXT.into(),
        crate::app::unix_ms(),
        MessageSource::System,
        Severity::Warn,
    ));
}

async fn audit(app: &AppState, sysid: SysId, cmd: &CameraCommand, error: Option<String>) {
    let entry = AuditInput {
        operator: OPERATOR,
        sysid: Some(sysid),
        target: "camera",
        command: cmd.name(),
        args: serde_json::to_string(cmd).ok(),
        result: if error.is_none() { "ok" } else { "rejected" },
        reason: error,
    };
    if let Err(e) = app.store.record_audit(entry).await {
        tracing::error!(error = %e, "audit write failed");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use RecordingState::*;

    fn storage(status: StorageStatus) -> StorageInfo {
        StorageInfo {
            status,
            fs: "exFAT".into(),
            total_gb: 128.0,
            free_gb: 56.3,
            free_pct: Some(44.0),
        }
    }

    #[test]
    fn decide_acts_on_edges_only() {
        assert_eq!(decide(None, true, true, Idle), None);
        assert_eq!(decide(Some(false), true, true, Idle), Some(CameraCommand::RecordStart));
        assert_eq!(decide(Some(false), true, true, Recording), None);
        assert_eq!(decide(Some(true), false, true, Recording), Some(CameraCommand::RecordStop));
        assert_eq!(decide(Some(false), true, false, Idle), None);
        assert_eq!(decide(Some(true), true, true, Idle), None);
        assert_eq!(decide(Some(true), false, true, Idle), None);
    }

    #[test]
    fn sd_warning_cases() {
        assert!(sd_warning(Some(&storage(StorageStatus::NotInserted)), Idle));
        assert!(sd_warning(Some(&storage(StorageStatus::Ok)), NoCard));
        assert!(sd_warning(Some(&storage(StorageStatus::Ok)), CardError));
        assert!(!sd_warning(Some(&storage(StorageStatus::Ok)), Idle));
        assert!(!sd_warning(None, Idle));
    }
}
