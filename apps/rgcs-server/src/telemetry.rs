//! Turns router events into WebSocket frames: immediate frames for discoveries and
//! messages, and a 10 Hz diff of every vehicle state (spec 30 §3, 50 §3.1).

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use rgcs_core::{diff, LinkStatus, ServerMessage, SysId, VehicleMessage, VehicleState, VehicleStateDiff};
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

/// Link-change messages are minted here, not by the router; keep their ids far from its range.
pub const LINK_MESSAGE_ID_BASE: u64 = 1 << 40;
static NEXT_LINK_MESSAGE_ID: AtomicU64 = AtomicU64::new(LINK_MESSAGE_ID_BASE);

/// Text codes the UI translates (spec 50 §3.1 `vehicle_message`); vehicle text stays verbatim.
fn link_code(to: LinkStatus) -> (&'static str, u8) {
    match to {
        LinkStatus::Delay => ("comms_delay", 4),
        LinkStatus::Lost => ("link_lost", 4),
        LinkStatus::Ok => ("link_restored", 6),
    }
}

/// The WebSocket frame for one router event, if the clients need to hear about it.
pub fn event_frame(ev: RouterEvent, now_ms: u64) -> Option<ServerMessage> {
    match ev {
        RouterEvent::Discovered(sysid) => Some(ServerMessage::VehicleDiscovered { sysid }),
        RouterEvent::Message(m) => Some(ServerMessage::VehicleMessage(m)),
        RouterEvent::LinkChanged { sysid, to, .. } => {
            let (text, severity) = link_code(to);
            Some(ServerMessage::VehicleMessage(VehicleMessage {
                sysid,
                id: NEXT_LINK_MESSAGE_ID.fetch_add(1, Ordering::Relaxed),
                severity,
                text: text.into(),
                ts: now_ms,
            }))
        }
        RouterEvent::Updated(_) | RouterEvent::ParamValue { .. } | RouterEvent::Mission { .. } => None,
    }
}

/// Forwards discovery / message / link events straight to the clients; caches PARAM_VALUEs.
pub async fn pump_events(
    mut events: mpsc::Receiver<RouterEvent>,
    tx: broadcast::Sender<ServerMessage>,
    params: crate::params::ParamStore,
) {
    while let Some(ev) = events.recv().await {
        params.apply(&ev);
        if let Some(f) = event_frame(ev, crate::app::unix_ms()) {
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
    use rgcs_core::LinkStatus;

    #[test]
    fn link_changes_become_vehicle_messages_with_stable_codes() {
        let f = |from, to| event_frame(RouterEvent::LinkChanged { sysid: 1, from, to }, 1_000);
        let texts: Vec<(u8, String)> = [
            f(LinkStatus::Ok, LinkStatus::Delay),
            f(LinkStatus::Delay, LinkStatus::Lost),
            f(LinkStatus::Lost, LinkStatus::Ok),
        ]
        .into_iter()
        .map(|fr| match fr {
            Some(ServerMessage::VehicleMessage(m)) => (m.severity, m.text),
            other => panic!("{other:?}"),
        })
        .collect();
        assert_eq!(
            texts,
            vec![
                (4, "comms_delay".into()),
                (4, "link_lost".into()),
                (6, "link_restored".into())
            ]
        );
        assert!(event_frame(RouterEvent::Updated(1), 0).is_none());
    }

    #[test]
    fn link_message_ids_are_unique_and_do_not_collide_with_router_ids() {
        let a = event_frame(
            RouterEvent::LinkChanged {
                sysid: 1,
                from: LinkStatus::Ok,
                to: LinkStatus::Delay,
            },
            0,
        );
        let b = event_frame(
            RouterEvent::LinkChanged {
                sysid: 1,
                from: LinkStatus::Delay,
                to: LinkStatus::Ok,
            },
            0,
        );
        let id = |f: Option<ServerMessage>| match f {
            Some(ServerMessage::VehicleMessage(m)) => m.id,
            other => panic!("{other:?}"),
        };
        let (ia, ib) = (id(a), id(b));
        assert_ne!(ia, ib);
        assert!(ia >= LINK_MESSAGE_ID_BASE && ib >= LINK_MESSAGE_ID_BASE);
    }

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
