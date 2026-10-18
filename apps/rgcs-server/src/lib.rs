//! `rgcs-server`: MAVLink link → router → WebSocket telemetry, REST API and the static UI.
//!
//! The binary in `main.rs` only wires configuration and tasks together; everything else lives
//! here so integration tests can build the axum app in-process.

pub mod api;
pub mod app;
pub mod auth;
pub mod branding;
pub mod camera_api;
pub mod cameras;
pub mod commands;
pub mod config;
pub mod confirm;
pub mod export_api;
pub mod export_csv;
pub mod flight_api;
pub mod flights;
pub mod guided;
pub mod input_api;
pub mod logbook_api;
pub mod logs;
pub mod logs_api;
pub mod message_log;
pub mod messages_api;
pub mod mission_api;
pub mod missions;
pub mod param_api;
pub mod params;
pub mod pdf;
pub mod present_api;
pub mod settings;
pub mod telemetry;
pub mod ui_embed;
pub mod video;
pub mod video_api;
pub mod ws;

/// Build id baked in by `scripts/build-pi.sh` (`RGCS_BUILD=<git sha>[-dirty]`); `dev` otherwise.
pub const BUILD: &str = match option_env!("RGCS_BUILD") {
    Some(b) => b,
    None => "dev",
};
