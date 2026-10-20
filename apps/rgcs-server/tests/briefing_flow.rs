//! Briefings: named sets of saved missions (spec 50 §2.2.2).

mod common;

use axum::http::{Method, StatusCode};
use common::*;
use rgcs_core::demo20;
use serde_json::{json, Value};

async fn save_mission(app: &axum::Router, cookie: &str, name: &str) -> i64 {
    let mut m = demo20();
    m.name = name.into();
    let (status, body, _) = call(
        app,
        req(
            Method::POST,
            "/api/missions",
            Some(cookie),
            Some(serde_json::to_value(&m).unwrap()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    body["data"]["id"].as_i64().expect("id")
}

fn briefing(name: &str, rows: Vec<Value>) -> Value {
    json!({ "id": null, "name": name, "active_mission_id": null, "rows": rows })
}

fn row(mission_id: i64, color: &str, sysid: Option<u8>) -> Value {
    json!({ "mission_id": mission_id, "color": color, "sysid": sysid })
}

#[tokio::test]
async fn create_list_get_update_delete_a_briefing() {
    let (app, _state) = spawn_app().await;
    let cookie = login(&app).await;
    let a = save_mission(&app, &cookie, "a").await;
    let b = save_mission(&app, &cookie, "b").await;

    let body_in = briefing(
        "morning",
        vec![row(a, "#ff0000", Some(1)), row(b, "#00ff00", None)],
    );
    let (status, body, _) = call(
        &app,
        req(Method::POST, "/api/briefings", Some(&cookie), Some(body_in)),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let id = body["data"]["id"].as_i64().expect("id");

    let (status, body, _) = call(&app, req(Method::GET, "/api/briefings", Some(&cookie), None)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"][0]["id"], id);
    assert_eq!(body["data"][0]["name"], "morning");
    assert_eq!(body["data"][0]["mission_count"], 2);

    let path = format!("/api/briefings/{id}");
    let (status, body, _) = call(&app, req(Method::GET, &path, Some(&cookie), None)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["briefing"]["rows"].as_array().unwrap().len(), 2);
    assert_eq!(body["data"]["missions"][0]["name"], "a");
    assert_eq!(body["data"]["missions"][1]["name"], "b");

    let updated = briefing("evening", vec![row(b, "#0000ff", Some(2))]);
    let (status, body, _) = call(&app, req(Method::PUT, &path, Some(&cookie), Some(updated))).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["data"]["name"], "evening");
    assert_eq!(body["data"]["rows"].as_array().unwrap().len(), 1);

    let (status, body, _) = call(&app, req(Method::DELETE, &path, Some(&cookie), None)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["deleted"], true);
    let (status, body, _) = call(&app, req(Method::GET, &path, Some(&cookie), None)).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(error_code(&body), "not_found");
    let (status, _, _) = call(&app, req(Method::DELETE, &path, Some(&cookie), None)).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn rows_must_reference_existing_missions_and_be_valid() {
    let (app, _state) = spawn_app().await;
    let cookie = login(&app).await;
    let a = save_mission(&app, &cookie, "a").await;
    let b = save_mission(&app, &cookie, "b").await;

    let unknown = briefing("x", vec![row(a, "#ff0000", None), row(9999, "#00ff00", None)]);
    let (status, body, _) = call(
        &app,
        req(Method::POST, "/api/briefings", Some(&cookie), Some(unknown)),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(error_code(&body), "unknown_mission");

    let dup = briefing("x", vec![row(a, "#ff0000", Some(1)), row(b, "#00ff00", Some(1))]);
    let (status, body, _) = call(
        &app,
        req(Method::POST, "/api/briefings", Some(&cookie), Some(dup)),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(error_code(&body), "invalid");

    let (_, body, _) = call(
        &app,
        req(
            Method::POST,
            "/api/briefings",
            Some(&cookie),
            Some(briefing("ok", vec![row(a, "#ff0000", None)])),
        ),
    )
    .await;
    let id = body["data"]["id"].as_i64().unwrap();
    let bad_update = briefing("ok", vec![row(12345, "#ff0000", None)]);
    let (status, body, _) = call(
        &app,
        req(
            Method::PUT,
            &format!("/api/briefings/{id}"),
            Some(&cookie),
            Some(bad_update),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(error_code(&body), "unknown_mission");

    let (status, body, _) = call(
        &app,
        req(
            Method::PUT,
            "/api/briefings/777",
            Some(&cookie),
            Some(briefing("n", vec![])),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{body}");
}

#[tokio::test]
async fn a_deleted_mission_comes_back_as_null() {
    let (app, _state) = spawn_app().await;
    let cookie = login(&app).await;
    let a = save_mission(&app, &cookie, "a").await;
    let (_, body, _) = call(
        &app,
        req(
            Method::POST,
            "/api/briefings",
            Some(&cookie),
            Some(briefing("k", vec![row(a, "#ff0000", None)])),
        ),
    )
    .await;
    let id = body["data"]["id"].as_i64().unwrap();
    let (status, _, _) = call(
        &app,
        req(Method::DELETE, &format!("/api/missions/{a}"), Some(&cookie), None),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, body, _) = call(
        &app,
        req(Method::GET, &format!("/api/briefings/{id}"), Some(&cookie), None),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(body["data"]["missions"][0].is_null(), "{body}");
    assert_eq!(body["data"]["briefing"]["rows"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn briefings_need_a_session() {
    let (app, _state) = spawn_app().await;
    let (status, _, _) = call(&app, req(Method::GET, "/api/briefings", None, None)).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}
