//! Domain types shared by every RGCS crate and exported to TypeScript with `ts-rs`.
//!
//! Nothing here depends on MAVLink, tokio or the web framework: these are the
//! values that cross the WebSocket / HTTP boundary (`docs/spec/50-api.md`).

pub mod camera;
pub mod command;
pub mod operator;
pub mod vehicle;
pub mod ws;

pub use camera::{
    AxisFunction, AxisMapping, ButtonFunction, ButtonMapping, CameraCaps, CameraCommand, CameraKind,
    CameraProfile, CameraSnapshot, CameraState, CenterMode, Deadman, Firmware, GimbalAttitude, GimbalCaps,
    GimbalInputProfile, GimbalMode, ProfileError, RecordingState, VideoMode, VideoSource, VideoSourceMode,
    VideoSourceStatus, ZoomCaps,
};
pub use command::{CommandResult, VehicleCommand};
pub use operator::Operator;
pub use vehicle::{
    diff, Battery, Gps, LinkStatus, SysId, VehicleKind, VehicleState, VehicleStateDiff, VehicleSummary,
};
pub use ws::{ClientMessage, ServerMessage, VehicleMessage, VideoSourceEntry};
