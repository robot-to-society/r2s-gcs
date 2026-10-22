//! `/ws`: snapshot on connect, then every broadcast frame. Client frames are parsed and,
//! until the input gate lands (M2), answered with an error frame.

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use futures::{SinkExt, StreamExt};
use rgcs_core::{CameraCommand, ClientMessage, ServerMessage, SysId};
use rgcs_input::{Action, Gate};
use tokio::sync::broadcast;
use tracing::warn;

use crate::app::{unix_ms, AppState};
use crate::auth::AuthUser;
use crate::roi::ManualVerdict;

/// Client frames are small control messages; anything bigger is not ours.
/// Deadman check cadence: 250 ms keeps the worst case under 1.75 s (spec 70 §2: 1.5 s).
const DEADMAN_TICK: std::time::Duration = std::time::Duration::from_millis(250);
const MAX_MESSAGE_SIZE: usize = 16 * 1024;

pub async fn handler(
    ws: WebSocketUpgrade,
    headers: HeaderMap,
    State(app): State<AppState>,
    AuthUser(_op): AuthUser,
) -> Response {
    let origin = headers.get("origin").and_then(|v| v.to_str().ok());
    let host = headers.get("host").and_then(|v| v.to_str().ok());
    if !origin_allowed(origin, host) {
        return (StatusCode::FORBIDDEN, "origin not allowed").into_response();
    }
    ws.max_message_size(MAX_MESSAGE_SIZE)
        .on_upgrade(move |socket| session(socket, app))
        .into_response()
}

/// Same-origin only: the UI is served by this server, so a browser `Origin` must match the
/// `Host` it connected to. Non-browser clients send no `Origin` and are allowed (spec 70 §5).
pub fn origin_allowed(origin: Option<&str>, host: Option<&str>) -> bool {
    match (origin, host) {
        (None, _) => true,
        (Some(o), Some(h)) => {
            let authority = o
                .strip_prefix("http://")
                .or_else(|| o.strip_prefix("https://"))
                .unwrap_or("");
            !authority.is_empty() && authority.eq_ignore_ascii_case(h)
        }
        (Some(_), None) => false,
    }
}

async fn session(socket: WebSocket, app: AppState) {
    let (mut sink, mut stream) = socket.split();
    // Subscribe before taking the snapshot so no frame is lost in between.
    let mut rx = app.tx.subscribe();
    if send(&mut sink, &snapshot(&app).await).await.is_err() {
        return;
    }
    let mut gate = Gate::default();
    let mut deadman = tokio::time::interval(DEADMAN_TICK);
    deadman.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        tokio::select! {
            frame = rx.recv() => match frame {
                Ok(f) => { if send(&mut sink, &f).await.is_err() { break; } }
                Err(broadcast::error::RecvError::Lagged(n)) => {
                    // Diffs were dropped: the client's state is stale until it gets a full snapshot.
                    warn!(skipped = n, "ws client lagged, resyncing");
                    if send(&mut sink, &snapshot(&app).await).await.is_err() { break; }
                }
                Err(broadcast::error::RecvError::Closed) => break,
            },
            incoming = stream.next() => match incoming {
                Some(Ok(Message::Text(text))) => {
                    let (next, replies) = handle_client(&gate, &app, &text, unix_ms()).await;
                    gate = next;
                    for reply in replies {
                        if send(&mut sink, &reply).await.is_err() { break; }
                    }
                }
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                Some(Ok(_)) => {}
            },
            _ = deadman.tick() => {
                let (next, actions) = gate.tick(unix_ms());
                gate = next;
                for reply in perform(&app, actions).await {
                    if send(&mut sink, &reply).await.is_err() { break; }
                }
            }
        }
    }
    perform(&app, gate.close()).await;
}

/// Parses a client frame; a malformed one becomes the `error` reply to send back.
pub fn parse_client(text: &str) -> Result<ClientMessage, Box<ServerMessage>> {
    serde_json::from_str::<ClientMessage>(text).map_err(|e| {
        Box::new(ServerMessage::Error {
            code: "validation".into(),
            message: e.to_string(),
        })
    })
}

/// Runs one client frame through the gate and performs its actions; returns the replies.
pub async fn handle_client(
    gate: &Gate,
    app: &AppState,
    text: &str,
    now_ms: u64,
) -> (Gate, Vec<ServerMessage>) {
    let msg = match parse_client(text) {
        Ok(m) => m,
        Err(reply) => return (gate.clone(), vec![*reply]),
    };
    let (next, actions) = match msg {
        ClientMessage::GimbalRate {
            sysid, yaw, pitch, ..
        } => gate.on_gimbal_rate(sysid, i16::from(yaw), i16::from(pitch), now_ms),
        ClientMessage::InputHb { sysid } => gate.on_hb(sysid, now_ms),
        ClientMessage::Select { sysid } => gate.on_select(sysid, now_ms),
    };
    (next, perform(app, actions).await)
}

/// Forwards / zeroes go to the camera (errors are logged, never echoed); replies come back.
async fn perform(app: &AppState, actions: Vec<Action>) -> Vec<ServerMessage> {
    let mut replies = Vec::new();
    for a in actions {
        match a {
            Action::Forward { sysid, yaw, pitch } => forward(app, sysid, yaw, pitch).await,
            Action::Zero { sysid } => {
                if app.roi.on_zero(sysid) == ManualVerdict::Forward {
                    rate(app, sysid, 0, 0).await
                }
            }
            Action::Reply(m) => replies.push(*m),
        }
    }
    replies
}

/// While ROI owns the gimbal, zeros and small speeds are dropped and a large speed cancels
/// ROI first; `on_manual_rate` returns only after the cancel's zero went out (Review Focus 4).
async fn forward(app: &AppState, sysid: SysId, yaw: i8, pitch: i8) {
    if (yaw, pitch) == (0, 0) {
        if app.roi.on_zero(sysid) == ManualVerdict::Forward {
            rate(app, sysid, 0, 0).await;
        }
        return;
    }
    let was_active = app.roi.active_target(sysid).is_some();
    if app.roi.on_manual_rate(sysid, yaw, pitch).await == ManualVerdict::Drop {
        return;
    }
    if was_active && app.roi.active_target(sysid).is_none() {
        crate::roi_api::audit_manual_stop(app, "joystick", sysid, "manual_input").await;
    }
    rate(app, sysid, yaw, pitch).await;
}

async fn rate(app: &AppState, sysid: SysId, yaw: i8, pitch: i8) {
    if let Err(e) = app
        .cameras
        .send(sysid, CameraCommand::GimbalRate { yaw, pitch })
        .await
    {
        tracing::debug!(sysid, error = %e, "gimbal rate not delivered");
    }
}

pub async fn snapshot(app: &AppState) -> ServerMessage {
    ServerMessage::Snapshot {
        vehicles: app.router.lock().await.states(),
        cameras: app.cameras.snapshot().await,
        video_sources: app.video.snapshot().await,
    }
}

async fn send(
    sink: &mut futures::stream::SplitSink<WebSocket, Message>,
    frame: &ServerMessage,
) -> Result<(), ()> {
    let text = serde_json::to_string(frame).map_err(|_| ())?;
    sink.send(Message::Text(text.into())).await.map_err(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cameras::{CameraFactory, CameraManager};
    use rgcs_camera::siyi::sim::{SimServer, Transport};
    use rgcs_input::Gate;
    use rgcs_store::Store;
    use std::sync::Arc;
    use tokio::sync::{broadcast, mpsc, Mutex};

    #[test]
    fn origin_must_match_host_when_present() {
        assert!(origin_allowed(None, Some("pi.local:8000")));
        assert!(origin_allowed(
            Some("http://pi.local:8000"),
            Some("pi.local:8000")
        ));
        assert!(origin_allowed(Some("https://HUB.example"), Some("hub.example")));
        assert!(!origin_allowed(
            Some("http://evil.example"),
            Some("pi.local:8000")
        ));
        assert!(!origin_allowed(Some("http://pi.local:8000"), None));
        assert!(!origin_allowed(Some("null"), Some("pi.local:8000")));
    }

    #[test]
    fn malformed_client_frames_get_a_validation_error() {
        match parse_client("{\"t\":\"bogus\"}").map_err(|b| *b) {
            Err(ServerMessage::Error { code, .. }) => assert_eq!(code, "validation"),
            other => panic!("{other:?}"),
        }
        assert!(parse_client("{\"t\":\"input_hb\",\"sysid\":1}").is_ok());
    }

    async fn sim_app() -> (AppState, SimServer) {
        let sim = SimServer::start().await;
        let store = Store::open_memory().await.unwrap();
        let (tx, _rx) = broadcast::channel(16);
        let (queue, _queue_rx) = mpsc::channel(1);
        let cameras = CameraManager::new(store.clone(), tx.clone(), CameraFactory::Sim(sim.addr));
        let app = AppState::new(
            Arc::new(Mutex::new(rgcs_mavlink::Router::default())),
            tx,
            store,
            queue,
            true,
        )
        .with_cameras(cameras);
        let profile = rgcs_core::CameraProfile {
            kind: rgcs_core::CameraKind::SiyiMt11,
            host: "127.0.0.1".into(),
            port: sim.addr.port(),
            ..rgcs_core::CameraProfile::default_for(1)
        };
        app.store.put_camera_profile(&profile).await.unwrap();
        app.cameras.ensure(1).await;
        let mut rx = app.cameras.ensure(1).await.state();
        tokio::time::timeout(std::time::Duration::from_secs(3), async {
            while !rx.borrow().connected {
                rx.changed().await.unwrap();
            }
        })
        .await
        .expect("sim camera connects");
        (app, sim)
    }

    #[tokio::test]
    async fn gimbal_rate_frames_reach_the_camera_and_bad_ones_get_an_error() {
        let (app, mut sim) = sim_app().await;
        while sim.received.try_recv().is_ok() {}
        let (gate, replies) = handle_client(
            &Gate::default(),
            &app,
            "{\"t\":\"gimbal_rate\",\"sysid\":1,\"yaw\":12,\"pitch\":-3,\"seq\":1}",
            1_000,
        )
        .await;
        assert!(replies.is_empty());
        let mut seen = false;
        for _ in 0..20 {
            // The driver's boot zero (ROI ruling 18) may arrive first; look for our frame.
            if let Ok((Transport::Udp, 0x07, p)) = sim.received.try_recv() {
                if p == [12, 0xFD] {
                    seen = true;
                    break;
                }
                continue;
            }
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }
        assert!(seen, "0x07 with [12, -3] reached the simulator");
        let (_, replies) = handle_client(
            &gate,
            &app,
            "{\"t\":\"gimbal_rate\",\"sysid\":1,\"yaw\":200,\"pitch\":0,\"seq\":2}",
            1_100,
        )
        .await;
        assert!(matches!(&replies[..], [ServerMessage::Error { code, .. }] if code == "validation"));
    }

    /// `sim_app` with `roi_1` set and ROI running on it.
    async fn sim_app_with_roi() -> (AppState, SimServer) {
        let (app, sim) = sim_app().await;
        let mut targets = rgcs_core::default_roi_targets();
        targets[0] = rgcs_core::RoiTarget {
            name: "North".into(),
            lat: 35.009,
            lon: 139.0,
            ..targets[0].clone()
        };
        app.store.put_roi_targets(1, &targets).await.unwrap();
        app.roi.start(1, "roi_1").await.unwrap();
        (app, sim)
    }

    fn rate_frame(yaw: i8, seq: u32) -> String {
        format!("{{\"t\":\"gimbal_rate\",\"sysid\":1,\"yaw\":{yaw},\"pitch\":0,\"seq\":{seq}}}")
    }

    async fn rate_payloads(sim: &mut SimServer, ms: u64) -> Vec<Vec<u8>> {
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_millis(ms);
        let mut out = Vec::new();
        while let Ok(Some(f)) = tokio::time::timeout_at(deadline, sim.received.recv()).await {
            if f.0 == Transport::Udp && f.1 == 0x07 {
                out.push(f.2);
            }
        }
        out
    }

    #[tokio::test]
    async fn ws_small_rate_is_ignored_while_active() {
        let (app, mut sim) = sim_app_with_roi().await;
        let (gate, _) = handle_client(&Gate::default(), &app, &rate_frame(3, 1), 1_000).await;
        assert_eq!(app.roi.active_target(1).as_deref(), Some("roi_1"));
        assert!(!rate_payloads(&mut sim, 300).await.contains(&vec![3, 0]));
        let (_, _) = handle_client(&gate, &app, &rate_frame(40, 2), 1_100).await;
        assert_eq!(app.roi.active_target(1), None);
        let frames = rate_payloads(&mut sim, 300).await;
        let manual = frames.iter().position(|p| p == &vec![40, 0]).expect("[40, 0] forwarded");
        assert!(frames[..manual].contains(&vec![0, 0]), "{frames:?}");
        let rows = app.store.recent_audit(10).await.unwrap();
        let row = serde_json::to_value(&rows).unwrap();
        assert!(
            row.as_array().unwrap().iter().any(|r| r["operator"] == "joystick"
                && r["target"] == "roi"
                && r["command"] == "stop"
                && r["reason"] == "manual_input"),
            "{row}"
        );
    }
}
