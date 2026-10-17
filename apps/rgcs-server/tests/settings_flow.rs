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
