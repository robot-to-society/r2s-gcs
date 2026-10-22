//! WebSocket frames (`docs/spec/50-api.md` §3). Every frame is `{"t": "<type>", ...}`.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::camera::{CameraCaps, CameraSnapshot, CameraState, Deadman, VideoSourceStatus};
use crate::command::CommandResult;
use crate::log::{ackable, severity_of_statustext, LogEntry, MessageSource, Severity};
use crate::logbook::{Flight, LogFetchProgress};
use crate::mission::{MissionProgress, MissionTransfer};
use crate::params::ParamProgress;
use crate::roi::RoiStatus;
use crate::vehicle::{SysId, VehicleState, VehicleStateDiff};

/// A STATUSTEXT or a link event shown in the vehicle's message list.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct VehicleMessage {
    pub sysid: SysId,
    #[ts(type = "number")]
    pub id: u64,
    /// MAV_SEVERITY value (0 emergency … 7 debug).
    pub severity: u8,
    pub text: String,
    /// Unix time in milliseconds.
    #[ts(type = "number")]
    pub ts: u64,
    /// 重要度 (spec 10 §1): from `severity` for STATUSTEXT, fixed per code for link events.
    pub level: Severity,
    pub source: MessageSource,
    /// Warnings and errors from the vehicle need a 確認 (spec 10 §3.3).
    pub ackable: bool,
    pub acked_by: Option<String>,
    #[ts(type = "number | null")]
    pub acked_at: Option<u64>,
}

impl VehicleMessage {
    /// A STATUSTEXT (level from the MAV_SEVERITY).
    pub fn new(sysid: SysId, id: u64, severity: u8, text: String, ts: u64, source: MessageSource) -> Self {
        Self::with_level(
            sysid,
            id,
            severity,
            text,
            ts,
            source,
            severity_of_statustext(severity),
        )
    }

    pub fn with_level(
        sysid: SysId,
        id: u64,
        severity: u8,
        text: String,
        ts: u64,
        source: MessageSource,
        level: Severity,
    ) -> Self {
        Self {
            sysid,
            id,
            severity,
            text,
            ts,
            level,
            source,
            ackable: ackable(source, level),
            acked_by: None,
            acked_at: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct VideoSourceEntry {
    pub sysid: SysId,
    pub status: VideoSourceStatus,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "t", rename_all = "snake_case")]
#[ts(export, rename_all = "snake_case")]
#[allow(clippy::large_enum_variant)] // camera_state frames are the big, frequent variant
pub enum ServerMessage {
    Snapshot {
        vehicles: Vec<VehicleState>,
        cameras: Vec<CameraSnapshot>,
        video_sources: Vec<VideoSourceEntry>,
    },
    /// Caps travel with every state frame so a client never needs a fresh snapshot to learn
    /// that a camera was (re)configured.
    CameraState {
        sysid: SysId,
        caps: CameraCaps,
        state: CameraState,
    },
    VideoSource {
        sysid: SysId,
        status: VideoSourceStatus,
    },
    InputState {
        deadman: Deadman,
    },
    /// `MISSION_CURRENT` of a vehicle (on change + 1 Hz re-send).
    MissionProgress {
        sysid: SysId,
        progress: MissionProgress,
    },
    /// A mission write in progress (`PUT .../mission`): per item sent, then per item read back.
    MissionTransfer {
        sysid: SysId,
        transfer: MissionTransfer,
    },
    /// Full parameter download progress (every 25 values, on completion, on refresh).
    ParamProgress {
        sysid: SysId,
        progress: ParamProgress,
    },
    /// A flight draft was created or its landing time moved (every DISARM, addendum §5.6).
    FlightDraftCreated {
        sysid: SysId,
        flight: Flight,
    },
    /// A calibration session changed (点検・校正, spec 10 §7).
    Calibration {
        sysid: SysId,
        status: crate::calibration::CalibStatus,
    },
    /// DataFlash fetch progress (every 64 KB and at the end).
    LogFetchProgress {
        sysid: SysId,
        progress: LogFetchProgress,
    },
    /// GPS ROI loop state: 2 Hz while active, plus one final frame on stop (spec 50 §3.1).
    RoiStatus {
        sysid: SysId,
        status: RoiStatus,
    },
    Telemetry {
        sysid: SysId,
        diff: VehicleStateDiff,
    },
    VehicleMessage(VehicleMessage),
    CommandResult(CommandResult),
    /// A command result or system notice recorded in the message log (the footer's feed).
    LogEntry(LogEntry),
    /// A warning / error was acknowledged (spec 50 §3.1).
    MessageAck {
        sysid: SysId,
        #[ts(type = "number")]
        id: i64,
        by: String,
        #[ts(type = "number")]
        ts: u64,
    },
    VehicleDiscovered {
        sysid: SysId,
    },
    VehicleLost {
        sysid: SysId,
    },
    Error {
        code: String,
        message: String,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "t", rename_all = "snake_case")]
#[ts(export, rename_all = "snake_case")]
pub enum ClientMessage {
    /// Gimbal speed from the browser-side joystick, ≤20 Hz, −100..100 (spec 50 §3.2).
    GimbalRate {
        sysid: SysId,
        yaw: i8,
        pitch: i8,
        seq: u32,
    },
    /// 1 Hz deadman heartbeat for joystick input.
    InputHb { sysid: SysId },
    /// Which vehicle receives joystick input from now on.
    Select { sysid: SysId },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_carry_the_type_tag() {
        let json = serde_json::to_string(&ServerMessage::VehicleDiscovered { sysid: 1 }).unwrap();
        assert_eq!(json, r#"{"t":"vehicle_discovered","sysid":1}"#);
        let telemetry = ServerMessage::Telemetry {
            sysid: 1,
            diff: VehicleStateDiff::default(),
        };
        assert_eq!(
            serde_json::to_string(&telemetry).unwrap(),
            r#"{"t":"telemetry","sysid":1,"diff":{}}"#
        );
    }

    #[test]
    fn camera_state_carries_caps_and_snapshot_carries_video_sources() {
        use crate::camera::{CameraCaps, CameraState, VideoSource, VideoSourceMode, VideoSourceStatus};
        let frame = ServerMessage::CameraState {
            sysid: 1,
            caps: CameraCaps::none(),
            state: CameraState::disconnected(0.0),
        };
        let json = serde_json::to_value(&frame).unwrap();
        assert_eq!(json["t"], "camera_state");
        assert_eq!(json["caps"]["kind"], "none");
        let snap = ServerMessage::Snapshot {
            vehicles: vec![],
            cameras: vec![],
            video_sources: vec![VideoSourceEntry {
                sysid: 1,
                status: VideoSourceStatus {
                    mode: VideoSourceMode::Auto,
                    source: VideoSource::None,
                    scanning: true,
                    probe_ok: false,
                    whep_path: "mt11".into(),
                },
            }],
        };
        let json = serde_json::to_value(&snap).unwrap();
        assert_eq!(json["video_sources"][0]["sysid"], 1);
        assert_eq!(json["video_sources"][0]["status"]["source"], "none");
    }

    #[test]
    fn param_progress_frame_shape() {
        let f = ServerMessage::ParamProgress {
            sysid: 1,
            progress: crate::ParamProgress {
                received: 25,
                total: Some(1200),
                complete: false,
                downloading: true,
            },
        };
        let json = serde_json::to_value(&f).unwrap();
        assert_eq!(json["t"], "param_progress");
        assert_eq!(json["progress"]["received"], 25);
    }

    #[test]
    fn mission_progress_frame_shape() {
        let f = ServerMessage::MissionProgress {
            sysid: 1,
            progress: crate::MissionProgress {
                seq: 3,
                total: Some(21),
            },
        };
        let json = serde_json::to_value(&f).unwrap();
        assert_eq!(
            json,
            serde_json::json!({"t":"mission_progress","sysid":1,"progress":{"seq":3,"total":21}})
        );
    }

    #[test]
    fn client_frames_parse() {
        let m: ClientMessage =
            serde_json::from_str(r#"{"t":"gimbal_rate","sysid":1,"yaw":-37,"pitch":12,"seq":5}"#).unwrap();
        assert_eq!(
            m,
            ClientMessage::GimbalRate {
                sysid: 1,
                yaw: -37,
                pitch: 12,
                seq: 5
            }
        );
        assert!(serde_json::from_str::<ClientMessage>(r#"{"t":"nope"}"#).is_err());
    }
}
