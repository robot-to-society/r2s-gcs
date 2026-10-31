//! A local stand-in for the docomo tile server (tests only; no internet). Tiles live under
//! `/{mode}/{z}/{x}/{y}.gif`; the mode picks the answer.

use std::net::SocketAddr;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use axum::extract::{Path, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;

/// `Last-Modified` of every good tile: 2026-10-01 00:00 UTC.
pub const FAKE_LAST_MODIFIED: &str = "Thu, 01 Oct 2026 00:00:00 GMT";
pub const FAKE_LAST_MODIFIED_MS: u64 = 1_790_812_800_000;

#[derive(Clone, Default)]
struct Counters {
    hits: Arc<AtomicUsize>,
    active: Arc<AtomicUsize>,
    peak: Arc<AtomicUsize>,
}

pub struct LteFake {
    pub addr: SocketAddr,
    counters: Counters,
}

impl LteFake {
    pub async fn start() -> Self {
        let counters = Counters::default();
        let app = axum::Router::new()
            .route("/{mode}/{z}/{x}/{y}", get(tile))
            .with_state(counters.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("addr");
        tokio::spawn(async move { axum::serve(listener, app).await.ok() });
        Self { addr, counters }
    }

    /// The tile template for one mode: `ok`, `html`, `missing`, `big`, `slow`, `redirect`,
    /// `huge`, `mixed` (ok when `x + y` is even, else 404), `paced` (ok after 50 ms).
    pub fn template(&self, mode: &str) -> String {
        format!("http://{}/{mode}/{{z}}/{{x}}/{{y}}.gif", self.addr)
    }

    pub fn hits(&self) -> usize {
        self.counters.hits.load(Ordering::SeqCst)
    }

    /// Most requests seen in flight at once.
    pub fn peak(&self) -> usize {
        self.counters.peak.load(Ordering::SeqCst)
    }
}

/// A GIF89a header of `w`×`h` plus filler up to `len` bytes.
pub fn fake_gif(w: u16, h: u16, len: usize) -> Vec<u8> {
    let mut b = b"GIF89a".to_vec();
    b.extend_from_slice(&w.to_le_bytes());
    b.extend_from_slice(&h.to_le_bytes());
    b.resize(len.max(b.len() + 1) - 1, 0);
    b.push(0x3b);
    b
}

fn gif_response(body: Vec<u8>) -> Response {
    (
        [
            (header::CONTENT_TYPE, "image/gif"),
            (header::LAST_MODIFIED, FAKE_LAST_MODIFIED),
            (header::CACHE_CONTROL, "no-store"),
        ],
        body,
    )
        .into_response()
}

async fn answer(mode: &str, x: u32, y: u32) -> Response {
    match mode {
        "ok" => gif_response(fake_gif(256, 256, 64)),
        "paced" => {
            tokio::time::sleep(Duration::from_millis(50)).await;
            gif_response(fake_gif(256, 256, 64))
        }
        "mixed" if (x + y) % 2 == 0 => gif_response(fake_gif(256, 256, 64)),
        "html" => ([(header::CONTENT_TYPE, "text/html")], "<html>maintenance</html>").into_response(),
        "big" => gif_response(fake_gif(512, 512, 64)),
        "huge" => gif_response(fake_gif(256, 256, 600 * 1024)),
        "slow" => {
            tokio::time::sleep(Duration::from_secs(5)).await;
            gif_response(fake_gif(256, 256, 64))
        }
        "redirect" => (StatusCode::FOUND, [(header::LOCATION, "/ok/8/0/0.gif")]).into_response(),
        _ => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn tile(
    State(c): State<Counters>,
    Path((mode, _z, x, y)): Path<(String, u8, u32, String)>,
) -> Response {
    c.hits.fetch_add(1, Ordering::SeqCst);
    let now = c.active.fetch_add(1, Ordering::SeqCst) + 1;
    c.peak.fetch_max(now, Ordering::SeqCst);
    let y: u32 = y.trim_end_matches(".gif").parse().unwrap_or(0);
    let res = answer(&mode, x, y).await;
    c.active.fetch_sub(1, Ordering::SeqCst);
    res
}
