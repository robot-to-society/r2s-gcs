//! `rgcs-server`: MAVLink link → router → WebSocket telemetry, REST API and the static UI.
//!
//! The binary in `main.rs` only wires configuration and tasks together; everything else lives
//! here so integration tests can build the axum app in-process.

pub mod api;
pub mod app;
pub mod auth;
pub mod camera_api;
pub mod cameras;
pub mod commands;
pub mod config;
pub mod confirm;
pub mod guided;
pub mod params;
pub mod settings;
pub mod telemetry;
pub mod video;
pub mod video_api;
pub mod ws;
