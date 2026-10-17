//! Mission planning without I/O: `.waypoints` (QGC WPL 110) read / write and the Mission
//! Protocol upload / download state machines (`docs/spec/30-architecture.md`, addendum §5.2).

pub mod wpl;

pub use wpl::{from_wpl, to_wpl, WplError};
