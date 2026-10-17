//! Shared server state and the axum router.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use axum::response::Html;
use axum::routing::{get, post};
use axum::{middleware, Router as AxumRouter};
use rgcs_core::{ServerMessage, SysId};
use rgcs_mavlink::{QueuedCommand, Router};
use rgcs_store::{Lockout, Store};
use tokio::sync::{broadcast, mpsc, Mutex};
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;

use crate::confirm::{ConfirmError, ConfirmTokens};
use crate::settings;
use crate::{api, auth, commands, ws};

pub const BROADCAST_CAPACITY: usize = 1024;
/// Distinct usernames tracked for login serialization before the map is reset.
const MAX_LOGIN_GUARDS: usize = 1024;

#[derive(Clone)]
pub struct AppState {
    pub router: Arc<Mutex<Router>>,
    pub tx: broadcast::Sender<ServerMessage>,
    pub store: Store,
    pub queue: mpsc::Sender<QueuedCommand>,
    pub hostname: String,
    pub secure_cookies: bool,
    /// Map tile source handed to the UI by `GET /api/settings/app`.
    pub map_tile_url: String,
    pub map_attribution: String,
    started: Instant,
    lockout: Arc<StdMutex<Lockout>>,
    /// One async mutex per username so check-lockout → verify → record is serialized
    /// (otherwise concurrent attempts slip past the 5-failure limit).
    login_guards: Arc<StdMutex<HashMap<String, Arc<Mutex<()>>>>>,
    confirm: Arc<StdMutex<ConfirmTokens>>,
    next_command: Arc<AtomicU64>,
    dev_mode: Arc<AtomicBool>,
}

impl AppState {
    pub fn new(
        router: Arc<Mutex<Router>>,
        tx: broadcast::Sender<ServerMessage>,
        store: Store,
        queue: mpsc::Sender<QueuedCommand>,
        dev_mode: bool,
    ) -> Self {
        let hostname = std::env::var("HOSTNAME").unwrap_or_else(|_| "rgcs".into());
        Self {
            router,
            tx,
            store,
            queue,
            hostname,
            secure_cookies: false,
            map_tile_url: crate::config::Config::default().map_tile_url,
            map_attribution: crate::config::Config::default().map_attribution,
            started: Instant::now(),
            lockout: Arc::new(StdMutex::new(Lockout::default())),
            login_guards: Arc::new(StdMutex::new(HashMap::new())),
            confirm: Arc::new(StdMutex::new(ConfirmTokens::default())),
            next_command: Arc::new(AtomicU64::new(1)),
            dev_mode: Arc::new(AtomicBool::new(dev_mode)),
        }
    }

    pub fn with_map(self, tile_url: String, attribution: String) -> Self {
        Self {
            map_tile_url: tile_url,
            map_attribution: attribution,
            ..self
        }
    }

    /// Monotonic seconds since start (lockouts and confirm tokens).
    pub fn now_secs(&self) -> u64 {
        self.started.elapsed().as_secs()
    }

    pub fn dev_mode(&self) -> bool {
        self.dev_mode.load(Ordering::Relaxed)
    }

    pub fn locked_for(&self, user: &str) -> Option<u64> {
        self.lockout
            .lock()
            .expect("lockout mutex")
            .locked_for(user, self.now_secs())
    }

    /// Guard to hold for the whole login attempt of `user`.
    pub fn login_guard(&self, user: &str) -> Arc<Mutex<()>> {
        let mut guards = self.login_guards.lock().expect("login guards mutex");
        if guards.len() > MAX_LOGIN_GUARDS && !guards.contains_key(user) {
            // Drop only guards nobody holds: an in-flight attempt keeps its Arc alive, and a
            // concurrent attempt for the same user must share that very mutex.
            guards.retain(|_, m| Arc::strong_count(m) > 1);
        }
        guards.entry(user.to_string()).or_default().clone()
    }

    pub fn login_failed(&self, user: &str) {
        let mut l = self.lockout.lock().expect("lockout mutex");
        *l = l.fail(user, self.now_secs());
    }

    pub fn login_succeeded(&self, user: &str) {
        let mut l = self.lockout.lock().expect("lockout mutex");
        *l = l.succeed(user);
    }

    pub fn issue_confirm(&self, sysid: SysId, cmd: &str) -> String {
        let mut c = self.confirm.lock().expect("confirm mutex");
        let (next, token) = c.issue(sysid, cmd, self.now_secs());
        *c = next;
        token
    }

    pub fn consume_confirm(&self, token: &str, sysid: SysId, cmd: &str) -> Result<(), ConfirmError> {
        let mut c = self.confirm.lock().expect("confirm mutex");
        let (next, verdict) = c.consume(token, sysid, cmd, self.now_secs());
        *c = next;
        verdict
    }

    pub fn next_command_id(&self) -> u64 {
        self.next_command.fetch_add(1, Ordering::Relaxed)
    }
}

pub fn unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn build(state: AppState, ui_dir: Option<PathBuf>) -> AxumRouter {
    let api = AxumRouter::new()
        .route("/health", get(api::health))
        .route("/auth/login", post(auth::login))
        .route("/auth/logout", post(auth::logout))
        .route("/auth/me", get(auth::me))
        .route("/vehicles", get(api::list_vehicles))
        .route("/vehicles/{sysid}", get(api::get_vehicle))
        .route("/vehicles/{sysid}/confirm", post(commands::confirm))
        .route("/vehicles/{sysid}/command", post(commands::command))
        .route("/history/audit", get(api::audit_history))
        .route("/settings/app", get(settings::app_settings))
        .layer(middleware::from_fn(auth::csrf_guard));
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

#[cfg(test)]
mod tests {
    use super::*;
    use rgcs_store::Store;

    async fn state() -> AppState {
        let store = Store::open_memory().await.unwrap();
        let (tx, _rx) = broadcast::channel(8);
        let (queue, _queue_rx) = mpsc::channel(1);
        AppState::new(Arc::new(Mutex::new(Router::default())), tx, store, queue, true)
    }

    #[tokio::test]
    async fn login_guard_reset_keeps_guards_that_are_in_flight() {
        let app = state().await;
        let alice = app.login_guard("alice");
        let _held = alice.lock().await;
        for i in 0..=MAX_LOGIN_GUARDS {
            app.login_guard(&format!("user{i}"));
        }
        // The map was reset while alice's attempt is still running …
        let again = app.login_guard("alice");
        // … so a concurrent attempt for alice must get the very same mutex.
        assert!(Arc::ptr_eq(&alice, &again));
        assert!(app.login_guards.lock().unwrap().len() <= MAX_LOGIN_GUARDS + 2);
    }
}
