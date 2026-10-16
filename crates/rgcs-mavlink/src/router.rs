//! Per-system routing: one [`VehicleState`] (+ `watch` channel) per MAVLink system id.
//!
//! The router is a plain state machine driven by `on_message` / `tick`; the async link
//! task in [`crate::connection`] owns it behind a mutex.

use std::collections::HashMap;

use mavlink::dialects::ardupilotmega::MavMessage;
use mavlink::{MavHeader, Message};
use rgcs_core::{SysId, VehicleMessage, VehicleState};
use tokio::sync::watch;

use crate::decode;
use crate::heartbeat::{is_flight_controller, link_status};

/// Timestamps supplied by the caller: a monotonic clock for ages, wall time for messages.
#[derive(Debug, Clone, Copy, Default)]
pub struct Clock {
    pub mono_ms: u64,
    pub unix_ms: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum RouterEvent {
    Discovered(SysId),
    Updated(SysId),
    Message(VehicleMessage),
}

struct Slot {
    state: VehicleState,
    tx: watch::Sender<VehicleState>,
    /// Component id of the flight controller; only its frames count as link liveness
    /// (a companion computer or camera on the same sysid must not keep the link "OK").
    fc_component: u8,
    last_rx_ms: u64,
    last_seen: HashMap<u32, u64>,
}

#[derive(Default)]
pub struct Router {
    slots: HashMap<SysId, Slot>,
    next_message_id: u64,
}

impl Router {
    /// Route one received frame. Only flight-controller heartbeats create a vehicle; frames
    /// from other components on the same sysid are ignored.
    pub fn on_message(&mut self, header: &MavHeader, msg: &MavMessage, clock: Clock) -> Vec<RouterEvent> {
        let sysid = header.system_id;
        let mut events = Vec::new();
        if !self.slots.contains_key(&sysid) {
            match msg {
                MavMessage::HEARTBEAT(hb) if is_flight_controller(hb.autopilot) => {
                    self.insert(sysid, header.component_id);
                    events.push(RouterEvent::Discovered(sysid));
                }
                _ => return events,
            }
        }
        let message_id = self.alloc_message_id(msg);
        let slot = self.slots.get_mut(&sysid).expect("slot inserted above");
        if header.component_id != slot.fc_component {
            return events;
        }
        slot.last_rx_ms = clock.mono_ms;
        slot.last_seen.insert(msg.message_id(), clock.mono_ms);
        if let (MavMessage::STATUSTEXT(st), Some(id)) = (msg, message_id) {
            let text = String::from_utf8_lossy(&*st.text)
                .trim_end_matches('\0')
                .to_string();
            let severity = st.severity as u8;
            events.push(RouterEvent::Message(VehicleMessage {
                sysid,
                id,
                severity,
                text,
                ts: clock.unix_ms,
            }));
        }
        if let Some(next) = decode::apply(&slot.state, msg) {
            // A frame from the FC proves the link is alive right now; `tick` ages it again.
            let next = VehicleState {
                last_rx_ms: 0,
                link: link_status(0),
                ..next
            };
            slot.state = next.clone();
            let _ = slot.tx.send(next);
            events.push(RouterEvent::Updated(sysid));
        }
        events
    }

    fn alloc_message_id(&mut self, msg: &MavMessage) -> Option<u64> {
        if !matches!(msg, MavMessage::STATUSTEXT(_)) {
            return None;
        }
        let id = self.next_message_id;
        self.next_message_id += 1;
        Some(id)
    }

    /// Refresh link health / message ages. Call about once a second.
    pub fn tick(&mut self, clock: Clock) -> Vec<RouterEvent> {
        let mut events = Vec::new();
        for (sysid, slot) in self.slots.iter_mut() {
            let age = clock.mono_ms.saturating_sub(slot.last_rx_ms);
            let link = link_status(age);
            if slot.state.link != link || slot.state.last_rx_ms != age {
                let next = VehicleState {
                    link,
                    last_rx_ms: age,
                    ..slot.state.clone()
                };
                slot.state = next.clone();
                let _ = slot.tx.send(next);
                events.push(RouterEvent::Updated(*sysid));
            }
        }
        events
    }

    pub fn states(&self) -> Vec<VehicleState> {
        let mut v: Vec<VehicleState> = self.slots.values().map(|s| s.state.clone()).collect();
        v.sort_by_key(|s| s.sysid);
        v
    }

    pub fn state(&self, sysid: SysId) -> Option<&VehicleState> {
        self.slots.get(&sysid).map(|s| &s.state)
    }

    pub fn subscribe(&self, sysid: SysId) -> Option<watch::Receiver<VehicleState>> {
        self.slots.get(&sysid).map(|s| s.tx.subscribe())
    }

    /// Monotonic ms of the latest sample per message id (for the interval requester).
    pub fn last_seen(&self, sysid: SysId) -> HashMap<u32, u64> {
        self.slots
            .get(&sysid)
            .map(|s| s.last_seen.clone())
            .unwrap_or_default()
    }

    fn insert(&mut self, sysid: SysId, fc_component: u8) {
        let state = VehicleState::new(sysid, format!("UAV-{sysid:02}"));
        let (tx, _rx) = watch::channel(state.clone());
        let slot = Slot {
            state,
            tx,
            fc_component,
            last_rx_ms: 0,
            last_seen: HashMap::new(),
        };
        self.slots.insert(sysid, slot);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mavlink::dialects::ardupilotmega::{
        MavAutopilot, MavSeverity, MavType, HEARTBEAT_DATA, STATUSTEXT_DATA,
    };
    use rgcs_core::LinkStatus;

    fn header(sysid: u8) -> MavHeader {
        MavHeader {
            system_id: sysid,
            component_id: 1,
            sequence: 0,
        }
    }

    fn fc_heartbeat() -> MavMessage {
        MavMessage::HEARTBEAT(HEARTBEAT_DATA {
            mavtype: MavType::MAV_TYPE_QUADROTOR,
            autopilot: MavAutopilot::MAV_AUTOPILOT_ARDUPILOTMEGA,
            ..HEARTBEAT_DATA::DEFAULT
        })
    }

    fn clock(mono_ms: u64) -> Clock {
        Clock {
            mono_ms,
            unix_ms: 1_700_000_000_000 + mono_ms,
        }
    }

    #[test]
    fn fc_heartbeat_discovers_a_vehicle() {
        let mut r = Router::default();
        let ev = r.on_message(&header(1), &fc_heartbeat(), clock(0));
        assert_eq!(ev, vec![RouterEvent::Discovered(1), RouterEvent::Updated(1)]);
        assert_eq!(r.states()[0].name, "UAV-01");
        assert_eq!(r.states()[0].kind, rgcs_core::VehicleKind::Copter);
    }

    #[test]
    fn gcs_heartbeat_and_unknown_systems_are_ignored() {
        let mut r = Router::default();
        let gcs = MavMessage::HEARTBEAT(HEARTBEAT_DATA {
            autopilot: MavAutopilot::MAV_AUTOPILOT_INVALID,
            ..HEARTBEAT_DATA::DEFAULT
        });
        assert!(r.on_message(&header(255), &gcs, clock(0)).is_empty());
        assert!(r
            .on_message(&header(7), &MavMessage::VFR_HUD(Default::default()), clock(0))
            .is_empty());
        assert!(r.states().is_empty());
    }

    #[test]
    fn statustext_becomes_a_vehicle_message() {
        let mut r = Router::default();
        r.on_message(&header(1), &fc_heartbeat(), clock(0));
        let st = MavMessage::STATUSTEXT(STATUSTEXT_DATA {
            severity: MavSeverity::MAV_SEVERITY_WARNING,
            text: "PreArm: Compass not calibrated".into(),
        });
        let ev = r.on_message(&header(1), &st, clock(100));
        match &ev[0] {
            RouterEvent::Message(m) => {
                assert_eq!(m.severity, 4);
                assert_eq!(m.text, "PreArm: Compass not calibrated");
                assert_eq!(m.ts, 1_700_000_000_100);
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn tick_degrades_the_link_with_age() {
        let mut r = Router::default();
        r.on_message(&header(1), &fc_heartbeat(), clock(0));
        assert!(r.tick(clock(1_000)).len() == 1);
        assert_eq!(r.state(1).unwrap().link, LinkStatus::Ok);
        r.tick(clock(3_500));
        assert_eq!(r.state(1).unwrap().link, LinkStatus::Delay);
        r.tick(clock(12_000));
        assert_eq!(r.state(1).unwrap().link, LinkStatus::Lost);
        assert_eq!(r.state(1).unwrap().last_rx_ms, 12_000);
        r.on_message(&header(1), &fc_heartbeat(), clock(12_100));
        assert_eq!(r.state(1).unwrap().link, LinkStatus::Ok);
    }

    #[test]
    fn companion_components_do_not_keep_the_link_alive() {
        let mut r = Router::default();
        r.on_message(&header(1), &fc_heartbeat(), clock(0));
        let companion = MavHeader {
            system_id: 1,
            component_id: 191,
            sequence: 0,
        };
        r.tick(clock(12_000));
        assert_eq!(r.state(1).unwrap().link, LinkStatus::Lost);
        let evs = r.on_message(
            &companion,
            &MavMessage::VFR_HUD(Default::default()),
            clock(12_100),
        );
        assert!(evs.is_empty());
        assert_eq!(r.state(1).unwrap().link, LinkStatus::Lost);
    }

    #[test]
    fn watch_subscribers_see_updates_and_last_seen_tracks_ids() {
        let mut r = Router::default();
        r.on_message(&header(1), &fc_heartbeat(), clock(0));
        let rx = r.subscribe(1).unwrap();
        r.on_message(&header(1), &MavMessage::VFR_HUD(Default::default()), clock(50));
        assert_eq!(rx.borrow().sysid, 1);
        assert_eq!(r.last_seen(1).get(&74), Some(&50));
        assert_eq!(r.last_seen(1).get(&0), Some(&0));
    }
}
