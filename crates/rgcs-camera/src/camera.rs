//! The driver interface the server talks to (spec 40 §1).

use async_trait::async_trait;
use rgcs_core::{CameraCaps, CameraCommand, CameraState};
use tokio::sync::watch;

use crate::CameraError;

#[async_trait]
pub trait Camera: Send + Sync {
    fn caps(&self) -> CameraCaps;
    /// Sends one command; `Unsupported` when the driver cannot, `NotConnected` while offline.
    async fn send(&self, cmd: CameraCommand) -> Result<(), CameraError>;
    /// The refusal `send(cmd)` would return right now, without sending anything (the server
    /// stops ROI for an AI select only when the select can go out). `Ok` = nothing known.
    async fn check(&self, _cmd: &CameraCommand) -> Result<(), CameraError> {
        Ok(())
    }
    fn state(&self) -> watch::Receiver<CameraState>;
    async fn connect(&self) -> Result<(), CameraError>;
    async fn disconnect(&self);
    /// Asks for a fresh gimbal attitude now (ROI rate mode polls it every step).
    async fn request_attitude(&self) -> Result<(), CameraError> {
        Err(CameraError::Unsupported("attitude"))
    }
}

/// The newest flight-controller UTC, already aged: `unix_us` was true `age_us` ago.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TimeSample {
    pub unix_us: u64,
    pub age_us: u64,
}

/// Where the driver gets GPS time for clock sync (the server reads the router's `SYSTEM_TIME`).
#[async_trait]
pub trait GpsTime: Send + Sync {
    async fn sample(&self) -> Option<TimeSample>;
}
