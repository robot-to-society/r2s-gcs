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
    fn state(&self) -> watch::Receiver<CameraState>;
    async fn connect(&self) -> Result<(), CameraError>;
    async fn disconnect(&self);
    /// Asks for a fresh gimbal attitude now (ROI rate mode polls it every step).
    async fn request_attitude(&self) -> Result<(), CameraError> {
        Err(CameraError::Unsupported("attitude"))
    }
}
