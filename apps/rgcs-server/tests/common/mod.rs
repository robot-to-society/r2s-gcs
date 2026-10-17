//! In-process test harness: in-memory store, a bare `Router`, and a stub command queue that
//! accepts everything. Shared by the integration tests under `tests/`.
#![allow(dead_code)]

use std::sync::Arc;

use axum::body::Body;
use axum::http::{header, HeaderMap, Method, Request, StatusCode};
use axum::Router as AxumRouter;
use http_body_util::BodyExt;
use mavlink::dialects::ardupilotmega::{
    MavAutopilot, MavMessage, MavModeFlag, MavState, MavType, HEARTBEAT_DATA,
};
use mavlink::MavHeader;
use rgcs_mavlink::{Clock, Outcome, Outgoing, QueuedCommand, Router};
use rgcs_server::app::{self, AppState, BROADCAST_CAPACITY};
use rgcs_store::Store;
use serde_json::Value;
use tokio::sync::{broadcast, mpsc, Mutex};
use tower::ServiceExt;

pub const CSRF: (&str, &str) = ("x-requested-with", "rgcs");

pub async fn spawn_app() -> (AxumRouter, AppState) {
    let (app, state, _rx) = spawn_app_with_link().await;
    (app, state)
}

/// Like `spawn_app`, but also hands back the receiver of frames sent straight to the link.
pub async fn spawn_app_with_link() -> (AxumRouter, AppState, mpsc::Receiver<Outgoing>) {
    let (outgoing_tx, outgoing_rx) = mpsc::channel::<Outgoing>(16);
    let store = Store::open_memory().await.expect("memory store");
    let dev_mode = store.dev_mode().await.expect("dev_mode");
    let router = Arc::new(Mutex::new(Router::default()));
    let (tx, _keep) = broadcast::channel(BROADCAST_CAPACITY);
    let (queue_tx, mut queue_rx) = mpsc::channel::<QueuedCommand>(8);
    tokio::spawn(async move {
        while let Some(job) = queue_rx.recv().await {
            let _ = job.done.send(Outcome::Accepted);
        }
    });
    // Keep one receiver alive so `broadcast::send` succeeds like it does in production.
    tokio::spawn(async move {
        let mut rx = _keep;
        while rx.recv().await.is_ok() {}
    });
    let state = AppState::new(router, tx, store, queue_tx, dev_mode).with_outgoing(outgoing_tx);
    (app::build(state.clone(), None), state, outgoing_rx)
}

/// ArduCopter custom mode numbers used by the tests.
pub const COPTER_STABILIZE: u32 = 0;
pub const COPTER_GUIDED: u32 = 4;

pub fn seed_param(app: &AppState, sysid: u8, name: &str, value: f32) {
    app.params.set(sysid, name, value);
}

/// Registers an ArduCopter flight controller for `sysid`; `lost` ages the link past 10 s.
pub async fn seed_vehicle(app: &AppState, sysid: u8, armed: bool, lost: bool) {
    seed_copter(app, sysid, COPTER_STABILIZE, armed, lost).await;
}

pub async fn seed_copter(app: &AppState, sysid: u8, custom_mode: u32, armed: bool, lost: bool) {
    let header = MavHeader {
        system_id: sysid,
        component_id: 1,
        sequence: 0,
    };
    let mut base_mode = MavModeFlag::MAV_MODE_FLAG_CUSTOM_MODE_ENABLED;
    if armed {
        base_mode |= MavModeFlag::MAV_MODE_FLAG_SAFETY_ARMED;
    }
    let hb = HEARTBEAT_DATA {
        custom_mode,
        mavtype: MavType::MAV_TYPE_QUADROTOR,
        autopilot: MavAutopilot::MAV_AUTOPILOT_ARDUPILOTMEGA,
        base_mode,
        system_status: MavState::MAV_STATE_ACTIVE,
        mavlink_version: 3,
    };
    let mut router = app.router.lock().await;
    router.on_message(&header, &MavMessage::HEARTBEAT(hb), Clock::default());
    if lost {
        router.tick(Clock {
            mono_ms: 11_000,
            unix_ms: 11_000,
        });
    }
}

pub fn req(method: Method, path: &str, cookie: Option<&str>, json: Option<Value>) -> Request<Body> {
    build(method, path, cookie, json, true)
}

pub fn req_nocsrf(method: Method, path: &str, json: Option<Value>) -> Request<Body> {
    build(method, path, None, json, false)
}

fn build(method: Method, path: &str, cookie: Option<&str>, json: Option<Value>, csrf: bool) -> Request<Body> {
    let mut b = Request::builder().method(method).uri(path);
    if csrf {
        b = b.header(CSRF.0, CSRF.1);
    }
    if let Some(c) = cookie {
        b = b.header(header::COOKIE, c);
    }
    match json {
        Some(v) => b
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(v.to_string()))
            .expect("request"),
        None => b.body(Body::empty()).expect("request"),
    }
}

pub async fn call(app: &AxumRouter, request: Request<Body>) -> (StatusCode, Value, HeaderMap) {
    let res = app.clone().oneshot(request).await.expect("response");
    let status = res.status();
    let headers = res.headers().clone();
    let bytes = res.into_body().collect().await.expect("body").to_bytes();
    let json = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, json, headers)
}

pub fn login_body(username: &str, password: &str) -> Value {
    serde_json::json!({ "username": username, "password": password })
}

/// Logs in as admin/admin and returns the `rgcs_session=<token>` cookie pair.
pub async fn login(app: &AxumRouter) -> String {
    let (status, _, headers) = call(
        app,
        req(
            Method::POST,
            "/api/auth/login",
            None,
            Some(login_body("admin", "admin")),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "login should succeed");
    cookie_pair(&headers)
}

pub fn cookie_pair(headers: &HeaderMap) -> String {
    headers
        .get(header::SET_COOKIE)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(';').next())
        .map(str::to_string)
        .expect("Set-Cookie with rgcs_session")
}

pub fn error_code(body: &Value) -> &str {
    body["error"]["code"].as_str().unwrap_or("")
}
