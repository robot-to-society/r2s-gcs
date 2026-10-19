//! `MissionHub`: routes Mission Protocol frames from the link to the running transaction,
//! serialises one transaction per vehicle, turns `MISSION_CURRENT` into `mission_progress`
//! frames and remembers the mission each vehicle is known to carry.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};

use rgcs_core::{
    Mission, MissionProgress, MissionTransfer, ServerMessage, SysId, TransferPhase, UploadReport,
};
use rgcs_mavlink::{MissionFrame, Outgoing};
use rgcs_mission::{Done, Download, ProtocolError, Upload};
use tokio::sync::{broadcast, mpsc};

const FRAME_CAPACITY: usize = 256;
const TICK: Duration = Duration::from_millis(250);
const RESEND_EVERY: Duration = Duration::from_secs(1);
const LAT_LON_EPS: f64 = 1e-7;
/// ArduPilot stores altitudes in centimetres.
const ALT_EPS: f32 = 0.011;

#[derive(Debug, thiserror::Error)]
pub enum MissionError {
    #[error("another mission transaction is running for this vehicle")]
    Busy,
    #[error("the vehicle did not answer in time")]
    Timeout,
    #[error("the vehicle rejected the mission: {0}")]
    Rejected(String),
    #[error("link is not running")]
    LinkClosed,
    #[error("{0}")]
    Invalid(String),
}

#[derive(Clone)]
pub struct MissionHub {
    frames: broadcast::Sender<(SysId, MissionFrame)>,
    busy: Arc<StdMutex<HashSet<SysId>>>,
    progress: Arc<StdMutex<HashMap<SysId, MissionProgress>>>,
    known: Arc<StdMutex<HashMap<SysId, Mission>>>,
    tx: broadcast::Sender<ServerMessage>,
    /// The RGCS SYSID transfers answer to (read when a transfer starts).
    gcs: rgcs_core::GcsId,
}

/// Releases the per-vehicle transaction slot however the transaction ends.
struct BusyGuard {
    busy: Arc<StdMutex<HashSet<SysId>>>,
    sysid: SysId,
}

impl Drop for BusyGuard {
    fn drop(&mut self) {
        if let Ok(mut b) = self.busy.lock() {
            b.remove(&self.sysid);
        }
    }
}

/// Frames only matter for items that carry a position: ArduPilot stores none for RTL / DO_*
/// items and reads them back as MAV_FRAME_GLOBAL.
fn items_match(a: &rgcs_core::MissionItem, b: &rgcs_core::MissionItem) -> bool {
    a.command == b.command
        && (!a.has_position() || a.frame == b.frame)
        && a.params == b.params
        && (a.lat - b.lat).abs() <= LAT_LON_EPS
        && (a.lon - b.lon).abs() <= LAT_LON_EPS
        && (a.alt - b.alt).abs() <= ALT_EPS
}

/// 1-based sequences where the read-back differs (length differences count every extra seq).
pub fn mismatches(sent: &Mission, got: &Mission) -> Vec<u16> {
    let n = sent.items.len().max(got.items.len());
    (0..n)
        .filter(|&i| match (sent.items.get(i), got.items.get(i)) {
            (Some(a), Some(b)) => !items_match(a, b),
            _ => true,
        })
        .map(|i| (i + 1) as u16)
        .collect()
}

impl MissionHub {
    /// A mission transfer is in progress for some vehicle (the GCS SYSID must not change then).
    pub fn any_busy(&self) -> bool {
        !self.busy.lock().expect("busy mutex").is_empty()
    }

    pub fn new(tx: broadcast::Sender<ServerMessage>, gcs: rgcs_core::GcsId) -> Self {
        let (frames, _) = broadcast::channel(FRAME_CAPACITY);
        Self {
            frames,
            busy: Arc::default(),
            progress: Arc::default(),
            known: Arc::default(),
            tx,
            gcs,
        }
    }

    /// Called for every `RouterEvent::Mission`.
    pub fn on_frame(&self, sysid: SysId, frame: MissionFrame) {
        if let MissionFrame::Current(c) = &frame {
            self.on_current(sysid, c.seq, c.total);
        }
        let _ = self.frames.send((sysid, frame));
    }

    fn on_current(&self, sysid: SysId, seq: u16, wire_total: u16) {
        let known_total = self
            .known
            .lock()
            .ok()
            .and_then(|k| k.get(&sysid).map(|m| m.items.len() as u16));
        let total = known_total.or((wire_total > 0).then_some(wire_total));
        let next = MissionProgress { seq, total };
        let changed = match self.progress.lock() {
            Ok(mut p) => p.insert(sysid, next) != Some(next),
            Err(_) => false,
        };
        if changed {
            let _ = self.tx.send(ServerMessage::MissionProgress {
                sysid,
                progress: next,
            });
        }
    }

    pub fn progress(&self, sysid: SysId) -> Option<MissionProgress> {
        self.progress.lock().ok().and_then(|p| p.get(&sysid).copied())
    }

    pub fn known(&self, sysid: SysId) -> Option<Mission> {
        self.known.lock().ok().and_then(|k| k.get(&sysid).cloned())
    }

    /// Re-broadcasts every known progress once a second so late-joining clients catch up.
    pub async fn resend_loop(self) {
        let mut tick = tokio::time::interval(RESEND_EVERY);
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            tick.tick().await;
            let snapshot: Vec<(SysId, MissionProgress)> = self
                .progress
                .lock()
                .map(|p| p.iter().map(|(s, v)| (*s, *v)).collect())
                .unwrap_or_default();
            for (sysid, progress) in snapshot {
                let _ = self.tx.send(ServerMessage::MissionProgress { sysid, progress });
            }
        }
    }

    fn acquire(&self, sysid: SysId) -> Result<BusyGuard, MissionError> {
        let mut busy = self.busy.lock().map_err(|_| MissionError::Busy)?;
        if !busy.insert(sysid) {
            return Err(MissionError::Busy);
        }
        Ok(BusyGuard {
            busy: self.busy.clone(),
            sysid,
        })
    }

    /// Writes the mission, reads it back and compares. Holds the vehicle's transaction slot.
    pub async fn upload(
        &self,
        sysid: SysId,
        component: u8,
        mission: &Mission,
        outgoing: &mpsc::Sender<Outgoing>,
    ) -> Result<UploadReport, MissionError> {
        let _guard = self.acquire(sysid)?;
        let mut rx = self.frames.subscribe();
        let started = Instant::now();
        let gcs = self.gcs.get();
        let (up, out) = Upload::start(sysid, component, mission, 0)
            .map_err(|e: ProtocolError| MissionError::Invalid(e.to_string()))?;
        let up = up.for_gcs(gcs);
        let total = mission.items.len() as u16 + 1;
        let report = Reporter::new(self.tx.clone(), sysid, total);
        report.send(TransferPhase::Write, 0);
        let written = async {
            send_all(outgoing, out).await?;
            run_upload(up, &mut rx, sysid, outgoing, started, &report).await?;
            report.send(TransferPhase::Verify, 0);
            run_download(sysid, component, gcs, &mut rx, outgoing, started, Some(&report)).await
        }
        .await;
        let got = match written {
            Ok(got) => got,
            Err(e) => {
                report.send(TransferPhase::Failed, 0);
                return Err(e);
            }
        };
        report.send(TransferPhase::Done, total);
        let mismatched = mismatches(mission, &got);
        let verified = mismatched.is_empty();
        if verified {
            self.remember(sysid, mission);
        }
        Ok(UploadReport {
            items: mission.items.len() as u32,
            verified,
            mismatched,
            findings: Vec::new(),
        })
    }

    /// Reads the vehicle's mission. Holds the vehicle's transaction slot.
    pub async fn download(
        &self,
        sysid: SysId,
        component: u8,
        outgoing: &mpsc::Sender<Outgoing>,
    ) -> Result<Mission, MissionError> {
        let _guard = self.acquire(sysid)?;
        let mut rx = self.frames.subscribe();
        let got = run_download(
            sysid,
            component,
            self.gcs.get(),
            &mut rx,
            outgoing,
            Instant::now(),
            None,
        )
        .await?;
        self.remember(sysid, &got);
        Ok(Mission {
            sysid: Some(sysid),
            ..got
        })
    }

    fn remember(&self, sysid: SysId, mission: &Mission) {
        if let Ok(mut k) = self.known.lock() {
            k.insert(
                sysid,
                Mission {
                    sysid: Some(sysid),
                    ..mission.clone()
                },
            );
        }
    }
}

/// Sends `mission_transfer` frames for one upload; `done` never goes backwards within a phase.
struct Reporter {
    tx: broadcast::Sender<ServerMessage>,
    sysid: SysId,
    total: u16,
    last: StdMutex<(Option<TransferPhase>, u16)>,
}

impl Reporter {
    fn new(tx: broadcast::Sender<ServerMessage>, sysid: SysId, total: u16) -> Self {
        Self {
            tx,
            sysid,
            total,
            last: StdMutex::new((None, 0)),
        }
    }

    fn send(&self, phase: TransferPhase, done: u16) {
        let done = done.min(self.total);
        if let Ok(mut last) = self.last.lock() {
            if last.0 == Some(phase) && done <= last.1 {
                return;
            }
            *last = (Some(phase), done);
        }
        let _ = self.tx.send(ServerMessage::MissionTransfer {
            sysid: self.sysid,
            transfer: MissionTransfer {
                phase,
                done,
                total: self.total,
            },
        });
    }

    /// Write phase: a request for seq `n` means `n` frames were taken; the final ACK, all of them.
    #[allow(deprecated)]
    fn on_write_frame(&self, frame: &MissionFrame) {
        match frame {
            MissionFrame::RequestInt(r) => self.send(TransferPhase::Write, r.seq),
            MissionFrame::Request(r) => self.send(TransferPhase::Write, r.seq),
            MissionFrame::Ack(_) => self.send(TransferPhase::Write, self.total),
            _ => {}
        }
    }

    /// Verify phase: each item read back.
    fn on_read_frame(&self, frame: &MissionFrame) {
        if let MissionFrame::ItemInt(d) = frame {
            self.send(TransferPhase::Verify, d.seq + 1);
        }
    }
}

async fn send_all(
    outgoing: &mpsc::Sender<Outgoing>,
    msgs: Vec<mavlink::dialects::ardupilotmega::MavMessage>,
) -> Result<(), MissionError> {
    for message in msgs {
        outgoing
            .send(Outgoing { message })
            .await
            .map_err(|_| MissionError::LinkClosed)?;
    }
    Ok(())
}

fn done_to_error(done: Done) -> MissionError {
    match done {
        Done::Ok => unreachable!("Ok is handled by the caller"),
        Done::Timeout => MissionError::Timeout,
        Done::Rejected(r) => MissionError::Rejected(format!("{r:?}")),
    }
}

async fn run_upload(
    mut up: Upload,
    rx: &mut broadcast::Receiver<(SysId, MissionFrame)>,
    sysid: SysId,
    outgoing: &mpsc::Sender<Outgoing>,
    started: Instant,
    report: &Reporter,
) -> Result<(), MissionError> {
    let mut tick = tokio::time::interval(TICK);
    loop {
        let (next, out, done) = tokio::select! {
            frame = rx.recv() => match frame {
                Ok((s, frame)) if s == sysid => {
                    report.on_write_frame(&frame);
                    up.on_message(&frame.into_message(), started.elapsed().as_millis() as u64)
                }
                Ok(_) | Err(broadcast::error::RecvError::Lagged(_)) => (up, Vec::new(), None),
                Err(broadcast::error::RecvError::Closed) => return Err(MissionError::LinkClosed),
            },
            _ = tick.tick() => up.on_tick(started.elapsed().as_millis() as u64),
        };
        up = next;
        send_all(outgoing, out).await?;
        match done {
            Some(Done::Ok) => return Ok(()),
            Some(other) => return Err(done_to_error(other)),
            None => {}
        }
    }
}

async fn run_download(
    sysid: SysId,
    component: u8,
    gcs: u8,
    rx: &mut broadcast::Receiver<(SysId, MissionFrame)>,
    outgoing: &mpsc::Sender<Outgoing>,
    started: Instant,
    report: Option<&Reporter>,
) -> Result<Mission, MissionError> {
    let (dl, out) = Download::start(sysid, component, started.elapsed().as_millis() as u64);
    let mut dl = dl.for_gcs(gcs);
    send_all(outgoing, out).await?;
    let mut tick = tokio::time::interval(TICK);
    loop {
        let (next, out, result) = tokio::select! {
            frame = rx.recv() => match frame {
                Ok((s, frame)) if s == sysid => {
                    if let Some(r) = report {
                        r.on_read_frame(&frame);
                    }
                    dl.on_message(&frame.into_message(), started.elapsed().as_millis() as u64)
                }
                Ok(_) | Err(broadcast::error::RecvError::Lagged(_)) => (dl, Vec::new(), None),
                Err(broadcast::error::RecvError::Closed) => return Err(MissionError::LinkClosed),
            },
            _ = tick.tick() => dl.on_tick(started.elapsed().as_millis() as u64),
        };
        dl = next;
        send_all(outgoing, out).await?;
        match result {
            Some(Ok(mission)) => return Ok(mission),
            Some(Err(done)) => return Err(done_to_error(done)),
            None => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rgcs_core::demo20;

    #[test]
    fn frame_of_non_positional_items_is_not_compared() {
        // ArduPilot stores no frame for RTL / DO_* items and reads them back as MAV_FRAME_GLOBAL.
        let a = demo20();
        let mut b = a.clone();
        b.items[19].frame = rgcs_core::MissionFrame::Abs;
        assert!(mismatches(&a, &b).is_empty(), "{:?}", mismatches(&a, &b));
        b.items[1].frame = rgcs_core::MissionFrame::Abs;
        assert_eq!(
            mismatches(&a, &b),
            vec![2],
            "positional items still compare the frame"
        );
    }

    #[test]
    fn centimetre_altitude_rounding_is_not_a_mismatch() {
        let mut a = demo20();
        a.items[2].alt = 30.123;
        let mut b = a.clone();
        b.items[2].alt = 30.12;
        assert!(mismatches(&a, &b).is_empty());
        b.items[2].alt = 30.2;
        assert_eq!(mismatches(&a, &b), vec![3]);
    }

    #[test]
    fn mismatches_report_changed_and_missing_sequences() {
        let a = demo20();
        let mut b = a.clone();
        b.items[2].alt += 1.0;
        b.items.truncate(19);
        assert_eq!(mismatches(&a, &b), vec![3, 20]);
        assert!(mismatches(&a, &a).is_empty());
    }
}
