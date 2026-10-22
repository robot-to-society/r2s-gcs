//! MAVLink side of RGCS: link URL parsing, per-system routing, ArduPilot telemetry decoding,
//! heartbeat-based link health and the "ask for streams only if they are missing" logic
//! ported from the MT11 Python app (`docs/spec/30-architecture.md` §4).

pub mod calib_frame;
pub mod command;
pub mod connection;
pub mod decode;
pub mod heartbeat;
pub mod inspector;
pub mod interval;
pub mod link;
pub mod log_frame;
pub mod mission_frame;
pub mod modes;
pub mod queue;
pub mod router;
pub mod statustext;

pub use calib_frame::calib_frame;
pub use command::{
    encode_guided_target, encode_log_request_data, encode_log_request_end, encode_log_request_list,
    encode_param_request_index, encode_param_request_list, encode_param_request_read, encode_param_set,
};
pub use connection::{run_link, LinkChannels};
pub use inspector::Inspector;
pub use link::{LinkUrl, LinkUrlError};
pub use log_frame::LogFrame;
pub use mission_frame::MissionFrame;
pub use queue::{run_queue, Ack, Outcome, Outgoing, QueuedCommand};
pub use router::{Clock, Router, RouterEvent, SystemTimeSample, GLOBAL_POSITION_INT_ID};
