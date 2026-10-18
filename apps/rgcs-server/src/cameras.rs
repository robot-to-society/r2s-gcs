//! One camera driver per vehicle, built from `camera_profiles`; state changes are broadcast
//! as `camera_state` (on change and at least every second).

use std::collections::HashMap;
use std::net::Ipv4Addr;
#[cfg(any(test, feature = "sim"))]
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use rgcs_camera::{Camera, CameraError, NoneCamera, SiyiMt11};
use rgcs_core::{CameraCommand, CameraKind, CameraProfile, CameraSnapshot, ServerMessage, SysId};
use rgcs_store::Store;
use tokio::sync::{broadcast, Mutex};
use tokio::task::JoinHandle;

const RESEND_EVERY: Duration = Duration::from_secs(1);

/// How drivers are built. `Sim` ignores the profile host and connects to the simulator.
#[derive(Debug, Clone, Copy)]
pub enum CameraFactory {
    Real,
    #[cfg(any(test, feature = "sim"))]
    Sim(SocketAddr),
}

struct Entry {
    camera: Arc<dyn Camera>,
    forwarder: JoinHandle<()>,
}

#[derive(Clone)]
pub struct CameraManager {
    store: Store,
    tx: broadcast::Sender<ServerMessage>,
    factory: CameraFactory,
    entries: Arc<Mutex<HashMap<SysId, Entry>>>,
}

impl CameraManager {
    pub fn new(store: Store, tx: broadcast::Sender<ServerMessage>, factory: CameraFactory) -> Self {
        Self {
            store,
            tx,
            factory,
            entries: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    fn build(&self, profile: &CameraProfile) -> Arc<dyn Camera> {
        match (profile.kind, self.factory) {
            (CameraKind::SiyiMt11, CameraFactory::Real) => {
                let host = profile.host.parse().unwrap_or(Ipv4Addr::new(192, 168, 144, 25));
                Arc::new(SiyiMt11::new(host, profile.port))
            }
            #[cfg(any(test, feature = "sim"))]
            (CameraKind::SiyiMt11, CameraFactory::Sim(addr)) => {
                Arc::new(SiyiMt11::new(Ipv4Addr::LOCALHOST, addr.port()))
            }
            // MAVLink cameras arrive with their driver (P3+); until then they behave as none.
            _ => Arc::new(NoneCamera::default()),
        }
    }

    /// The driver for `sysid`, spawning it from the stored profile on first use.
    pub async fn ensure(&self, sysid: SysId) -> Arc<dyn Camera> {
        if let Some(e) = self.entries.lock().await.get(&sysid) {
            return e.camera.clone();
        }
        let profile = self
            .store
            .camera_profile(sysid)
            .await
            .unwrap_or_else(|_| CameraProfile::default_for(sysid));
        self.install(sysid, &profile).await
    }

    async fn install(&self, sysid: SysId, profile: &CameraProfile) -> Arc<dyn Camera> {
        let camera = self.build(profile);
        if let Err(e) = camera.connect().await {
            tracing::warn!(sysid, error = %e, "camera connect failed");
        }
        let forwarder = tokio::spawn(forward(sysid, camera.caps(), camera.state(), self.tx.clone()));
        let mut entries = self.entries.lock().await;
        if let Some(old) = entries.insert(
            sysid,
            Entry {
                camera: camera.clone(),
                forwarder,
            },
        ) {
            old.forwarder.abort();
            old.camera.disconnect().await;
        }
        camera
    }

    /// Starts every driver with a saved, non-`none` profile (server boot).
    pub async fn ensure_all_configured(&self) {
        let sysids = self.store.camera_profile_sysids().await.unwrap_or_default();
        for sysid in sysids {
            self.ensure(sysid).await;
        }
    }

    /// Disconnects the current driver and spawns one from the (new) profile.
    pub async fn reload(&self, sysid: SysId) {
        let profile = self
            .store
            .camera_profile(sysid)
            .await
            .unwrap_or_else(|_| CameraProfile::default_for(sysid));
        self.install(sysid, &profile).await;
    }

    pub async fn snapshot(&self) -> Vec<CameraSnapshot> {
        let entries = self.entries.lock().await;
        let mut out: Vec<CameraSnapshot> = entries
            .iter()
            .map(|(sysid, e)| CameraSnapshot {
                sysid: *sysid,
                caps: e.camera.caps(),
                state: e.camera.state().borrow().clone(),
            })
            .collect();
        out.sort_by_key(|c| c.sysid);
        out
    }

    /// Capability-checked send (spec 70 §3).
    pub async fn send(&self, sysid: SysId, cmd: CameraCommand) -> Result<(), CameraError> {
        let camera = self.ensure(sysid).await;
        if !camera.caps().supports(&cmd) {
            return Err(CameraError::Unsupported(cmd.name()));
        }
        camera.send(cmd).await
    }
}

/// Broadcasts every state change and re-sends the current state each second (with the caps).
async fn forward(
    sysid: SysId,
    caps: rgcs_core::CameraCaps,
    mut rx: tokio::sync::watch::Receiver<rgcs_core::CameraState>,
    tx: broadcast::Sender<ServerMessage>,
) {
    loop {
        let state = rx.borrow_and_update().clone();
        let _ = tx.send(ServerMessage::CameraState {
            sysid,
            caps: caps.clone(),
            state,
        });
        tokio::select! {
            changed = rx.changed() => { if changed.is_err() { return; } }
            _ = tokio::time::sleep(RESEND_EVERY) => {}
        }
    }
}
