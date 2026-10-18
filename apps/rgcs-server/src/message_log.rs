//! The message log service (spec 10 §1, 2026-10-18): persists every vehicle message, link
//! event and command result, broadcasts it with its row id, and prunes the table.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use rgcs_core::{CommandResult, LogEntry, MessageSource, ServerMessage, Severity, VehicleMessage};
use rgcs_store::messages::NewMessage;
use rgcs_store::Store;
use tokio::sync::broadcast;

/// Rows kept in `messages` (the sheet shows the newest 500; older ones stay for maintenance).
pub const KEEP_ROWS: u32 = 5_000;
/// Prune once every this many inserts.
pub const PRUNE_EVERY: u64 = 1_000;

#[derive(Clone)]
pub struct MessageLog {
    store: Store,
    tx: broadcast::Sender<ServerMessage>,
    inserts: Arc<AtomicU64>,
}

impl MessageLog {
    pub fn new(store: Store, tx: broadcast::Sender<ServerMessage>) -> Self {
        Self {
            store,
            tx,
            inserts: Arc::new(AtomicU64::new(0)),
        }
    }

    /// Inserts one entry; `None` when the database refuses (the event is still broadcast by the caller).
    pub async fn record(&self, m: NewMessage) -> Option<LogEntry> {
        let entry = match self.store.record_message(&m).await {
            Ok(e) => e,
            Err(e) => {
                tracing::warn!(error = %e, "message log insert failed");
                return None;
            }
        };
        if self.inserts.fetch_add(1, Ordering::Relaxed) % PRUNE_EVERY == PRUNE_EVERY - 1 {
            if let Err(e) = self.store.prune_messages(KEEP_ROWS).await {
                tracing::warn!(error = %e, "message log prune failed");
            }
        }
        Some(entry)
    }

    /// Persists a vehicle / link message and returns it with the row id as its `id`.
    pub async fn record_vehicle(&self, m: VehicleMessage) -> VehicleMessage {
        let raw = (m.source == MessageSource::Vehicle).then_some(m.severity);
        let new = NewMessage {
            ts: m.ts,
            sysid: Some(m.sysid),
            source: m.source,
            severity: m.level,
            raw_severity: raw,
            text: m.text.clone(),
        };
        match self.record(new).await {
            Some(e) => VehicleMessage { id: e.id as u64, ..m },
            None => m,
        }
    }

    /// Logs a command result and broadcasts it as a `log_entry`.
    pub async fn record_command(&self, r: &CommandResult) {
        let text = match &r.reason {
            Some(reason) if !r.ok => format!("{} {}", r.cmd, reason),
            _ => r.cmd.clone(),
        };
        let new = NewMessage {
            ts: r.ts,
            sysid: Some(r.sysid),
            source: MessageSource::Command,
            severity: if r.ok { Severity::Ok } else { Severity::Error },
            raw_severity: None,
            text,
        };
        if let Some(e) = self.record(new).await {
            let _ = self.tx.send(ServerMessage::LogEntry(e));
        }
    }
}

/// Watches the broadcast for command results (sent from several handlers) and logs them.
pub async fn run_recorder(log: MessageLog, mut rx: broadcast::Receiver<ServerMessage>) {
    loop {
        match rx.recv().await {
            Ok(ServerMessage::CommandResult(r)) => log.record_command(&r).await,
            Ok(_) | Err(broadcast::error::RecvError::Lagged(_)) => {}
            Err(broadcast::error::RecvError::Closed) => return,
        }
    }
}
