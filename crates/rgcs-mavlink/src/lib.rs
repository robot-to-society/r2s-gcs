//! MAVLink side of RGCS: link URL parsing, per-system routing, ArduPilot telemetry decoding,
//! heartbeat-based link health and the "ask for streams only if they are missing" logic
//! ported from the MT11 Python app (`docs/spec/30-architecture.md` §4).

pub mod command;
pub mod connection;
pub mod decode;
pub mod heartbeat;
pub mod interval;
pub mod link;
pub mod modes;
pub mod queue;
pub mod router;

pub use connection::{run_link, LinkChannels};
pub use link::{LinkUrl, LinkUrlError};
pub use queue::{run_queue, Ack, Outcome, Outgoing, QueuedCommand};
pub use router::{Clock, Router, RouterEvent};
