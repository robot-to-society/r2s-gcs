//! Flight detection (addendum §5.6): first ARM … last DISARM becomes one 様式 1 draft.
//! A re-ARM within [`REARM_WINDOW_MS`] continues the same flight; a link lost for
//! [`LOST_LANDING_MS`] while armed lands the flight at the last heartbeat.

use std::collections::HashMap;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use rgcs_core::{LinkStatus, ServerMessage, SysId, VehicleState};
use rgcs_mavlink::Router;
use rgcs_store::Store;
use tokio::sync::{broadcast, Mutex};

pub const REARM_WINDOW_MS: u64 = 600_000;
pub const LOST_LANDING_MS: u64 = 600_000;
pub const TICK: Duration = Duration::from_secs(1);

/// Per-vehicle memory of the detector.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Track {
    pub armed: bool,
    /// The flight row still eligible for a re-ARM (open, or landed inside the window).
    pub open: Option<i64>,
    pub last_disarm_ms: Option<u64>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Transition {
    Takeoff {
        sysid: SysId,
        at: u64,
        lat: Option<f64>,
        lon: Option<f64>,
    },
    Reopen {
        sysid: SysId,
        id: i64,
    },
    Landing {
        sysid: SysId,
        id: i64,
        at: u64,
        lat: Option<f64>,
        lon: Option<f64>,
    },
}

/// `None` without a 2D/3D fix or while the position is the 0,0 placeholder.
fn position(s: &VehicleState) -> (Option<f64>, Option<f64>) {
    if s.gps.fix < 2 || (s.lat == 0.0 && s.lon == 0.0) {
        (None, None)
    } else {
        (Some(s.lat), Some(s.lon))
    }
}

fn step_one(track: &mut Track, now_ms: u64, s: &VehicleState) -> Option<Transition> {
    let sysid = s.sysid;
    if track.open.is_some()
        && !track.armed
        && track
            .last_disarm_ms
            .is_some_and(|d| now_ms.saturating_sub(d) >= REARM_WINDOW_MS)
    {
        track.open = None;
        track.last_disarm_ms = None;
    }
    if s.link == LinkStatus::Lost {
        // A lost vehicle's `armed` is stale: only the lost-landing rule applies.
        if track.armed && now_ms.saturating_sub(s.last_rx_ms) >= LOST_LANDING_MS {
            track.armed = false;
            track.last_disarm_ms = Some(s.last_rx_ms);
            let (lat, lon) = position(s);
            return track.open.map(|id| Transition::Landing {
                sysid,
                id,
                at: s.last_rx_ms,
                lat,
                lon,
            });
        }
        return None;
    }
    match (track.armed, s.armed) {
        (false, true) => {
            track.armed = true;
            let (lat, lon) = position(s);
            match (track.open, track.last_disarm_ms) {
                (Some(id), Some(d)) if now_ms.saturating_sub(d) < REARM_WINDOW_MS => {
                    Some(Transition::Reopen { sysid, id })
                }
                _ => {
                    track.open = None;
                    Some(Transition::Takeoff {
                        sysid,
                        at: now_ms,
                        lat,
                        lon,
                    })
                }
            }
        }
        (true, false) => {
            track.armed = false;
            track.last_disarm_ms = Some(now_ms);
            let (lat, lon) = position(s);
            track.open.map(|id| Transition::Landing {
                sysid,
                id,
                at: now_ms,
                lat,
                lon,
            })
        }
        _ => None,
    }
}

/// Pure detector step: compares every vehicle with its track and returns what changed.
/// After a `Takeoff` the track's `open` stays `None` until `apply` stores the new row.
pub fn step(tracks: &mut HashMap<SysId, Track>, now_ms: u64, states: &[VehicleState]) -> Vec<Transition> {
    states
        .iter()
        .filter_map(|s| step_one(tracks.entry(s.sysid).or_default(), now_ms, s))
        .collect()
}

#[derive(Clone)]
pub struct FlightTracker {
    store: Store,
    tx: broadcast::Sender<ServerMessage>,
    tracks: Arc<StdMutex<HashMap<SysId, Track>>>,
}

impl FlightTracker {
    pub fn new(store: Store, tx: broadcast::Sender<ServerMessage>) -> Self {
        Self {
            store,
            tx,
            tracks: Arc::new(StdMutex::new(HashMap::new())),
        }
    }

    /// One detector tick over the router's current states.
    pub async fn poll(&self, router: &Mutex<Router>, now_ms: u64) {
        let states = router.lock().await.states();
        let transitions = {
            let mut tracks = self.tracks.lock().unwrap_or_else(|e| e.into_inner());
            step(&mut tracks, now_ms, &states)
        };
        self.apply(transitions).await;
    }

    async fn pilot_of(&self, sysid: SysId) -> (String, String) {
        let Ok(Some(username)) = self.store.last_operator(sysid).await else {
            return (String::new(), String::new());
        };
        match self.store.pilot(&username).await {
            Ok(Some(p)) => {
                let name = if p.full_name.is_empty() {
                    p.username
                } else {
                    p.full_name
                };
                (name, p.license_no)
            }
            _ => (username, String::new()),
        }
    }

    fn set_open(&self, sysid: SysId, id: Option<i64>) {
        let mut tracks = self.tracks.lock().unwrap_or_else(|e| e.into_inner());
        tracks.entry(sysid).or_default().open = id;
    }

    /// Writes the transitions to the store and broadcasts `flight_draft_created` on landings.
    pub async fn apply(&self, transitions: Vec<Transition>) {
        for t in transitions {
            let result = match t {
                Transition::Takeoff { sysid, at, lat, lon } => {
                    let (pilot, license) = self.pilot_of(sysid).await;
                    match self
                        .store
                        .open_flight(sysid, &pilot, &license, at, lat, lon, "system")
                        .await
                    {
                        Ok(id) => {
                            self.set_open(sysid, Some(id));
                            Ok(())
                        }
                        Err(e) => Err(e),
                    }
                }
                Transition::Reopen { id, .. } => self.store.reopen_flight(id).await,
                Transition::Landing {
                    sysid,
                    id,
                    at,
                    lat,
                    lon,
                } => match self.store.land_flight(id, at, lat, lon).await {
                    Ok(()) => {
                        if let Ok(Some(flight)) = self.store.flight(id).await {
                            let _ = self.tx.send(ServerMessage::FlightDraftCreated { sysid, flight });
                        }
                        Ok(())
                    }
                    Err(e) => Err(e),
                },
            };
            if let Err(e) = result {
                tracing::warn!(error = %e, "flight tracker store write failed");
            }
        }
    }

    /// 1 Hz loop for the lifetime of the server.
    pub async fn run(self, router: Arc<Mutex<Router>>) {
        let mut ticker = tokio::time::interval(TICK);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            ticker.tick().await;
            self.poll(&router, crate::app::unix_ms()).await;
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use rgcs_core::{LinkStatus, VehicleState};

    use super::*;

    fn state(armed: bool) -> VehicleState {
        let mut s = VehicleState::new(1, "UAV-01");
        s.armed = armed;
        s.gps.fix = 3;
        s.lat = 36.1;
        s.lon = 139.3;
        s.last_rx_ms = 1_000;
        s
    }

    fn tracks_with_open(id: i64, last_disarm_ms: u64) -> HashMap<u8, Track> {
        let mut t = HashMap::new();
        t.insert(
            1,
            Track {
                armed: false,
                open: Some(id),
                last_disarm_ms: Some(last_disarm_ms),
            },
        );
        t
    }

    #[test]
    fn arm_then_disarm_is_one_takeoff_and_one_landing() {
        let mut tracks = HashMap::new();
        assert!(step(&mut tracks, 1_000, &[state(false)]).is_empty());
        let t = step(&mut tracks, 2_000, &[state(true)]);
        assert!(matches!(
            t.as_slice(),
            [Transition::Takeoff {
                sysid: 1,
                at: 2_000,
                lat: Some(_),
                lon: Some(_)
            }]
        ));
        assert!(
            step(&mut tracks, 3_000, &[state(true)]).is_empty(),
            "no second takeoff while armed"
        );
        tracks.get_mut(&1).unwrap().open = Some(5);
        let t = step(&mut tracks, 60_000, &[state(false)]);
        assert!(matches!(
            t.as_slice(),
            [Transition::Landing {
                sysid: 1,
                id: 5,
                at: 60_000,
                ..
            }]
        ));
        assert!(step(&mut tracks, 61_000, &[state(false)]).is_empty());
    }

    #[test]
    fn rearm_within_window_extends_the_flight() {
        let mut tracks = tracks_with_open(5, 100_000);
        let t = step(&mut tracks, 400_000, &[state(true)]);
        assert!(matches!(t.as_slice(), [Transition::Reopen { sysid: 1, id: 5 }]));
    }

    #[test]
    fn rearm_after_window_starts_a_new_flight() {
        let mut tracks = tracks_with_open(5, 100_000);
        let t = step(&mut tracks, 100_000 + REARM_WINDOW_MS + 1_000, &[state(true)]);
        assert!(matches!(t.as_slice(), [Transition::Takeoff { sysid: 1, .. }]));
    }

    #[test]
    fn lost_link_lands_the_flight_at_last_rx() {
        let mut tracks = HashMap::new();
        tracks.insert(
            1,
            Track {
                armed: true,
                open: Some(9),
                last_disarm_ms: None,
            },
        );
        let mut lost = state(true);
        lost.link = LinkStatus::Lost;
        lost.last_rx_ms = 50_000;
        assert!(step(&mut tracks, 50_000 + 599_000, &[lost.clone()]).is_empty());
        let t = step(&mut tracks, 50_000 + 600_000, &[lost.clone()]);
        assert!(matches!(
            t.as_slice(),
            [Transition::Landing {
                sysid: 1,
                id: 9,
                at: 50_000,
                ..
            }]
        ));
        assert!(
            step(&mut tracks, 50_000 + 601_000, &[lost]).is_empty(),
            "landed once"
        );
    }

    #[test]
    fn no_fix_means_no_position() {
        let mut tracks = HashMap::new();
        let mut nofix = state(true);
        nofix.gps.fix = 1;
        let t = step(&mut tracks, 1_000, &[nofix]);
        assert!(matches!(
            t.as_slice(),
            [Transition::Takeoff {
                lat: None,
                lon: None,
                ..
            }]
        ));
        let mut tracks = HashMap::new();
        let t = step(&mut tracks, 1_000, &[state(true)]);
        assert!(
            matches!(t.as_slice(), [Transition::Takeoff { lat: Some(l), .. }] if (*l - 36.1).abs() < 1e-9)
        );
    }

    #[test]
    fn armed_at_first_sight_is_a_takeoff() {
        let mut tracks = HashMap::new();
        let t = step(&mut tracks, 5_000, &[state(true)]);
        assert!(matches!(
            t.as_slice(),
            [Transition::Takeoff {
                sysid: 1,
                at: 5_000,
                ..
            }]
        ));
    }
}
