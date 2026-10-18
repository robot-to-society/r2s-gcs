//! Mission upload / download against a fake vehicle on the `outgoing` channel (spec 50 §2.4,
//! addendum §5.2, acceptance 7-2 minus SITL).

mod common;

use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::http::{Method, StatusCode};
use common::*;
use mavlink::dialects::ardupilotmega::{MissionState, MISSION_CURRENT_DATA, MISSION_ITEM_INT_DATA};
use rgcs_core::{demo20, Mission, ServerMessage, MAV_CMD_NAV_WAYPOINT};
use rgcs_mavlink::MissionFrame;
use serde_json::{json, Value};

fn stored() -> Arc<Mutex<Vec<MISSION_ITEM_INT_DATA>>> {
    Arc::new(Mutex::new(Vec::new()))
}

fn mission_json(m: &Mission) -> Value {
    serde_json::to_value(m).unwrap()
}

async fn put_mission(app: &axum::Router, cookie: &str, m: &Mission) -> (StatusCode, Value) {
    let (status, body, _) = call(
        app,
        req(
            Method::PUT,
            "/api/vehicles/1/mission",
            Some(cookie),
            Some(mission_json(m)),
        ),
    )
    .await;
    (status, body)
}

#[tokio::test]
async fn twenty_items_round_trip_and_verify() {
    let (app, state, rx) = spawn_app_with_link().await;
    seed_vehicle(&state, 1, false, false).await;
    let cookie = login(&app).await;
    let store = stored();
    let _fake = fake_vehicle_mission(rx, state.missions.clone(), 1, store.clone(), FakeMode::Normal);
    let (status, body) = put_mission(&app, &cookie, &demo20()).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["data"]["items"], 20);
    assert_eq!(body["data"]["verified"], true);
    assert_eq!(body["data"]["mismatched"], json!([]));
    assert_eq!(store.lock().unwrap().len(), 21, "home + 20 items");
    assert_eq!(store.lock().unwrap()[0].current, 1);

    let (status, body, _) = call(
        &app,
        req(Method::GET, "/api/vehicles/1/mission", Some(&cookie), None),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let got: Mission = serde_json::from_value(body["data"].clone()).unwrap();
    assert_eq!(got.items.len(), 20);
    assert_eq!(got.sysid, Some(1));
    for (a, b) in got.items.iter().zip(&demo20().items) {
        assert_eq!(
            (a.command, a.frame, a.params, a.alt),
            (b.command, b.frame, b.params, b.alt)
        );
        assert!((a.lat - b.lat).abs() < 1e-7 && (a.lon - b.lon).abs() < 1e-7);
    }
    let (_, audit, _) = call(
        &app,
        req(Method::GET, "/api/history/audit?limit=5", Some(&cookie), None),
    )
    .await;
    let rows = audit["data"].as_array().unwrap();
    assert!(
        rows.iter()
            .any(|r| r["target"] == "mission" && r["command"] == "upload" && r["result"] == "ok"),
        "{audit}"
    );
}

#[tokio::test]
async fn legacy_requests_still_complete() {
    let (app, state, rx) = spawn_app_with_link().await;
    seed_vehicle(&state, 1, false, false).await;
    let cookie = login(&app).await;
    let _fake = fake_vehicle_mission(rx, state.missions.clone(), 1, stored(), FakeMode::Legacy);
    let (status, body) = put_mission(&app, &cookie, &demo20()).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["data"]["verified"], true);
}

#[tokio::test]
async fn timeout_releases_the_transaction() {
    let (app, state, rx) = spawn_app_with_link().await;
    seed_vehicle(&state, 1, false, false).await;
    let cookie = login(&app).await;
    let silent = fake_vehicle_mission(rx, state.missions.clone(), 1, stored(), FakeMode::Silent);
    let started = std::time::Instant::now();
    let (status, body) = put_mission(&app, &cookie, &demo20()).await;
    assert_eq!(status, StatusCode::GATEWAY_TIMEOUT, "{body}");
    assert_eq!(error_code(&body), "mission_timeout");
    assert!(
        started.elapsed() < Duration::from_secs(6),
        "{:?}",
        started.elapsed()
    );
    silent.abort();
    // a new link + a normal vehicle: the sysid is not stuck in "busy"
    let (outgoing_tx, rx2) = tokio::sync::mpsc::channel(16);
    let state2 = state.clone().with_outgoing(outgoing_tx);
    let app2 = rgcs_server::app::build(state2.clone(), None);
    let _fake = fake_vehicle_mission(rx2, state2.missions.clone(), 1, stored(), FakeMode::Normal);
    let (status, body) = put_mission(&app2, &cookie, &demo20()).await;
    assert_eq!(status, StatusCode::OK, "{body}");
}

#[tokio::test]
async fn armed_vehicle_refuses_upload_without_sending_frames() {
    let (app, state, mut rx) = spawn_app_with_link().await;
    seed_vehicle(&state, 1, true, false).await;
    let cookie = login(&app).await;
    let (status, body) = put_mission(&app, &cookie, &demo20()).await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(error_code(&body), "vehicle_armed");
    assert!(rx.try_recv().is_err(), "nothing was sent to the link");
}

#[tokio::test]
async fn fatal_findings_refuse_the_upload() {
    let (app, state, mut rx) = spawn_app_with_link().await;
    seed_vehicle(&state, 1, false, false).await;
    let cookie = login(&app).await;
    let mut m = demo20();
    m.items[0].command = MAV_CMD_NAV_WAYPOINT;
    let (status, body) = put_mission(&app, &cookie, &m).await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(error_code(&body), "mission_invalid");
    assert_eq!(body["data"]["findings"][0]["code"], "first_not_takeoff");
    assert!(rx.try_recv().is_err(), "nothing was sent to the link");
}

#[tokio::test]
async fn concurrent_upload_is_busy() {
    let (app, state, rx) = spawn_app_with_link().await;
    seed_vehicle(&state, 1, false, false).await;
    let cookie = login(&app).await;
    let silent = fake_vehicle_mission(rx, state.missions.clone(), 1, stored(), FakeMode::Silent);
    let (app1, c1) = (app.clone(), cookie.clone());
    let first = tokio::spawn(async move { put_mission(&app1, &c1, &demo20()).await });
    tokio::time::sleep(Duration::from_millis(200)).await;
    let (status, body) = put_mission(&app, &cookie, &demo20()).await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(error_code(&body), "mission_busy");
    let (status, _) = first.await.unwrap();
    assert_eq!(status, StatusCode::GATEWAY_TIMEOUT);
    silent.abort();
}

#[tokio::test]
async fn rejected_ack_is_409() {
    let (app, state, rx) = spawn_app_with_link().await;
    seed_vehicle(&state, 1, false, false).await;
    let cookie = login(&app).await;
    let _fake = fake_vehicle_mission(rx, state.missions.clone(), 1, stored(), FakeMode::RejectAck);
    let (status, body) = put_mission(&app, &cookie, &demo20()).await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(error_code(&body), "mission_rejected");
}

#[tokio::test]
async fn mission_current_becomes_progress_frames() {
    let (app, state, rx) = spawn_app_with_link().await;
    seed_vehicle(&state, 1, false, false).await;
    let cookie = login(&app).await;
    let _fake = fake_vehicle_mission(rx, state.missions.clone(), 1, stored(), FakeMode::Normal);
    let (status, _) = put_mission(&app, &cookie, &demo20()).await;
    assert_eq!(status, StatusCode::OK);
    let mut sub = state.tx.subscribe();
    state.missions.on_frame(
        1,
        MissionFrame::Current(MISSION_CURRENT_DATA {
            seq: 3,
            total: 0,
            mission_state: MissionState::MISSION_STATE_ACTIVE,
            mission_mode: 0,
            mission_id: 0,
            fence_id: 0,
            rally_points_id: 0,
        }),
    );
    let frame = tokio::time::timeout(Duration::from_secs(1), async {
        loop {
            if let Ok(ServerMessage::MissionProgress { sysid, progress }) = sub.recv().await {
                return (sysid, progress);
            }
        }
    })
    .await
    .expect("progress frame");
    assert_eq!(frame.0, 1);
    assert_eq!(
        (frame.1.seq, frame.1.total),
        (3, Some(20)),
        "total = item count, what the UI prints"
    );
    let (status, body, _) = call(
        &app,
        req(
            Method::GET,
            "/api/vehicles/1/mission/progress",
            Some(&cookie),
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["seq"], 3);
    let (status, body, _) = call(
        &app,
        req(
            Method::GET,
            "/api/vehicles/2/mission/progress",
            Some(&cookie),
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(body["data"].is_null(), "{body}");
}

#[tokio::test]
async fn known_mission_endpoint_returns_what_the_server_wrote() {
    let (app, state, rx) = spawn_app_with_link().await;
    seed_vehicle(&state, 1, false, false).await;
    seed_vehicle(&state, 2, false, false).await;
    let cookie = login(&app).await;
    let (status, body, _) = call(
        &app,
        req(Method::GET, "/api/vehicles/1/mission/known", Some(&cookie), None),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body["data"].is_null());
    let _fake = fake_vehicle_mission(rx, state.missions.clone(), 1, stored(), FakeMode::Normal);
    let (status, _) = put_mission(&app, &cookie, &demo20()).await;
    assert_eq!(status, StatusCode::OK);
    let (status, body, _) = call(
        &app,
        req(Method::GET, "/api/vehicles/1/mission/known", Some(&cookie), None),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["items"].as_array().unwrap().len(), 20);
    assert_eq!(body["data"]["sysid"], 1);
    let (status, body, _) = call(
        &app,
        req(Method::GET, "/api/vehicles/2/mission/known", Some(&cookie), None),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(body["data"].is_null());
}
