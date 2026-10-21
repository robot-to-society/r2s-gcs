//! Vehicle commands accepted by `POST /api/vehicles/{sysid}/command` and their results.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::vehicle::SysId;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "cmd", content = "args", rename_all = "snake_case")]
#[ts(export, rename_all = "snake_case")]
pub enum VehicleCommand {
    Pause,
    Resume,
    Rtl,
    Land,
    ChangeAlt {
        alt_rel: f32,
    },
    ChangeSpeed {
        mps: f32,
    },
    SetMode {
        mode: String,
    },
    MissionStart,
    MissionResume,
    Arm,
    Disarm,
    /// Any other MAV_CMD, sent as COMMAND_LONG.
    Other {
        mav_cmd: u16,
        params: [f32; 7],
    },
}

impl VehicleCommand {
    /// Commands that need a confirm token (spec 70 §1). Mode change, RTL and land do not.
    pub fn requires_confirm(&self) -> bool {
        matches!(self, Self::Arm | Self::Disarm | Self::MissionStart)
    }

    /// Stable name used in the audit log and in `CommandResult.cmd`.
    pub fn name(&self) -> &'static str {
        match self {
            Self::Pause => "pause",
            Self::Resume => "resume",
            Self::Rtl => "rtl",
            Self::Land => "land",
            Self::ChangeAlt { .. } => "change_alt",
            Self::ChangeSpeed { .. } => "change_speed",
            Self::SetMode { .. } => "set_mode",
            Self::MissionStart => "mission_start",
            Self::MissionResume => "mission_resume",
            Self::Arm => "arm",
            Self::Disarm => "disarm",
            Self::Other { .. } => "other",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CommandResult {
    #[ts(type = "number")]
    pub id: u64,
    pub sysid: SysId,
    pub cmd: String,
    pub ok: bool,
    pub reason: Option<String>,
    /// Unix time in milliseconds.
    #[ts(type = "number")]
    pub ts: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dangerous_commands_require_confirmation() {
        assert!(VehicleCommand::Arm.requires_confirm());
        assert!(VehicleCommand::Disarm.requires_confirm());
        assert!(VehicleCommand::MissionStart.requires_confirm());
        assert!(!VehicleCommand::SetMode { mode: "AUTO".into() }.requires_confirm());
        assert!(!VehicleCommand::Rtl.requires_confirm());
        assert!(!VehicleCommand::Land.requires_confirm());
        assert!(!VehicleCommand::Pause.requires_confirm());
        assert!(!VehicleCommand::ChangeAlt { alt_rel: 50.0 }.requires_confirm());
    }

    #[test]
    fn json_shape_matches_the_api() {
        let v: VehicleCommand =
            serde_json::from_str(r#"{"cmd":"change_alt","args":{"alt_rel":80}}"#).unwrap();
        assert_eq!(v, VehicleCommand::ChangeAlt { alt_rel: 80.0 });
        let a: VehicleCommand = serde_json::from_str(r#"{"cmd":"arm"}"#).unwrap();
        assert_eq!(a, VehicleCommand::Arm);
        assert_eq!(a.name(), "arm");
    }
}
