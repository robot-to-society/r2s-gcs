//! REST handlers. Every response is `{success, data}` or `{success:false, error}` (spec 50 §1).

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use rgcs_core::{SysId, VehicleSummary};
use serde::Serialize;

use crate::app::AppState;

#[derive(Serialize)]
pub struct ApiError {
    pub code: &'static str,
    pub message: String,
}

#[derive(Serialize)]
#[serde(untagged)]
pub enum Envelope<T: Serialize> {
    Ok { success: bool, data: T },
    Err { success: bool, error: ApiError },
}

pub fn ok<T: Serialize>(data: T) -> Response {
    Json(Envelope::Ok { success: true, data }).into_response()
}

pub fn err(status: StatusCode, code: &'static str, message: impl Into<String>) -> Response {
    let body = Envelope::<()>::Err {
        success: false,
        error: ApiError {
            code,
            message: message.into(),
        },
    };
    (status, Json(body)).into_response()
}

#[derive(Serialize)]
pub struct Health {
    pub status: &'static str,
    pub hostname: String,
    pub version: &'static str,
}

pub async fn health(State(app): State<AppState>) -> Response {
    ok(Health {
        status: "ok",
        hostname: app.hostname.clone(),
        version: env!("CARGO_PKG_VERSION"),
    })
}

pub async fn list_vehicles(State(app): State<AppState>) -> Response {
    let list: Vec<VehicleSummary> = app
        .router
        .lock()
        .await
        .states()
        .iter()
        .map(VehicleSummary::from)
        .collect();
    ok(list)
}

pub async fn get_vehicle(State(app): State<AppState>, Path(sysid): Path<SysId>) -> Response {
    match app.router.lock().await.state(sysid) {
        Some(v) => ok(v.clone()),
        None => err(
            StatusCode::NOT_FOUND,
            "not_found",
            format!("vehicle {sysid} is not connected"),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn envelopes_have_the_documented_shape() {
        let ok = serde_json::to_string(&Envelope::Ok {
            success: true,
            data: 1,
        })
        .unwrap();
        assert_eq!(ok, r#"{"success":true,"data":1}"#);
        let e = Envelope::<()>::Err {
            success: false,
            error: ApiError {
                code: "not_found",
                message: "x".into(),
            },
        };
        assert_eq!(
            serde_json::to_string(&e).unwrap(),
            r#"{"success":false,"error":{"code":"not_found","message":"x"}}"#
        );
    }
}
