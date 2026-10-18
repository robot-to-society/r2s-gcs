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

#[tokio::test]
async fn app_settings_map_flag_round_trips() {
    let (app, _) = spawn_app().await;
    let cookie = login(&app).await;
    let (_, body, _) = call(&app, req(Method::GET, "/api/settings/app", Some(&cookie), None)).await;
    assert_eq!(
        body["data"]["map"]["gimbal_ground_projection"], false,
        "default off"
    );

    let put = serde_json::json!({ "map": { "gimbal_ground_projection": true } });
    let (status, body, _) = call(
        &app,
        req(Method::PUT, "/api/settings/app", Some(&cookie), Some(put)),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["data"]["map"]["gimbal_ground_projection"], true);
    assert_eq!(body["data"]["lang"], "ja", "the full settings come back");
    let (_, body, _) = call(&app, req(Method::GET, "/api/settings/app", Some(&cookie), None)).await;
    assert_eq!(body["data"]["map"]["gimbal_ground_projection"], true);

    let (_, audit, _) = call(
        &app,
        req(Method::GET, "/api/history/audit?limit=20", Some(&cookie), None),
    )
    .await;
    let rows: Vec<_> = audit["data"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["command"] == "app_settings_put")
        .collect();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["target"], "settings");

    let bad = serde_json::json!({ "map": { "gimbal_ground_projection": "yes" } });
    let (status, _, _) = call(
        &app,
        req(Method::PUT, "/api/settings/app", Some(&cookie), Some(bad)),
    )
    .await;
    assert!(status.is_client_error(), "{status}");
    let (status, _, _) = call(
        &app,
        req(
            Method::PUT,
            "/api/settings/app",
            None,
            Some(serde_json::json!({})),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn app_settings_list_default_basemaps() {
    let (app, _) = spawn_app().await;
    let cookie = login(&app).await;
    let (_, body, _) = call(&app, req(Method::GET, "/api/settings/app", Some(&cookie), None)).await;
    let ids: Vec<&str> = body["data"]["basemaps"]
        .as_array()
        .unwrap()
        .iter()
        .map(|b| b["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, vec!["map", "satellite", "gsi_std", "gsi_photo"]);
    assert_eq!(body["data"]["basemaps"][2]["attribution"], "地理院タイル");
}
