//! DataFlash retrieval over MAVLink (addendum §5.6 / §9): LOG_REQUEST_LIST → LOG_ENTRY list,
//! LOG_REQUEST_DATA → 90-byte LOG_DATA frames collected into `data_dir/logs/<sysid>/`.
//! Gaps are re-requested from the first missing offset; progress is broadcast over WS.

use std::collections::HashSet;
use std::path::Path;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use rgcs_core::{FcLogEntry, LogFetchProgress, ServerMessage, SysId};
use rgcs_mavlink::{
    encode_log_request_data, encode_log_request_end, encode_log_request_list, LogFrame, Outgoing,
};
use tokio::sync::{broadcast, mpsc};
use tokio::time::{timeout, Instant};

pub const LIST_IDLE: Duration = Duration::from_secs(1);
pub const LIST_TIMEOUT: Duration = Duration::from_secs(5);
/// Bytes asked for per LOG_REQUEST_DATA (32 frames of 90 bytes).
pub const WINDOW_BYTES: u32 = 2_880;
pub const DATA_IDLE: Duration = Duration::from_secs(1);
pub const MAX_RETRIES: u32 = 10;
pub const PROGRESS_EVERY_BYTES: u64 = 65_536;
const FRAME_CAPACITY: usize = 512;

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum LogError {
    #[error("log retrieval is disabled for this link")]
    Disabled,
    #[error("a log transfer is already running for this vehicle")]
    Busy,
    #[error("the flight controller did not answer")]
    Timeout,
    #[error("link closed")]
    LinkClosed,
    #[error("io: {0}")]
    Io(String),
    #[error("log not found")]
    NotFound,
}

#[derive(Clone)]
pub struct LogHub {
    tx: broadcast::Sender<ServerMessage>,
    frames: broadcast::Sender<(SysId, LogFrame)>,
    running: Arc<StdMutex<HashSet<SysId>>>,
    enabled: bool,
}

struct RunningGuard {
    running: Arc<StdMutex<HashSet<SysId>>>,
    sysid: SysId,
}

impl Drop for RunningGuard {
    fn drop(&mut self) {
        if let Ok(mut r) = self.running.lock() {
            r.remove(&self.sysid);
        }
    }
}

impl LogHub {
    pub fn new(tx: broadcast::Sender<ServerMessage>, enabled: bool) -> Self {
        let (frames, _) = broadcast::channel(FRAME_CAPACITY);
        Self {
            tx,
            frames,
            running: Arc::default(),
            enabled,
        }
    }

    pub fn with_enabled(self, enabled: bool) -> Self {
        Self { enabled, ..self }
    }

    pub fn enabled(&self) -> bool {
        self.enabled
    }

    /// Called for every `RouterEvent::Log`.
    pub fn on_frame(&self, sysid: SysId, frame: LogFrame) {
        let _ = self.frames.send((sysid, frame));
    }

    pub fn is_running(&self, sysid: SysId) -> bool {
        self.running.lock().map(|r| r.contains(&sysid)).unwrap_or(false)
    }

    fn acquire(&self, sysid: SysId) -> Result<RunningGuard, LogError> {
        if !self.enabled {
            return Err(LogError::Disabled);
        }
        let mut r = self.running.lock().map_err(|_| LogError::Busy)?;
        if !r.insert(sysid) {
            return Err(LogError::Busy);
        }
        Ok(RunningGuard {
            running: self.running.clone(),
            sysid,
        })
    }

    /// Every log the flight controller holds (`LOG_REQUEST_LIST 0..=0xFFFF`).
    pub async fn list(
        &self,
        sysid: SysId,
        outgoing: &mpsc::Sender<Outgoing>,
    ) -> Result<Vec<FcLogEntry>, LogError> {
        let _guard = self.acquire(sysid)?;
        let mut rx = self.frames.subscribe();
        send(outgoing, encode_log_request_list(sysid, 0, 0xFFFF)).await?;
        let mut entries: Vec<FcLogEntry> = Vec::new();
        let deadline = Instant::now() + LIST_TIMEOUT;
        loop {
            let wait = if entries.is_empty() {
                deadline.saturating_duration_since(Instant::now())
            } else {
                LIST_IDLE
            };
            match timeout(wait, rx.recv()).await {
                Ok(Ok((s, LogFrame::Entry(e)))) if s == sysid => {
                    if e.num_logs == 0 {
                        return Ok(Vec::new());
                    }
                    if !entries.iter().any(|x| x.id == u32::from(e.id)) {
                        entries.push(FcLogEntry {
                            id: u32::from(e.id),
                            time_utc: e.time_utc,
                            size: e.size,
                        });
                    }
                    if entries.len() >= usize::from(e.num_logs) {
                        return Ok(entries);
                    }
                }
                Ok(Ok(_)) => {}
                Ok(Err(broadcast::error::RecvError::Lagged(_))) => {}
                Ok(Err(broadcast::error::RecvError::Closed)) => return Err(LogError::LinkClosed),
                Err(_) if entries.is_empty() => return Err(LogError::Timeout),
                Err(_) => return Ok(entries),
            }
        }
    }

    fn progress(
        &self,
        sysid: SysId,
        fc_log_id: u16,
        received: u64,
        total: u64,
        done: bool,
        error: Option<String>,
    ) {
        let _ = self.tx.send(ServerMessage::LogFetchProgress {
            sysid,
            progress: LogFetchProgress {
                fc_log_id: u32::from(fc_log_id),
                received,
                total,
                done,
                error,
            },
        });
    }

    /// Downloads log `fc_log_id` (`size` bytes, from `list`) into `path` and returns the byte count.
    pub async fn fetch(
        &self,
        sysid: SysId,
        fc_log_id: u16,
        size: u32,
        path: &Path,
        outgoing: &mpsc::Sender<Outgoing>,
    ) -> Result<u64, LogError> {
        let _guard = self.acquire(sysid)?;
        let result = self.transfer(sysid, fc_log_id, size, outgoing).await;
        let _ = send(outgoing, encode_log_request_end(sysid)).await;
        let bytes = match result {
            Ok(b) => b,
            Err(e) => {
                self.progress(sysid, fc_log_id, 0, u64::from(size), true, Some(e.to_string()));
                return Err(e);
            }
        };
        if let Err(e) = write_atomically(path, &bytes).await {
            self.progress(
                sysid,
                fc_log_id,
                bytes.len() as u64,
                u64::from(size),
                true,
                Some(e.to_string()),
            );
            return Err(e);
        }
        self.progress(sysid, fc_log_id, bytes.len() as u64, u64::from(size), true, None);
        Ok(bytes.len() as u64)
    }

    async fn transfer(
        &self,
        sysid: SysId,
        fc_log_id: u16,
        size: u32,
        outgoing: &mpsc::Sender<Outgoing>,
    ) -> Result<Vec<u8>, LogError> {
        let mut rx = self.frames.subscribe();
        let mut buf: Vec<u8> = Vec::with_capacity(size as usize);
        let mut retries = 0u32;
        let mut last_progress = 0u64;
        while (buf.len() as u32) < size {
            let received = buf.len() as u32;
            let window = WINDOW_BYTES.min(size - received);
            send(
                outgoing,
                encode_log_request_data(sysid, fc_log_id, received, window),
            )
            .await?;
            let before = buf.len();
            collect_window(&mut rx, sysid, fc_log_id, &mut buf, received + window).await?;
            if buf.len() > before {
                retries = 0;
            } else {
                retries += 1;
                if retries > MAX_RETRIES {
                    return Err(LogError::Timeout);
                }
            }
            if buf.len() as u64 - last_progress >= PROGRESS_EVERY_BYTES {
                last_progress = buf.len() as u64;
                self.progress(sysid, fc_log_id, last_progress, u64::from(size), false, None);
            }
        }
        buf.truncate(size as usize);
        Ok(buf)
    }
}

/// Appends in-order LOG_DATA frames until `window_end` is reached or the link goes idle.
async fn collect_window(
    rx: &mut broadcast::Receiver<(SysId, LogFrame)>,
    sysid: SysId,
    fc_log_id: u16,
    buf: &mut Vec<u8>,
    window_end: u32,
) -> Result<(), LogError> {
    while (buf.len() as u32) < window_end {
        match timeout(DATA_IDLE, rx.recv()).await {
            Ok(Ok((s, LogFrame::Data(d)))) if s == sysid && d.id == fc_log_id => {
                if d.ofs == buf.len() as u32 {
                    let n = usize::from(d.count).min(d.data.len());
                    buf.extend_from_slice(&d.data[..n]);
                    if n == 0 {
                        return Ok(());
                    }
                }
                // Out-of-order frames are dropped; the gap is re-requested at the next idle.
            }
            Ok(Ok(_)) => {}
            Ok(Err(broadcast::error::RecvError::Lagged(_))) => {}
            Ok(Err(broadcast::error::RecvError::Closed)) => return Err(LogError::LinkClosed),
            Err(_) => return Ok(()),
        }
    }
    Ok(())
}

async fn send(
    outgoing: &mpsc::Sender<Outgoing>,
    message: mavlink::dialects::ardupilotmega::MavMessage,
) -> Result<(), LogError> {
    outgoing
        .send(Outgoing { message })
        .await
        .map_err(|_| LogError::LinkClosed)
}

async fn write_atomically(path: &Path, bytes: &[u8]) -> Result<(), LogError> {
    let io = |e: std::io::Error| LogError::Io(e.to_string());
    if let Some(dir) = path.parent() {
        tokio::fs::create_dir_all(dir).await.map_err(io)?;
    }
    let part = path.with_extension("part");
    tokio::fs::write(&part, bytes).await.map_err(io)?;
    tokio::fs::rename(&part, path).await.map_err(io)
}
