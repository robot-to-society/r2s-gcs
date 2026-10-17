//! Browser joystick frames → safe gimbal rates (spec 70 §2). Pure state machine; the server
//! owns the clock and performs the actions.

pub mod gate;

pub use gate::{Action, Gate, DEADMAN_MS, MIN_RATE_INTERVAL_MS};
