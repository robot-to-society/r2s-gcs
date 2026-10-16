//! Shared server state and the axum router.

use std::path::PathBuf;
use std::sync::Arc;

use axum::response::Html;
use axum::routing::get;
use axum::Router as AxumRouter;
use rgcs_core::ServerMessage;
use rgcs_mavlink::Router;
use tokio::sync::{broadcast, Mutex};
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;

use crate::{api, ws};

pub const BROADCAST_CAPACITY: usize = 1024;

#[derive(Clone)]
pub struct AppState {
    pub router: Arc<Mutex<Router>>,
    pub tx: broadcast::Sender<ServerMessage>,
    pub hostname: String,
}

impl AppState {
    pub fn new(router: Arc<Mutex<Router>>, tx: broadcast::Sender<ServerMessage>) -> Self {
        let hostname = std::env::var("HOSTNAME").unwrap_or_else(|_| "rgcs".into());
        Self { router, tx, hostname }
    }
}

pub fn build(state: AppState, ui_dir: Option<PathBuf>) -> AxumRouter {
    let api = AxumRouter::new()
        .route("/health", get(api::health))
        .route("/vehicles", get(api::list_vehicles))
        .route("/vehicles/{sysid}", get(api::get_vehicle));
    let app = AxumRouter::new().nest("/api", api).route("/ws", get(ws::handler));
    let app = match ui_dir {
        Some(dir) => {
            app.fallback_service(ServeDir::new(&dir).fallback(ServeFile::new(dir.join("index.html"))))
        }
        None => app.fallback(placeholder),
    };
    app.layer(TraceLayer::new_for_http()).with_state(state)
}

async fn placeholder() -> Html<&'static str> {
    Html("<!doctype html><title>RGCS</title><p>RGCS server is running. Build the UI and set <code>ui_dir</code> in config.toml.")
}
