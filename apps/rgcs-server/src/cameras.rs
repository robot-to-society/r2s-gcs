//! One camera driver per vehicle, built from `camera_profiles`; state changes are broadcast
//! as `camera_state` (on change and at least every second).

use std::collections::HashMap;
use std::net::Ipv4Addr;
#[cfg(any(test, feature = "sim"))]
use std::net::SocketAddr;
use std::sync::{Arc, RwLock};
use std::time::Duration;

use rgcs_camera::camera::GpsTime;
use rgcs_camera::{Camera, CameraError, NoneCamera, SiyiMt11};
use rgcs_core::{CameraCommand, CameraKind, CameraProfile, CameraSnapshot, ServerMessage, SysId};
use rgcs_store::Store;
use tokio::sync::{broadcast, Mutex};
use tokio::task::JoinHandle;

const RESEND_EVERY: Duration = Duration::from_secs(1);
/// Ruling 8: `camera_state` frames go out at most every 100 ms (10 Hz).
pub const STATE_MIN_GAP: Duration = Duration::from_millis(100);

/// How drivers are built. `Sim` ignores the profile host and connects to the simulator.
#[derive(Debug, Clone, Copy)]
pub enum CameraFactory {
    Real,
    #[cfg(any(test, feature = "sim"))]
    Sim(SocketAddr),
}

/// True while something else (an active ROI) owns the gimbal of that vehicle.
pub type GimbalOwned = Arc<dyn Fn(SysId) -> bool + Send + Sync>;

/// Builds the clock-sync GPS source of a vehicle (ruling 5).
pub type GpsTimeFactory = Arc<dyn Fn(SysId) -> Arc<dyn GpsTime> + Send + Sync>;

struct Entry {
    camera: Arc<dyn Camera>,
    forwarder: JoinHandle<()>,
    link_zero: JoinHandle<()>,
}

#[derive(Clone)]
pub struct CameraManager {
    store: Store,
    tx: broadcast::Sender<ServerMessage>,
    factory: CameraFactory,
    entries: Arc<Mutex<HashMap<SysId, Entry>>>,
    owned: Arc<RwLock<Option<GimbalOwned>>>,
    gps_time: Arc<RwLock<Option<GpsTimeFactory>>>,
}

impl CameraManager {
    pub fn new(store: Store, tx: broadcast::Sender<ServerMessage>, factory: CameraFactory) -> Self {
        Self {
            store,
            tx,
            factory,
            entries: Arc::new(Mutex::new(HashMap::new())),
            owned: Arc::new(RwLock::new(None)),
            gps_time: Arc::new(RwLock::new(None)),
        }
    }

    /// Installs the GPS time source drivers get when their profile has `clock_sync` on.
    pub fn set_gps_time(&self, f: GpsTimeFactory) {
        if let Ok(mut slot) = self.gps_time.write() {
            *slot = Some(f);
        }
    }

    fn gps_time_for(&self, profile: &CameraProfile) -> Option<Arc<dyn GpsTime>> {
        if !profile.clock_sync {
            return None;
        }
        self.gps_time
            .read()
            .ok()
            .and_then(|f| f.as_ref().map(|f| f(profile.sysid)))
    }

    /// Installs the check that suppresses the link-up zero while ROI owns the gimbal.
    pub fn set_gimbal_owned(&self, owned: GimbalOwned) {
        if let Ok(mut slot) = self.owned.write() {
            *slot = Some(owned);
        }
    }

    fn gimbal_owned(&self, sysid: SysId) -> bool {
        self.owned
            .read()
            .ok()
            .and_then(|o| o.as_ref().map(|f| f(sysid)))
            .unwrap_or(false)
    }

    fn build(&self, profile: &CameraProfile) -> Arc<dyn Camera> {
        let mt11 = match (profile.kind, self.factory) {
            (CameraKind::SiyiMt11, CameraFactory::Real) => {
                let host = profile.host.parse().unwrap_or(Ipv4Addr::new(192, 168, 144, 25));
                SiyiMt11::new(host, profile.port)
            }
            #[cfg(any(test, feature = "sim"))]
            (CameraKind::SiyiMt11, CameraFactory::Sim(addr)) => SiyiMt11::new(Ipv4Addr::LOCALHOST, addr.port()),
            // MAVLink cameras arrive with their driver (P3+); until then they behave as none.
            _ => return Arc::new(NoneCamera::default()),
        };
        match self.gps_time_for(profile) {
            Some(src) => Arc::new(mt11.with_gps_time(src)),
            None => Arc::new(mt11),
        }
    }

    /// The running driver of `sysid`, without spawning one.
    pub async fn get(&self, sysid: SysId) -> Option<Arc<dyn Camera>> {
        self.entries.lock().await.get(&sysid).map(|e| e.camera.clone())
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
        let link_zero = tokio::spawn(link_zero(self.clone(), sysid, camera.clone()));
        let mut entries = self.entries.lock().await;
        if let Some(old) = entries.insert(
            sysid,
            Entry {
                camera: camera.clone(),
                forwarder,
                link_zero,
            },
        ) {
            old.forwarder.abort();
            old.link_zero.abort();
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

/// Ruling 18 + I5: every time the link comes up (first connect of a driver and every
/// reconnect) the gimbal gets speed 0, unless an active ROI owns it. This covers a crash, a
/// stop while the link was down (its zero failed) and a manual cancel while offline.
async fn link_zero(manager: CameraManager, sysid: SysId, camera: Arc<dyn Camera>) {
    if !camera.caps().gimbal.is_some_and(|g| g.rate) {
        return;
    }
    let mut state = camera.state();
    loop {
        if state.wait_for(|s| s.connected).await.is_err() {
            return;
        }
        if !manager.gimbal_owned(sysid) {
            if let Err(e) = camera.send(CameraCommand::GimbalRate { yaw: 0, pitch: 0 }).await {
                tracing::warn!(sysid, error = %e, "link-up gimbal zero failed");
            }
        }
        if state.wait_for(|s| !s.connected).await.is_err() {
            return;
        }
    }
}

/// Broadcasts state changes at most every `STATE_MIN_GAP` (a burst collapses into its newest
/// state) and re-sends the current state each second (with the caps).
async fn forward(
    sysid: SysId,
    caps: rgcs_core::CameraCaps,
    mut rx: tokio::sync::watch::Receiver<rgcs_core::CameraState>,
    tx: broadcast::Sender<ServerMessage>,
) {
    loop {
        let state = rx.borrow_and_update().clone();
        let sent_at = tokio::time::Instant::now();
        let _ = tx.send(ServerMessage::CameraState {
            sysid,
            caps: caps.clone(),
            state,
        });
        tokio::select! {
            changed = rx.changed() => { if changed.is_err() { return; } }
            _ = tokio::time::sleep_until(sent_at + RESEND_EVERY) => {}
        }
        tokio::time::sleep_until(sent_at + STATE_MIN_GAP).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rgcs_core::{CameraCaps, CameraState};
    use tokio::time::Instant;

    /// Collects (arrival offset, zoom) of every `camera_state` frame until the channel closes.
    fn collect(mut rx: broadcast::Receiver<ServerMessage>, start: Instant) -> JoinHandle<Vec<(Duration, f32)>> {
        tokio::spawn(async move {
            let mut out = Vec::new();
            while let Ok(ServerMessage::CameraState { state, .. }) = rx.recv().await {
                out.push((start.elapsed(), state.zoom));
            }
            out
        })
    }

    #[tokio::test]
    async fn forward_caps_bursts_at_10_hz() {
        let (state_tx, state_rx) = tokio::sync::watch::channel(CameraState::disconnected(1.0));
        let (tx, rx) = broadcast::channel(256);
        let start = Instant::now();
        let frames = collect(rx, start);
        let task = tokio::spawn(forward(1, CameraCaps::none(), state_rx, tx));
        for i in 1..=50u16 {
            let next = CameraState {
                zoom: f32::from(i),
                ..state_tx.borrow().clone()
            };
            state_tx.send_replace(next);
            tokio::time::sleep_until(start + Duration::from_millis(4) * u32::from(i)).await;
        }
        tokio::time::sleep(Duration::from_millis(300)).await;
        task.abort();
        let _ = task.await;
        let frames = frames.await.expect("collector");
        let window = Duration::from_millis(200);
        let in_window = frames.iter().filter(|(at, _)| *at < window).count();
        assert!(in_window <= 4, "{in_window} frames in 200 ms: {frames:?}");
        assert_eq!(frames.last().map(|f| f.1), Some(50.0), "{frames:?}");
    }
}
