mod common;

use std::time::Duration;

use axum::http::{Method, StatusCode};
use common::*;
use serde_json::{json, Value};

fn arm() -> Value {
    json!({ "cmd": "arm" })
}

fn arm_with(token: &str) -> Value {
    json!({ "cmd": "arm", "confirm_token": token })
}

async fn confirm(app: &axum::Router, cookie: &str, cmd: &str) -> String {
    let (status, body, _) = call(
        app,
        req(
            Method::POST,
            "/api/vehicles/1/confirm",
            Some(cookie),
            Some(json!({ "cmd": cmd })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["expires_in"], 30);
    body["data"]["confirm_token"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn arm_without_token_is_409_confirm_required() {
    let (app, state) = spawn_app().await;
    seed_vehicle(&state, 1, false, false).await;
    let cookie = login(&app).await;
    let (status, body, _) = call(
        &app,
        req(
            Method::POST,
            "/api/vehicles/1/command",
            Some(&cookie),
            Some(arm()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(error_code(&body), "confirm_required");
}

#[tokio::test]
async fn confirm_then_arm_is_queued_and_audited() {
    let (app, state) = spawn_app().await;
    seed_vehicle(&state, 1, false, false).await;
    let cookie = login(&app).await;
    let token = confirm(&app, &cookie, "arm").await;
    let (status, body, _) = call(
        &app,
        req(
            Method::POST,
            "/api/vehicles/1/command",
            Some(&cookie),
            Some(arm_with(&token)),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(body["data"]["id"].is_u64(), "{body}");

    let mut latest = Value::Null;
    for _ in 0..20 {
        let (_, audit, _) = call(
            &app,
            req(Method::GET, "/api/history/audit?limit=1", Some(&cookie), None),
        )
        .await;
        latest = audit["data"][0].clone();
        if latest["command"] == "arm" && latest["result"] == "ok" {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert_eq!(latest["command"], "arm", "{latest}");
    assert_eq!(latest["result"], "ok", "{latest}");
    assert_eq!(latest["operator"], "admin");
}

#[tokio::test]
async fn arm_on_armed_vehicle_is_409_rejected() {
    let (app, state) = spawn_app().await;
    seed_vehicle(&state, 1, true, false).await;
    let cookie = login(&app).await;
    let token = confirm(&app, &cookie, "arm").await;
    let (status, body, _) = call(
        &app,
        req(
            Method::POST,
            "/api/vehicles/1/command",
            Some(&cookie),
            Some(arm_with(&token)),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(error_code(&body), "rejected");
}

#[tokio::test]
async fn token_for_other_command_is_409() {
    let (app, state) = spawn_app().await;
    seed_vehicle(&state, 1, false, false).await;
    let cookie = login(&app).await;
    let token = confirm(&app, &cookie, "rtl").await;
    let (status, body, _) = call(
        &app,
        req(
            Method::POST,
            "/api/vehicles/1/command",
            Some(&cookie),
            Some(arm_with(&token)),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(error_code(&body), "confirm_required");
    assert!(body["error"]["message"]
        .as_str()
        .unwrap()
        .contains("another command"));
}

#[tokio::test]
async fn command_on_lost_link_is_503_link_lost() {
    let (app, state) = spawn_app().await;
    seed_vehicle(&state, 1, false, true).await;
    let cookie = login(&app).await;
    let (status, body, _) = call(
        &app,
        req(
            Method::POST,
            "/api/vehicles/1/command",
            Some(&cookie),
            Some(json!({ "cmd": "pause" })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(error_code(&body), "link_lost");
}

#[tokio::test]
async fn pause_needs_no_token() {
    let (app, state) = spawn_app().await;
    seed_vehicle(&state, 1, false, false).await;
    let cookie = login(&app).await;
    let (status, body, _) = call(
        &app,
        req(
            Method::POST,
            "/api/vehicles/1/command",
            Some(&cookie),
            Some(json!({ "cmd": "pause" })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
}

#[tokio::test]
async fn unknown_vehicle_is_404() {
    let (app, _) = spawn_app().await;
    let cookie = login(&app).await;
    let (status, body, _) = call(
        &app,
        req(
            Method::POST,
            "/api/vehicles/9/command",
            Some(&cookie),
            Some(arm()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(error_code(&body), "not_found");
}
