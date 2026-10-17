mod common;

use axum::http::{Method, StatusCode};
use common::*;

#[tokio::test]
async fn app_settings_require_a_session_and_return_the_map_config() {
    let (app, _) = spawn_app().await;
    let (status, _, _) = call(&app, req(Method::GET, "/api/settings/app", None, None)).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let cookie = login(&app).await;
    let (status, body, _) = call(&app, req(Method::GET, "/api/settings/app", Some(&cookie), None)).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["data"]["lang"], "ja");
    assert_eq!(
        body["data"]["map_tile_url"],
        "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
    );
    assert_eq!(body["data"]["map_attribution"], "© OpenStreetMap contributors");
}

#[tokio::test]
async fn gimbal_input_profile_defaults_validation_and_round_trip() {
    let (app, _) = spawn_app().await;
    let cookie = login(&app).await;
    let (status, body, _) = call(
        &app,
        req(Method::GET, "/api/settings/input/gimbal", Some(&cookie), None),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["data"]["max_pan_speed"], 30.0);
    assert_eq!(body["data"]["axes"][0]["fn"], "pan");

    let mut bad = body["data"].clone();
    bad["max_pan_speed"] = serde_json::json!(500);
    let (status, body, _) = call(
        &app,
        req(
            Method::PUT,
            "/api/settings/input/gimbal",
            Some(&cookie),
            Some(bad),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert_eq!(error_code(&body), "validation");
    assert!(body["error"]["message"]
        .as_str()
        .unwrap()
        .contains("max_pan_speed"));

    let (_, current, _) = call(
        &app,
        req(Method::GET, "/api/settings/input/gimbal", Some(&cookie), None),
    )
    .await;
    let mut good = current["data"].clone();
    good["max_pan_speed"] = serde_json::json!(45);
    let (status, body, _) = call(
        &app,
        req(
            Method::PUT,
            "/api/settings/input/gimbal",
            Some(&cookie),
            Some(good),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (_, again, _) = call(
        &app,
        req(Method::GET, "/api/settings/input/gimbal", Some(&cookie), None),
    )
    .await;
    assert_eq!(again["data"]["max_pan_speed"], 45.0);
    let (_, audit, _) = call(
        &app,
        req(Method::GET, "/api/history/audit?limit=1", Some(&cookie), None),
    )
    .await;
    assert_eq!(audit["data"][0]["command"], "input_profile");
}
