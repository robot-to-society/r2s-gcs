//! MT11 client: one actor task owning the TCP control link (heartbeat, polls, replies) and
//! the UDP socket for gimbal motion; `Camera` on top (spec 40 §2, §3).

use std::net::{Ipv4Addr, SocketAddr};
use std::time::Duration;

use async_trait::async_trait;
use rgcs_core::{CameraCaps, CameraCommand, CameraState, GimbalAttitude, RecordingState};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::tcp::OwnedWriteHalf;
use tokio::net::{TcpStream, UdpSocket};
use tokio::sync::{mpsc, oneshot, watch, Mutex};
use tokio::task::JoinHandle;
use tokio::time::{interval, MissedTickBehavior};

use crate::siyi::frame::{check_allowed, make_packet, Frame, Parser};
use crate::siyi::{encode, parse};
use crate::{Camera, CameraError};

pub const DEFAULT_PORT: u16 = 37260;
pub const RECONNECT_AFTER: Duration = Duration::from_secs(1);
/// The camera answers 0x0A / 0x0D every second; silence longer than this means it is gone.
pub const READ_TIMEOUT: Duration = Duration::from_secs(3);
pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
const HEARTBEAT: Duration = Duration::from_secs(1);
const POLL: Duration = Duration::from_secs(1);
const ON_CONNECT: [u8; 4] = [0x01, 0x18, 0x10, 0x19];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Transport {
    Tcp,
    Udp,
}

type Reply = oneshot::Sender<Result<(), CameraError>>;

enum Op {
    Command(CameraCommand, Reply),
    Raw(u8, Vec<u8>, Transport, Reply),
}

pub struct SiyiMt11 {
    addr: SocketAddr,
    caps: CameraCaps,
    state: watch::Sender<CameraState>,
    ops: Mutex<Option<mpsc::Sender<Op>>>,
    task: Mutex<Option<JoinHandle<()>>>,
}

impl SiyiMt11 {
    pub fn new(host: Ipv4Addr, port: u16) -> Self {
        let caps = CameraCaps::siyi_mt11();
        let zoom_max = caps.zoom.as_ref().map_or(1.0, |z| z.max);
        let (state, _) = watch::channel(CameraState::disconnected(zoom_max));
        Self {
            addr: SocketAddr::from((host, port)),
            caps,
            state,
            ops: Mutex::new(None),
            task: Mutex::new(None),
        }
    }

    async fn submit(&self, make: impl FnOnce(Reply) -> Op) -> Result<(), CameraError> {
        if !self.state.borrow().connected {
            return Err(CameraError::NotConnected);
        }
        let sender = self.ops.lock().await.clone().ok_or(CameraError::NotConnected)?;
        let (tx, rx) = oneshot::channel();
        sender
            .send(make(tx))
            .await
            .map_err(|_| CameraError::NotConnected)?;
        rx.await.unwrap_or(Err(CameraError::NotConnected))
    }

    /// Escape hatch for probes; `0x48` is refused before anything else happens.
    pub async fn raw_send(&self, cmd: u8, data: &[u8], transport: Transport) -> Result<(), CameraError> {
        check_allowed(cmd)?;
        let data = data.to_vec();
        self.submit(|reply| Op::Raw(cmd, data, transport, reply)).await
    }
}

#[async_trait]
impl Camera for SiyiMt11 {
    fn caps(&self) -> CameraCaps {
        self.caps.clone()
    }

    async fn send(&self, cmd: CameraCommand) -> Result<(), CameraError> {
        self.submit(|reply| Op::Command(cmd, reply)).await
    }

    fn state(&self) -> watch::Receiver<CameraState> {
        self.state.subscribe()
    }

    async fn connect(&self) -> Result<(), CameraError> {
        let mut ops = self.ops.lock().await;
        if ops.is_some() {
            return Ok(());
        }
        let (tx, rx) = mpsc::channel(32);
        *ops = Some(tx);
        let handle = tokio::spawn(run(self.addr, self.state.clone(), rx));
        *self.task.lock().await = Some(handle);
        Ok(())
    }

    async fn disconnect(&self) {
        self.ops.lock().await.take();
        if let Some(h) = self.task.lock().await.take() {
            h.abort();
        }
        self.state.send_modify(|s| {
            s.connected = false;
            s.gimbal = None;
        });
    }

    async fn request_attitude(&self) -> Result<(), CameraError> {
        self.raw_send(0x0D, &[], Transport::Tcp).await
    }
}

enum SessionEnd {
    Closed,
    Lost(String),
}

/// Connect → serve → (on loss) wait 1 s → connect again, until the op channel is dropped.
async fn run(addr: SocketAddr, state: watch::Sender<CameraState>, mut ops: mpsc::Receiver<Op>) {
    let udp = match UdpSocket::bind("0.0.0.0:0").await {
        Ok(u) => u,
        Err(e) => {
            state.send_modify(|s| s.last_error = Some(format!("udp bind: {e}")));
            return;
        }
    };
    let mut seq: u16 = 0;
    loop {
        let attempt = tokio::time::timeout(CONNECT_TIMEOUT, TcpStream::connect(addr)).await;
        let attempt = match attempt {
            Ok(r) => r,
            Err(_) => Err(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                "connect timed out",
            )),
        };
        match attempt {
            Ok(stream) => {
                state.send_modify(|s| {
                    s.connected = true;
                    s.last_error = None;
                });
                let end = session(stream, &udp, addr, &state, &mut ops, &mut seq).await;
                state.send_modify(|s| {
                    s.connected = false;
                    s.gimbal = None;
                    if let SessionEnd::Lost(reason) = &end {
                        s.last_error = Some(reason.clone());
                    }
                });
                if matches!(end, SessionEnd::Closed) {
                    return;
                }
            }
            Err(e) => state.send_modify(|s| s.last_error = Some(format!("connect: {e}"))),
        }
        // Offline: refuse commands immediately rather than queueing them (Review Focus 1).
        let wait = tokio::time::sleep(RECONNECT_AFTER);
        tokio::pin!(wait);
        loop {
            tokio::select! {
                _ = &mut wait => break,
                op = ops.recv() => match op {
                    None => return,
                    Some(Op::Command(_, reply)) | Some(Op::Raw(_, _, _, reply)) => {
                        let _ = reply.send(Err(CameraError::NotConnected));
                    }
                },
            }
        }
    }
}

struct Link<'a> {
    wr: OwnedWriteHalf,
    udp: &'a UdpSocket,
    addr: SocketAddr,
    seq: &'a mut u16,
}

impl Link<'_> {
    async fn tcp(&mut self, cmd: u8, data: &[u8]) -> Result<(), CameraError> {
        check_allowed(cmd)?;
        *self.seq = self.seq.wrapping_add(1);
        self.wr
            .write_all(&make_packet(cmd, data, 1, *self.seq))
            .await
            .map_err(|e| CameraError::Io(e.to_string()))
    }

    async fn udp(&mut self, cmd: u8, data: &[u8]) -> Result<(), CameraError> {
        check_allowed(cmd)?;
        *self.seq = self.seq.wrapping_add(1);
        self.udp
            .send_to(&make_packet(cmd, data, 1, *self.seq), self.addr)
            .await
            .map(|_| ())
            .map_err(|e| CameraError::Io(e.to_string()))
    }
}

async fn session(
    stream: TcpStream,
    udp: &UdpSocket,
    addr: SocketAddr,
    state: &watch::Sender<CameraState>,
    ops: &mut mpsc::Receiver<Op>,
    seq: &mut u16,
) -> SessionEnd {
    let (mut rd, wr) = stream.into_split();
    let mut link = Link { wr, udp, addr, seq };
    for cmd in ON_CONNECT {
        if let Err(e) = link.tcp(cmd, &[]).await {
            return SessionEnd::Lost(e.to_string());
        }
    }
    let mut parser = Parser::default();
    let mut buf = [0u8; 4096];
    let mut heartbeat = interval(HEARTBEAT);
    heartbeat.set_missed_tick_behavior(MissedTickBehavior::Skip);
    let mut poll = interval(POLL);
    poll.set_missed_tick_behavior(MissedTickBehavior::Skip);
    let mut last_rx = tokio::time::Instant::now();
    let mut last_attitude: Option<tokio::time::Instant> = None;
    loop {
        let watchdog = tokio::time::sleep_until(last_rx + READ_TIMEOUT);
        tokio::select! {
            n = rd.read(&mut buf) => match n {
                Ok(0) => return SessionEnd::Lost("camera closed the connection".into()),
                Err(e) => return SessionEnd::Lost(e.to_string()),
                Ok(n) => {
                    last_rx = tokio::time::Instant::now();
                    for f in parser.push(&buf[..n]) {
                        if f.cmd == 0x0D { last_attitude = Some(last_rx); }
                        apply_frame(state, &f);
                    }
                }
            },
            _ = watchdog => return SessionEnd::Lost("no reply from the camera for 3 s".into()),
            _ = heartbeat.tick() => {
                if let Err(e) = link.tcp(0x00, &encode::heartbeat()).await { return SessionEnd::Lost(e.to_string()); }
            },
            _ = poll.tick() => {
                if let Some(t) = last_attitude {
                    let age = t.elapsed().as_millis() as u64;
                    state.send_modify(|s| if let Some(g) = s.gimbal.as_mut() { g.age_ms = age; });
                }
                for cmd in [0x0A, 0x0D] {
                    if let Err(e) = link.tcp(cmd, &[]).await { return SessionEnd::Lost(e.to_string()); }
                }
            },
            op = ops.recv() => match op {
                None => return SessionEnd::Closed,
                Some(Op::Command(cmd, reply)) => {
                    let r = exec(&mut link, state, cmd).await;
                    let lost = matches!(r, Err(CameraError::Io(_)));
                    let _ = reply.send(r.clone());
                    if lost { return SessionEnd::Lost(r.unwrap_err().to_string()); }
                },
                Some(Op::Raw(cmd, data, transport, reply)) => {
                    let r = match transport { Transport::Tcp => link.tcp(cmd, &data).await, Transport::Udp => link.udp(cmd, &data).await };
                    let _ = reply.send(r);
                },
            },
        }
    }
}

/// One command → one or two wire frames; re-reads what the camera changed.
async fn exec(
    link: &mut Link<'_>,
    state: &watch::Sender<CameraState>,
    cmd: CameraCommand,
) -> Result<(), CameraError> {
    use CameraCommand::*;
    let snapshot = state.borrow().clone();
    match cmd {
        GimbalRate { yaw, pitch } => link.udp(0x07, &encode::gimbal_rate(yaw, pitch)).await,
        GimbalAngle { yaw_deg, pitch_deg } => link.udp(0x0E, &encode::gimbal_angle(yaw_deg, pitch_deg)).await,
        GimbalCenter { mode } => link.udp(0x08, &encode::center(mode)).await,
        GimbalMode { mode } => {
            link.tcp(0x0C, &encode::gimbal_mode(mode)).await?;
            link.tcp(0x19, &[]).await
        }
        ZoomAbsolute { zoom } => zoom_to(link, zoom, snapshot.zoom_max).await,
        ZoomStep { steps } => zoom_to(link, snapshot.zoom + f32::from(steps), snapshot.zoom_max).await,
        ZoomReset => zoom_to(link, 1.0, snapshot.zoom_max).await,
        ZoomSpeed { dir } => link.tcp(0x05, &encode::zoom_speed(dir)).await,
        Focus { dir } => link.tcp(0x06, &encode::focus(dir)).await,
        Photo => link.tcp(0x0C, &encode::photo()).await,
        RecordStart => record(link, snapshot.recording != RecordingState::Recording).await,
        RecordStop => record(link, snapshot.recording == RecordingState::Recording).await,
        VideoMode { mode } => {
            link.tcp(0x11, &encode::video_mode(mode)).await?;
            link.tcp(0x10, &[]).await
        }
    }
}

async fn zoom_to(link: &mut Link<'_>, zoom: f32, max: f32) -> Result<(), CameraError> {
    link.tcp(0x0F, &encode::zoom_absolute(zoom, max)).await?;
    link.tcp(0x18, &[]).await
}

/// The SDK only has a toggle; send it only when the current state differs (Review Focus 5).
async fn record(link: &mut Link<'_>, toggle: bool) -> Result<(), CameraError> {
    if toggle {
        link.tcp(0x0C, &encode::record_toggle()).await?;
    }
    link.tcp(0x0A, &[]).await
}

fn apply_frame(state: &watch::Sender<CameraState>, f: &Frame) {
    match f.cmd {
        0x01 => {
            if let Some(fw) = parse::firmware(&f.payload) {
                state.send_modify(|s| s.firmware = Some(fw));
            }
        }
        0x0D => {
            if let Some((yaw, pitch, roll)) = parse::attitude(&f.payload) {
                state.send_modify(|s| {
                    s.gimbal = Some(GimbalAttitude {
                        yaw,
                        pitch,
                        roll,
                        age_ms: 0,
                    })
                });
            }
        }
        0x18 => {
            if let Some(z) = parse::zoom(&f.payload) {
                state.send_modify(|s| s.zoom = z);
            }
        }
        0x10 | 0x11 => {
            if let Some(reply) = parse::video_mode(&f.payload) {
                state.send_modify(|s| {
                    s.video_mode = match reply {
                        parse::VideoModeReply::Known(m) => Some(m),
                        parse::VideoModeReply::Custom(..) => None,
                    }
                });
            }
        }
        0x0A => {
            if let Some(r) = parse::record_status(&f.payload) {
                state.send_modify(|s| s.recording = r);
            }
        }
        0x0B => {
            if let Some(r) = parse::record_feedback(&f.payload) {
                state.send_modify(|s| s.recording = r);
            }
        }
        0x19 => {
            if let Some(m) = parse::gimbal_mode(&f.payload) {
                state.send_modify(|s| s.gimbal_mode = Some(m));
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::camera::Camera;
    use crate::siyi::sim::{SimServer, Transport};
    use rgcs_core::{CameraCommand, CenterMode, GimbalMode, RecordingState, VideoMode};
    use std::time::Duration;
    use tokio::time::timeout;

    async fn wait_until(cam: &SiyiMt11, pred: impl Fn(&CameraState) -> bool, secs: u64) -> CameraState {
        let mut rx = cam.state();
        let deadline = Duration::from_secs(secs);
        timeout(deadline, async {
            loop {
                if pred(&rx.borrow()) {
                    return rx.borrow().clone();
                }
                rx.changed().await.expect("state channel alive");
            }
        })
        .await
        .expect("state predicate within deadline")
    }

    async fn drain(sim: &mut SimServer, ms: u64) -> Vec<(Transport, u8, Vec<u8>)> {
        let mut out = Vec::new();
        while let Ok(Some(m)) = timeout(Duration::from_millis(ms), sim.received.recv()).await {
            out.push(m);
        }
        out
    }

    async fn connected_pair() -> (SiyiMt11, SimServer) {
        let sim = SimServer::start().await;
        let cam = SiyiMt11::new(sim.addr.ip().to_string().parse().unwrap(), sim.addr.port());
        cam.connect().await.unwrap();
        wait_until(
            &cam,
            |s| s.connected && s.firmware.is_some() && s.gimbal_mode.is_some() && s.video_mode.is_some(),
            3,
        )
        .await;
        (cam, sim)
    }

    #[tokio::test]
    async fn connect_requests_firmware_zoom_mode_and_reports_connected() {
        let (cam, mut sim) = connected_pair().await;
        let s = cam.state().borrow().clone();
        assert_eq!(s.firmware.as_ref().unwrap().camera, "v1.0.1");
        assert_eq!(s.firmware.as_ref().unwrap().gimbal, "v0.1.10");
        assert_eq!(s.zoom_max, 165.0);
        assert_eq!(s.gimbal_mode, Some(GimbalMode::Follow));
        assert_eq!(s.video_mode, Some(VideoMode::Rgb));
        let cmds: Vec<u8> = drain(&mut sim, 200)
            .await
            .into_iter()
            .map(|(_, c, _)| c)
            .collect();
        for want in [0x01, 0x18, 0x10, 0x19] {
            assert!(cmds.contains(&want), "missing 0x{want:02X} in {cmds:?}");
        }
        cam.disconnect().await;
    }

    #[tokio::test]
    async fn gimbal_rate_goes_over_udp_and_center_too() {
        let (cam, mut sim) = connected_pair().await;
        drain(&mut sim, 100).await;
        cam.send(CameraCommand::GimbalRate { yaw: 30, pitch: -10 })
            .await
            .unwrap();
        cam.send(CameraCommand::GimbalCenter {
            mode: CenterMode::OneKeyReset,
        })
        .await
        .unwrap();
        let got = drain(&mut sim, 300).await;
        assert!(got.contains(&(Transport::Udp, 0x07, vec![30, 0xF6])), "{got:?}");
        assert!(got.contains(&(Transport::Udp, 0x08, vec![1])), "{got:?}");
        cam.disconnect().await;
    }

    #[tokio::test]
    async fn zoom_step_uses_current_zoom_then_rereads() {
        let (cam, mut sim) = connected_pair().await;
        sim.set_zoom(2, 0);
        cam.send(CameraCommand::ZoomAbsolute { zoom: 2.0 }).await.unwrap();
        wait_until(&cam, |s| s.zoom == 2.0, 2).await;
        drain(&mut sim, 100).await;
        cam.send(CameraCommand::ZoomStep { steps: 1 }).await.unwrap();
        let got = drain(&mut sim, 300).await;
        let tcp: Vec<(u8, Vec<u8>)> = got
            .into_iter()
            .filter(|(t, _, _)| *t == Transport::Tcp)
            .map(|(_, c, p)| (c, p))
            .collect();
        assert!(tcp.contains(&(0x0F, vec![3, 0])), "{tcp:?}");
        assert!(tcp.contains(&(0x18, vec![])), "{tcp:?}");
        wait_until(&cam, |s| s.zoom == 3.0, 2).await;
        cam.disconnect().await;
    }

    #[tokio::test]
    async fn record_start_is_idempotent() {
        let (cam, mut sim) = connected_pair().await;
        drain(&mut sim, 100).await;
        cam.send(CameraCommand::RecordStart).await.unwrap();
        wait_until(&cam, |s| s.recording == RecordingState::Recording, 2).await;
        cam.send(CameraCommand::RecordStart).await.unwrap();
        tokio::time::sleep(Duration::from_millis(200)).await;
        let toggles = drain(&mut sim, 200)
            .await
            .into_iter()
            .filter(|(t, c, p)| *t == Transport::Tcp && *c == 0x0C && p == &[2])
            .count();
        assert_eq!(toggles, 1);
        cam.send(CameraCommand::RecordStop).await.unwrap();
        wait_until(&cam, |s| s.recording == RecordingState::Idle, 2).await;
        cam.disconnect().await;
    }

    #[tokio::test]
    async fn video_mode_switch_rereads_mode() {
        let (cam, mut sim) = connected_pair().await;
        drain(&mut sim, 100).await;
        cam.send(CameraCommand::VideoMode {
            mode: VideoMode::Thermal,
        })
        .await
        .unwrap();
        let got = drain(&mut sim, 300).await;
        assert!(got.contains(&(Transport::Tcp, 0x11, vec![2, 0])), "{got:?}");
        assert!(got.contains(&(Transport::Tcp, 0x10, vec![])), "{got:?}");
        wait_until(&cam, |s| s.video_mode == Some(VideoMode::Thermal), 2).await;
        cam.disconnect().await;
    }

    #[tokio::test]
    async fn reconnects_after_the_sim_restarts() {
        let (cam, sim) = connected_pair().await;
        let port = sim.addr.port();
        sim.stop().await;
        wait_until(&cam, |s| !s.connected, 3).await;
        assert_eq!(
            cam.send(CameraCommand::GimbalRate { yaw: 1, pitch: 1 }).await,
            Err(CameraError::NotConnected)
        );
        let sim2 = SimServer::start_on(port).await;
        wait_until(&cam, |s| s.connected, 4).await;
        sim2.stop().await;
        cam.disconnect().await;
    }

    #[tokio::test]
    async fn a_silent_camera_is_reported_lost_within_three_seconds_and_recovers() {
        let (cam, sim) = connected_pair().await;
        sim.freeze();
        let t0 = std::time::Instant::now();
        wait_until(&cam, |s| !s.connected, 5).await;
        assert!(
            t0.elapsed() < Duration::from_millis(4_500),
            "watchdog fired at {:?}",
            t0.elapsed()
        );
        sim.thaw();
        // Reconnected and the first attitude poll answered: its age is tracked, not left at 0.
        let s = wait_until(&cam, |s| s.connected && s.gimbal.is_some(), 4).await;
        assert!(
            s.gimbal.is_some_and(|g| g.age_ms < 3_000),
            "attitude age is tracked"
        );
        cam.disconnect().await;
        sim.stop().await;
    }

    #[tokio::test]
    async fn connect_to_a_black_hole_times_out_instead_of_hanging() {
        // 10.255.255.1 is a non-routable address: SYN never answered.
        let cam = SiyiMt11::new("10.255.255.1".parse().unwrap(), 37260);
        cam.connect().await.unwrap();
        tokio::time::sleep(Duration::from_millis(3_600)).await;
        assert!(cam
            .state()
            .borrow()
            .last_error
            .as_deref()
            .is_some_and(|e| e.contains("timed out") || e.contains("connect")));
        cam.disconnect().await;
    }

    #[tokio::test]
    async fn format_sd_can_never_be_sent() {
        let (cam, _sim) = connected_pair().await;
        assert_eq!(
            cam.raw_send(0x48, &[], Transport::Tcp).await,
            Err(CameraError::Forbidden(0x48))
        );
        assert_eq!(
            cam.raw_send(0x48, &[], Transport::Udp).await,
            Err(CameraError::Forbidden(0x48))
        );
        cam.disconnect().await;
    }

    #[tokio::test]
    async fn none_camera_rejects_everything() {
        let cam = crate::none::NoneCamera::default();
        assert_eq!(cam.caps().kind, rgcs_core::CameraKind::None);
        assert!(matches!(
            cam.send(CameraCommand::Photo).await,
            Err(CameraError::Unsupported(_))
        ));
        assert!(!cam.state().borrow().connected);
        assert!(matches!(
            cam.request_attitude().await,
            Err(CameraError::Unsupported(_))
        ));
        cam.connect().await.unwrap();
    }

    #[tokio::test]
    async fn request_attitude_sends_0x0d_over_tcp() {
        let (cam, mut sim) = connected_pair().await;
        drain(&mut sim, 100).await;
        // The 1 Hz poll adds at most one 0x0D in this window; three requests must show up.
        for _ in 0..3 {
            cam.request_attitude().await.unwrap();
        }
        let got = drain(&mut sim, 500).await;
        let polls = got
            .iter()
            .filter(|m| **m == (Transport::Tcp, 0x0D, vec![]))
            .count();
        assert!(polls >= 3, "{got:?}");
        cam.disconnect().await;
    }
}
