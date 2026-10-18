//! `rgcs-server` binary: load `config.toml`, start the MAVLink link, the command queue and
//! the telemetry pumps, then serve the API and UI.

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use rgcs_mavlink::{LinkChannels, LinkUrl, Router};
use rgcs_store::Store;
use tokio::sync::{broadcast, mpsc, Mutex};
use tracing::info;
use tracing_subscriber::EnvFilter;

use rgcs_server::app::{self, AppState, BROADCAST_CAPACITY};
use rgcs_server::config::{self, Config};
use rgcs_server::telemetry;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();
    let config_path = std::env::var("RGCS_CONFIG").unwrap_or_else(|_| config::DEFAULT_PATH.into());
    let config = Config::load(Path::new(&config_path))?;
    let link: LinkUrl = config
        .mavlink_url
        .parse()
        .map_err(|e| anyhow::anyhow!("mavlink_url: {e}"))?;
    info!(config = %config_path, listen = %config.listen, link = %link, "starting rgcs-server");

    let store = Store::open(&config.data_dir.join("rgcs.db")).await?;
    let dev_mode = store.dev_mode().await?;
    if dev_mode {
        tracing::warn!("development login admin/admin is active");
    }

    let router = Arc::new(Mutex::new(Router::default()));
    let (tx, _) = broadcast::channel(BROADCAST_CAPACITY);
    let (events_tx, events_rx) = mpsc::channel(256);
    let (outgoing_tx, outgoing_rx) = mpsc::channel(64);
    let (acks_tx, _) = broadcast::channel(64);
    let (queue_tx, queue_rx) = mpsc::channel(32);
    let channels = LinkChannels {
        events: events_tx,
        outgoing: outgoing_rx,
        acks: acks_tx.clone(),
    };
    tokio::spawn(rgcs_mavlink::run_link(link, router.clone(), channels));
    tokio::spawn(rgcs_mavlink::run_queue(queue_rx, outgoing_tx.clone(), acks_tx));
    let state = AppState::new(router.clone(), tx.clone(), store, queue_tx, dev_mode)
        .with_outgoing(outgoing_tx)
        .with_map(config.map_tile_url.clone(), config.map_attribution.clone())
        .with_whep_upstream(&config.whep_upstream)
        .with_data_dir(config.data_dir.clone())
        .with_video_timings(rgcs_video::Timings {
            timeout: Duration::from_millis(config.video_probe_timeout_ms),
            ..rgcs_video::Timings::default()
        });
    tokio::spawn(telemetry::pump_events(
        events_rx,
        tx.clone(),
        state.params.clone(),
        state.missions.clone(),
        state.outgoing.clone(),
    ));
    tokio::spawn(state.missions.clone().resend_loop());
    tokio::spawn(telemetry::diff_loop(
        router.clone(),
        tx.clone(),
        Duration::from_millis(config.telemetry_interval_ms.max(20)),
    ));

    state.bring_up_configured().await;
    let app = app::build(state, config.ui_dir.clone());
    let listener = tokio::net::TcpListener::bind(config.listen).await?;
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
    info!("shutting down");
}
