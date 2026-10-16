//! Turns router events into WebSocket frames: immediate frames for discoveries and
//! messages, and a 10 Hz diff of every vehicle state (spec 30 §3, 50 §3.1).

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use rgcs_core::{diff, ServerMessage, SysId, VehicleState, VehicleStateDiff};
use rgcs_mavlink::{Router, RouterEvent};
use tokio::sync::{broadcast, mpsc, Mutex};

/// Frames to send for the current states, given what each client last saw.
/// Returns the frames and the new "last sent" map.
pub fn diff_frames(
    last_sent: &HashMap<SysId, VehicleState>,
    current: &[VehicleState],
) -> (Vec<ServerMessage>, HashMap<SysId, VehicleState>) {
    let mut frames = Vec::new();
    let mut next = HashMap::with_capacity(current.len());
    for state in current {
        let frame = match last_sent.get(&state.sysid) {
            None => Some(VehicleStateDiff::full(state)),
            Some(prev) => diff(prev, state),
        };
        if let Some(d) = frame {
            frames.push(ServerMessage::Telemetry {
                sysid: state.sysid,
                diff: d,
            });
        }
        next.insert(state.sysid, state.clone());
    }
    (frames, next)
}

/// Forwards discovery / message events straight to the clients.
pub async fn pump_events(mut events: mpsc::Receiver<RouterEvent>, tx: broadcast::Sender<ServerMessage>) {
    while let Some(ev) = events.recv().await {
        let frame = match ev {
            RouterEvent::Discovered(sysid) => Some(ServerMessage::VehicleDiscovered { sysid }),
            RouterEvent::Message(m) => Some(ServerMessage::VehicleMessage(m)),
            RouterEvent::Updated(_) => None,
        };
        if let Some(f) = frame {
            let _ = tx.send(f);
        }
    }
}

/// Emits telemetry diffs at a fixed interval for the lifetime of the server. A stalled tick
/// (long router lock) is skipped rather than replayed as a burst.
pub async fn diff_loop(router: Arc<Mutex<Router>>, tx: broadcast::Sender<ServerMessage>, interval: Duration) {
    let mut ticker = tokio::time::interval(interval);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut last_sent: HashMap<SysId, VehicleState> = HashMap::new();
    loop {
        ticker.tick().await;
        let current = router.lock().await.states();
        let (frames, next) = diff_frames(&last_sent, &current);
        last_sent = next;
        for f in frames {
            let _ = tx.send(f);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_sight_sends_the_full_state_then_only_changes() {
        let v = VehicleState::new(1, "UAV-01");
        let (frames, sent) = diff_frames(&HashMap::new(), std::slice::from_ref(&v));
        assert_eq!(frames.len(), 1);
        match &frames[0] {
            ServerMessage::Telemetry { sysid, diff } => {
                assert_eq!(*sysid, 1);
                assert_eq!(diff.name.as_deref(), Some("UAV-01"));
            }
            other => panic!("{other:?}"),
        }
        let (frames, _) = diff_frames(&sent, std::slice::from_ref(&v));
        assert!(frames.is_empty());
        let moved = VehicleState { alt_rel: 5.0, ..v };
        let (frames, _) = diff_frames(&sent, &[moved]);
        assert_eq!(frames.len(), 1);
        match &frames[0] {
            ServerMessage::Telemetry { diff, .. } => {
                assert_eq!((diff.alt_rel, diff.name.is_none()), (Some(5.0), true))
            }
            other => panic!("{other:?}"),
        }
    }
}
