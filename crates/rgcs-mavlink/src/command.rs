//! [`VehicleCommand`] → MAVLink messages for ArduPilot, plus the ACK each one expects.

use mavlink::dialects::ardupilotmega::{MavCmd, MavMessage, COMMAND_LONG_DATA};
use rgcs_core::{VehicleCommand, VehicleKind};

use crate::modes::mode_number;

/// The mode a "pause" means per vehicle kind (ArduCopter BRAKE, Rover HOLD, Plane LOITER).
fn pause_mode(kind: VehicleKind) -> &'static str {
    match kind {
        VehicleKind::Copter => "BRAKE",
        VehicleKind::Rover => "HOLD",
        VehicleKind::Plane | VehicleKind::Other => "LOITER",
    }
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum EncodeError {
    #[error("unknown mode {0}")]
    UnknownMode(String),
    #[error("{0} is not implemented yet")]
    NotImplemented(&'static str),
}

/// One outgoing message and the MAV_CMD whose COMMAND_ACK completes it.
#[derive(Debug, Clone, PartialEq)]
pub struct Encoded {
    pub message: MavMessage,
    pub ack_for: MavCmd,
}

fn command_long(target: u8, command: MavCmd, params: [f32; 7]) -> MavMessage {
    MavMessage::COMMAND_LONG(COMMAND_LONG_DATA {
        param1: params[0],
        param2: params[1],
        param3: params[2],
        param4: params[3],
        param5: params[4],
        param6: params[5],
        param7: params[6],
        command,
        target_system: target,
        target_component: 1,
        confirmation: 0,
    })
}

fn set_mode(target: u8, kind: VehicleKind, name: &str) -> Result<Encoded, EncodeError> {
    let number = mode_number(kind, name).ok_or_else(|| EncodeError::UnknownMode(name.to_string()))?;
    // MAV_MODE_FLAG_CUSTOM_MODE_ENABLED = 1, custom mode in param2.
    Ok(Encoded {
        message: command_long(
            target,
            MavCmd::MAV_CMD_DO_SET_MODE,
            [1.0, number as f32, 0.0, 0.0, 0.0, 0.0, 0.0],
        ),
        ack_for: MavCmd::MAV_CMD_DO_SET_MODE,
    })
}

fn simple(target: u8, command: MavCmd, params: [f32; 7]) -> Encoded {
    Encoded {
        message: command_long(target, command, params),
        ack_for: command,
    }
}

/// Encode a command for `target`. `kind` picks the mode table.
pub fn encode(cmd: &VehicleCommand, kind: VehicleKind, target: u8) -> Result<Encoded, EncodeError> {
    use VehicleCommand::*;
    let z = [0.0; 7];
    match cmd {
        Pause => set_mode(target, kind, pause_mode(kind)),
        Resume | MissionResume => set_mode(target, kind, "AUTO"),
        Rtl => set_mode(target, kind, "RTL"),
        Land => set_mode(target, kind, "LAND"),
        SetMode { mode } => set_mode(target, kind, mode),
        MissionStart => Ok(simple(target, MavCmd::MAV_CMD_MISSION_START, z)),
        Arm => Ok(simple(
            target,
            MavCmd::MAV_CMD_COMPONENT_ARM_DISARM,
            [1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
        )),
        Disarm => Ok(simple(target, MavCmd::MAV_CMD_COMPONENT_ARM_DISARM, z)),
        ChangeSpeed { mps } => {
            // type 1 = ground speed, -1 throttle = unchanged
            Ok(simple(
                target,
                MavCmd::MAV_CMD_DO_CHANGE_SPEED,
                [1.0, *mps, -1.0, 0.0, 0.0, 0.0, 0.0],
            ))
        }
        ChangeAlt { .. } => Err(EncodeError::NotImplemented("change_alt")),
        Other { mav_cmd, params } => {
            let command = mav_cmd_from_u16(*mav_cmd).ok_or(EncodeError::NotImplemented("unknown MAV_CMD"))?;
            Ok(simple(target, command, *params))
        }
    }
}

/// MAV_CMD number → dialect enum (the generated enum derives `FromPrimitive`).
fn mav_cmd_from_u16(n: u16) -> Option<MavCmd> {
    <MavCmd as num_traits::FromPrimitive>::from_u32(u32::from(n))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn params(e: &Encoded) -> (MavCmd, f32, f32) {
        match &e.message {
            MavMessage::COMMAND_LONG(d) => (d.command, d.param1, d.param2),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn arm_and_disarm() {
        let arm = encode(&VehicleCommand::Arm, VehicleKind::Copter, 1).unwrap();
        assert_eq!(params(&arm), (MavCmd::MAV_CMD_COMPONENT_ARM_DISARM, 1.0, 0.0));
        assert_eq!(arm.ack_for, MavCmd::MAV_CMD_COMPONENT_ARM_DISARM);
        let disarm = encode(&VehicleCommand::Disarm, VehicleKind::Copter, 1).unwrap();
        assert_eq!(params(&disarm).1, 0.0);
    }

    #[test]
    fn modes_use_the_vehicle_table() {
        let rtl = encode(&VehicleCommand::Rtl, VehicleKind::Copter, 1).unwrap();
        assert_eq!(params(&rtl), (MavCmd::MAV_CMD_DO_SET_MODE, 1.0, 6.0));
        let hold = encode(&VehicleCommand::Pause, VehicleKind::Rover, 1).unwrap();
        assert_eq!(params(&hold).2, 4.0);
        let brake = encode(&VehicleCommand::Pause, VehicleKind::Copter, 1).unwrap();
        assert_eq!(params(&brake).2, 17.0);
        let auto = encode(
            &VehicleCommand::SetMode { mode: "AUTO".into() },
            VehicleKind::Rover,
            7,
        )
        .unwrap();
        assert_eq!(params(&auto).2, 10.0);
        assert_eq!(
            encode(
                &VehicleCommand::SetMode { mode: "WARP".into() },
                VehicleKind::Copter,
                1
            ),
            Err(EncodeError::UnknownMode("WARP".into()))
        );
    }

    #[test]
    fn speed_mission_and_other() {
        let s = encode(&VehicleCommand::ChangeSpeed { mps: 8.5 }, VehicleKind::Copter, 1).unwrap();
        assert_eq!(params(&s), (MavCmd::MAV_CMD_DO_CHANGE_SPEED, 1.0, 8.5));
        let m = encode(&VehicleCommand::MissionStart, VehicleKind::Copter, 1).unwrap();
        assert_eq!(params(&m).0, MavCmd::MAV_CMD_MISSION_START);
        let o = encode(
            &VehicleCommand::Other {
                mav_cmd: 20,
                params: [0.0; 7],
            },
            VehicleKind::Copter,
            1,
        )
        .unwrap();
        assert_eq!(params(&o).0, MavCmd::MAV_CMD_NAV_RETURN_TO_LAUNCH);
        assert!(encode(
            &VehicleCommand::ChangeAlt { alt_rel: 1.0 },
            VehicleKind::Copter,
            1
        )
        .is_err());
        assert!(encode(
            &VehicleCommand::Other {
                mav_cmd: 65535,
                params: [0.0; 7]
            },
            VehicleKind::Copter,
            1
        )
        .is_err());
    }
}
