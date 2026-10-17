mod common;

use std::time::Duration;

use axum::http::{Method, StatusCode};
use common::*;
use rgcs_camera::siyi::sim::Transport;
use rgcs_core::ServerMessage;
use serde_json::{json, Value};

async fn put_mt11_profile(app: &axum::Router, cookie: &str, port: u16) -> (StatusCode, Value) {
    let body = json!({ "kind": "siyi_mt11", "host": "127.0.0.1", "port": port });
    let (s, v, _) = call(
        app,
        req(
            Method::PUT,
            "/api/vehicles/1/camera/profile",
            Some(cookie),
            Some(body),
        ),
    )
    .await;
    (s, v)
}

async fn camera_json(app: &axum::Router, cookie: &str) -> Value {
    let (s, v, _) = call(
        app,
        req(Method::GET, "/api/vehicles/1/camera", Some(cookie), None),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    v["data"].clone()
}

async fn wait_connected(app: &axum::Router, cookie: &str) -> Value {
    for _ in 0..40 {
        let c = camera_json(app, cookie).await;
        if c["state"]["connected"] == true && c["state"]["firmware"].is_object() {
            return c;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("camera never connected");
}

#[tokio::test]
async fn camera_endpoint_reports_none_until_a_profile_is_saved() {
    let (app, state, sim) = spawn_app_with_sim().await;
    seed_vehicle(&state, 1, false, false).await;
    let cookie = login(&app).await;
    let c = camera_json(&app, &cookie).await;
    assert_eq!(c["caps"]["kind"], "none");
    assert_eq!(c["state"]["connected"], false);
    let (s, v) = put_mt11_profile(&app, &cookie, sim.addr.port()).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let c = wait_connected(&app, &cookie).await;
    assert_eq!(c["caps"]["kind"], "siyi_mt11");
    assert_eq!(c["caps"]["zoom"]["max"], 165.0);
    assert_eq!(c["state"]["firmware"]["camera"], "v1.0.1");
}

#[tokio::test]
async fn commands_are_capability_checked_and_audited() {
    let (app, state, mut sim) = spawn_app_with_sim().await;
    seed_vehicle(&state, 1, false, false).await;
    let cookie = login(&app).await;
    let (s, v, _) = call(
        &app,
        req(
            Method::POST,
            "/api/vehicles/1/camera/command",
            Some(&cookie),
            Some(json!({ "cmd": "photo" })),
        ),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "{v}");
    assert_eq!(error_code(&v), "unsupported_capability");

    put_mt11_profile(&app, &cookie, sim.addr.port()).await;
    wait_connected(&app, &cookie).await;
    while sim.received.try_recv().is_ok() {}
    let (s, v, _) = call(
        &app,
        req(
            Method::POST,
            "/api/vehicles/1/camera/command",
            Some(&cookie),
            Some(json!({ "cmd": "photo" })),
        ),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let mut seen = false;
    for _ in 0..20 {
        if let Ok((t, cmd, payload)) = sim.received.try_recv() {
            if t == Transport::Tcp && cmd == 0x0C && payload == [0] {
                seen = true;
                break;
            }
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert!(seen, "photo command reached the camera");
    let (_, audit, _) = call(
        &app,
        req(Method::GET, "/api/history/audit?limit=1", Some(&cookie), None),
    )
    .await;
    assert_eq!(audit["data"][0]["command"], "photo", "{audit}");
    assert_eq!(audit["data"][0]["target"], "camera");

    let (s, v, _) = call(
        &app,
        req(
            Method::POST,
            "/api/vehicles/1/camera/command",
            Some(&cookie),
            Some(json!({ "cmd": "gimbal_rate", "args": { "yaw": 1, "pitch": 1 } })),
        ),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
    assert_eq!(error_code(&v), "ws_only");
}

#[tokio::test]
async fn snapshot_and_camera_state_frames() {
    let (app, state, sim) = spawn_app_with_sim().await;
    seed_vehicle(&state, 1, false, false).await;
    let cookie = login(&app).await;
    put_mt11_profile(&app, &cookie, sim.addr.port()).await;
    wait_connected(&app, &cookie).await;
    let snapshot = rgcs_server::ws::snapshot(&state).await;
    let ServerMessage::Snapshot { cameras, .. } = snapshot else {
        panic!("not a snapshot")
    };
    assert_eq!(cameras.len(), 1);
    assert_eq!(cameras[0].sysid, 1);

    let mut rx = state.tx.subscribe();
    let (s, v, _) = call(
        &app,
        req(
            Method::POST,
            "/api/vehicles/1/camera/command",
            Some(&cookie),
            Some(json!({ "cmd": "zoom_absolute", "args": { "zoom": 3.0 } })),
        ),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let seen = tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            if let Ok(ServerMessage::CameraState { sysid: 1, state, .. }) = rx.recv().await {
                if state.zoom == 3.0 {
                    return true;
                }
            }
        }
    })
    .await;
    assert_eq!(seen, Ok(true), "camera_state with zoom 3.0 broadcast");
}

#[tokio::test]
async fn profile_validation_errors_name_the_field() {
    let (app, state, _sim) = spawn_app_with_sim().await;
    seed_vehicle(&state, 1, false, false).await;
    let cookie = login(&app).await;
    let (s, v, _) = call(
        &app,
        req(
            Method::PUT,
            "/api/vehicles/1/camera/profile",
            Some(&cookie),
            Some(json!({ "kind": "siyi_mt11", "host": "127.0.0.1", "port": 0 })),
        ),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{v}");
    assert_eq!(error_code(&v), "validation");
    assert!(v["error"]["message"].as_str().unwrap().contains("port"));
    let (s, v, _) = call(
        &app,
        req(Method::GET, "/api/vehicles/1/camera/profile", Some(&cookie), None),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v["data"]["kind"], "none");
}

#[tokio::test]
async fn configured_cameras_come_up_at_startup_and_frames_carry_caps() {
    let (app, state, mut sim) = spawn_app_with_sim().await;
    seed_vehicle(&state, 1, false, false).await;
    let cookie = login(&app).await;
    let mut rx = state.tx.subscribe();
    put_mt11_profile(&app, &cookie, sim.addr.port()).await;
    // (b) a runtime kind change: the very next camera_state frame already carries the MT11 caps.
    let caps_seen = tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            if let Ok(ServerMessage::CameraState { sysid: 1, caps, .. }) = rx.recv().await {
                if caps.kind == rgcs_core::CameraKind::SiyiMt11 {
                    return true;
                }
            }
        }
    })
    .await;
    assert_eq!(caps_seen, Ok(true));
    while sim.received.try_recv().is_ok() {}

    // (a) a fresh server over the same store (a Pi reboot) brings the camera up without any request.
    let state2 = rgcs_server::app::AppState::new(
        state.router.clone(),
        state.tx.clone(),
        state.store.clone(),
        state.queue.clone(),
        true,
    )
    .with_cameras(rgcs_server::cameras::CameraManager::new(
        state.store.clone(),
        state.tx.clone(),
        rgcs_server::cameras::CameraFactory::Sim(sim.addr),
    ));
    state2.bring_up_configured().await;
    let connected = tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            let snap = rgcs_server::ws::snapshot(&state2).await;
            if let ServerMessage::Snapshot {
                cameras,
                video_sources,
                ..
            } = snap
            {
                if cameras.iter().any(|c| {
                    c.sysid == 1 && c.caps.kind == rgcs_core::CameraKind::SiyiMt11 && c.state.connected
                }) && video_sources.iter().any(|v| v.sysid == 1)
                {
                    return true;
                }
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await;
    assert_eq!(
        connected,
        Ok(true),
        "camera and video monitor installed at startup"
    );
}
