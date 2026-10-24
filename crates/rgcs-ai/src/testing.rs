//! Test doubles (feature `fake`): a scripted fake provider HTTP server for both protocols.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use axum::body::Bytes;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{Json, Router};
use serde_json::{json, Value};
use tokio::task::JoinHandle;

const STATUS_KEY: &str = "__fake_status";
const BODY_KEY: &str = "__fake_body";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Protocol {
    Anthropic,
    OpenAi,
}

impl Protocol {
    fn path(self) -> &'static str {
        match self {
            Protocol::Anthropic => "/v1/messages",
            Protocol::OpenAi => "/chat/completions",
        }
    }
}

/// A script entry that answers with `status` and `body` instead of 200.
pub fn reply_status(status: u16, body: Value) -> Value {
    json!({ STATUS_KEY: status, BODY_KEY: body })
}

type Recorded = Arc<Mutex<Vec<(HeaderMap, Value)>>>;

#[derive(Clone)]
struct FakeState {
    script: Arc<Mutex<VecDeque<Value>>>,
    requests: Recorded,
    delay: Duration,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn scripted_response(entry: Option<Value>) -> Response {
    let Some(entry) = entry else {
        let body =
            json!({"type": "error", "error": {"type": "fake_exhausted", "message": "script exhausted"}});
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(body)).into_response();
    };
    match entry.get(STATUS_KEY).and_then(Value::as_u64) {
        Some(code) => {
            let status = u16::try_from(code)
                .ok()
                .and_then(|c| StatusCode::from_u16(c).ok())
                .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
            (status, Json(entry.get(BODY_KEY).cloned().unwrap_or(Value::Null))).into_response()
        }
        None => Json(entry).into_response(),
    }
}

async fn handle(State(state): State<FakeState>, headers: HeaderMap, body: Bytes) -> Response {
    let parsed = serde_json::from_slice(&body).unwrap_or(Value::Null);
    lock(&state.requests).push((headers, parsed));
    if !state.delay.is_zero() {
        tokio::time::sleep(state.delay).await;
    }
    let entry = lock(&state.script).pop_front();
    scripted_response(entry)
}

/// Serves scripted replies in order on `127.0.0.1:0`; 500 once the script is exhausted.
pub struct FakeProviderServer {
    /// Base URL to put in `ResolvedAi::base_url` (no trailing slash, no `/v1`).
    pub url: String,
    requests: Recorded,
    task: JoinHandle<()>,
}

impl FakeProviderServer {
    pub async fn start(protocol: Protocol, script: Vec<Value>) -> Self {
        Self::start_with_delay(protocol, script, Duration::ZERO).await
    }

    /// Like `start`, but each reply waits `delay` first (timeout tests).
    pub async fn start_with_delay(protocol: Protocol, script: Vec<Value>, delay: Duration) -> Self {
        let state = FakeState {
            script: Arc::new(Mutex::new(script.into())),
            requests: Arc::default(),
            delay,
        };
        let requests = state.requests.clone();
        let router = Router::new()
            .route(protocol.path(), post(handle))
            .with_state(state);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind fake provider");
        let url = format!("http://{}", listener.local_addr().expect("fake provider addr"));
        let task = tokio::spawn(async move {
            // The task is aborted on drop; a serve error just ends the fake.
            let _ = axum::serve(listener, router).await;
        });
        Self { url, requests, task }
    }

    /// Every request received so far: headers and the parsed JSON body.
    pub fn requests(&self) -> Vec<(HeaderMap, Value)> {
        lock(&self.requests).clone()
    }
}

impl Drop for FakeProviderServer {
    fn drop(&mut self) {
        self.task.abort();
    }
}
