//! `GET/PUT /api/settings/app` (spec 50 §2.4): what the UI needs that is not per-vehicle —
//! the language default, the map tile source (config.toml) and the persisted 地図表示 switch.

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::Response;
use axum::Json;
use rgcs_store::app_settings::GIMBAL_GROUND_PROJECTION;
use rgcs_store::audit::AuditInput;
use serde::{Deserialize, Serialize};

use crate::api::{err, ok};
use crate::app::AppState;
use crate::auth::AuthUser;

/// 地図表示 (spec 10 §7).
#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct MapSettings {
    /// Draw the gimbal footprint on the ground instead of the direction fan; default off.
    pub gimbal_ground_projection: bool,
}

#[derive(Serialize, ts_rs::TS)]
#[ts(export)]
pub struct AppSettings {
    pub lang: String,
    pub map_tile_url: String,
    pub map_attribution: String,
    pub map: MapSettings,
}

/// `PUT /api/settings/app` body: only the persisted settings, each optional.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AppSettingsPut {
    pub map: Option<MapSettingsPut>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MapSettingsPut {
    pub gimbal_ground_projection: Option<bool>,
}

async fn current(app: &AppState) -> rgcs_store::Result<AppSettings> {
    let projection = app.store.app_setting(GIMBAL_GROUND_PROJECTION).await?;
    Ok(AppSettings {
        lang: "ja".into(),
        map_tile_url: app.map_tile_url.clone(),
        map_attribution: app.map_attribution.clone(),
        map: MapSettings {
            gimbal_ground_projection: projection.as_deref() == Some("true"),
        },
    })
}

pub async fn app_settings(State(app): State<AppState>, AuthUser(_op): AuthUser) -> Response {
    match current(&app).await {
        Ok(s) => ok(s),
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, "internal", e.to_string()),
    }
}

/// Any signed-in operator may change it (a display preference shared by the station; audited).
pub async fn put_app_settings(
    State(app): State<AppState>,
    AuthUser(op): AuthUser,
    Json(body): Json<AppSettingsPut>,
) -> Response {
    if let Some(flag) = body.map.and_then(|m| m.gimbal_ground_projection) {
        if let Err(e) = app
            .store
            .put_app_setting(GIMBAL_GROUND_PROJECTION, if flag { "true" } else { "false" })
            .await
        {
            return err(StatusCode::INTERNAL_SERVER_ERROR, "internal", e.to_string());
        }
        let entry = AuditInput {
            operator: &op.username,
            sysid: None,
            target: "settings",
            command: "app_settings_put",
            args: Some(serde_json::json!({ "map": { "gimbal_ground_projection": flag } }).to_string()),
            result: "ok",
            reason: None,
        };
        if let Err(e) = app.store.record_audit(entry).await {
            tracing::error!(error = %e, "audit write failed");
        }
    }
    app_settings(State(app), AuthUser(op)).await
}
