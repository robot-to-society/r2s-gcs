//! `SET_MESSAGE_INTERVAL` requests, only for streams that are not already flowing.
//!
//! Ported from the Python app's `mavlink_source.py`: after the first flight-controller
//! HEARTBEAT wait 10 s; then, on every heartbeat, request any stream whose last sample is
//! older than 3 s, at most once per 5 s. If Mission Planner (or Rpanion) already asked for
//! the streams, the FC's settings are never touched.

use std::collections::HashMap;

pub const MSG_ID_GLOBAL_POSITION_INT: u32 = 33;
pub const MSG_ID_SYSTEM_TIME: u32 = 2;
pub const MSG_ID_ATTITUDE: u32 = 30;
pub const MSG_ID_VFR_HUD: u32 = 74;
pub const MSG_ID_SYS_STATUS: u32 = 1;
pub const MSG_ID_GPS_RAW_INT: u32 = 24;
pub const MSG_ID_MISSION_CURRENT: u32 = 42;
pub const MSG_ID_NAV_CONTROLLER_OUTPUT: u32 = 62;
pub const MSG_ID_POSITION_TARGET_GLOBAL_INT: u32 = 87;
pub const MSG_ID_HOME_POSITION: u32 = 242;

const GRACE_MS: u64 = 10_000;
const RETRY_MS: u64 = 5_000;
const STALE_MS: u64 = 3_000;

/// Streams we need and the interval (µs) to ask for.
pub const WANTED: &[(u32, u32)] = &[
    (MSG_ID_GLOBAL_POSITION_INT, 100_000),
    (MSG_ID_SYSTEM_TIME, 1_000_000),
    (MSG_ID_ATTITUDE, 100_000),
    (MSG_ID_VFR_HUD, 250_000),
    (MSG_ID_SYS_STATUS, 500_000),
    (MSG_ID_GPS_RAW_INT, 500_000),
    (MSG_ID_MISSION_CURRENT, 1_000_000),
    (MSG_ID_NAV_CONTROLLER_OUTPUT, 500_000),
    (MSG_ID_POSITION_TARGET_GLOBAL_INT, 1_000_000),
    (MSG_ID_HOME_POSITION, 5_000_000),
];

/// Streams that only flow in some states (POSITION_TARGET_GLOBAL_INT in GUIDED, HOME_POSITION
/// once home is set): asked for once, never retried, so the FC is not nagged forever.
const ONCE: &[u32] = &[MSG_ID_POSITION_TARGET_GLOBAL_INT, MSG_ID_HOME_POSITION];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IntervalRequest {
    pub msg_id: u32,
    pub interval_us: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct IntervalRequester {
    first_heartbeat_at: Option<u64>,
    last_request: HashMap<u32, u64>,
}

impl IntervalRequester {
    /// `last_seen` maps message id → monotonic ms of the latest sample (absent = never seen).
    /// Returns the updated requester and the requests to send now.
    pub fn on_heartbeat(&self, now_ms: u64, last_seen: &HashMap<u32, u64>) -> (Self, Vec<IntervalRequest>) {
        let first = self.first_heartbeat_at.unwrap_or(now_ms);
        let mut next = Self {
            first_heartbeat_at: Some(first),
            last_request: self.last_request.clone(),
        };
        if now_ms.saturating_sub(first) < GRACE_MS {
            return (next, Vec::new());
        }
        let requests: Vec<IntervalRequest> = WANTED
            .iter()
            .filter(|(id, interval_us)| is_stale(last_seen.get(id).copied(), now_ms, *interval_us))
            .filter(|(id, _)| match self.last_request.get(id) {
                None => true,
                Some(_) if ONCE.contains(id) => false,
                Some(t) => now_ms.saturating_sub(*t) >= RETRY_MS,
            })
            .map(|&(msg_id, interval_us)| IntervalRequest { msg_id, interval_us })
            .collect();
        for r in &requests {
            next.last_request.insert(r.msg_id, now_ms);
        }
        (next, requests)
    }
}

/// Stale after 3 s, or 2.5 intervals for slower streams (HOME_POSITION at 5 s).
fn is_stale(last: Option<u64>, now_ms: u64, interval_us: u32) -> bool {
    let limit = STALE_MS.max(u64::from(interval_us) / 1000 * 5 / 2);
    last.is_none_or(|t| now_ms.saturating_sub(t) > limit)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(reqs: &[IntervalRequest]) -> Vec<u32> {
        reqs.iter().map(|r| r.msg_id).collect()
    }

    #[test]
    fn slow_streams_seen_recently_are_not_re_requested() {
        // HOME_POSITION at 5 s, last seen 4 s ago: still flowing
        let r = IntervalRequester::default();
        let (r, _) = r.on_heartbeat(10_000, &HashMap::new());
        let now = 30_000;
        let seen: HashMap<u32, u64> = WANTED
            .iter()
            .map(|(id, _)| (*id, now - 500))
            .chain([(MSG_ID_HOME_POSITION, now - 4_000)])
            .collect();
        let (_, reqs) = r.on_heartbeat(now, &seen);
        assert!(!ids(&reqs).contains(&MSG_ID_HOME_POSITION), "{reqs:?}");
    }

    #[test]
    fn mode_dependent_streams_are_requested_once() {
        // POSITION_TARGET_GLOBAL_INT only flows in GUIDED: one request, then never again
        let mut r = IntervalRequester::default();
        let mut count = 0;
        for now in (10_000..120_000).step_by(1_000) {
            let seen: HashMap<u32, u64> = WANTED
                .iter()
                .filter(|(id, _)| *id != MSG_ID_POSITION_TARGET_GLOBAL_INT)
                .map(|(id, _)| (*id, now))
                .collect();
            let (next, reqs) = r.on_heartbeat(now, &seen);
            count += ids(&reqs)
                .iter()
                .filter(|id| **id == MSG_ID_POSITION_TARGET_GLOBAL_INT)
                .count();
            r = next;
        }
        assert_eq!(count, 1);
    }

    #[test]
    fn mission_current_is_a_wanted_stream() {
        assert!(WANTED.contains(&(MSG_ID_MISSION_CURRENT, 1_000_000)));
    }

    #[test]
    fn no_request_during_grace_period() {
        let r = IntervalRequester::default();
        let seen = HashMap::new();
        let (r, a) = r.on_heartbeat(10_000, &seen);
        let (r, b) = r.on_heartbeat(15_000, &seen);
        let (_, c) = r.on_heartbeat(19_900, &seen);
        assert!(a.is_empty() && b.is_empty() && c.is_empty());
    }

    #[test]
    fn requests_missing_streams_after_10s() {
        let r = IntervalRequester::default();
        let (r, _) = r.on_heartbeat(10_000, &HashMap::new());
        let (_, reqs) = r.on_heartbeat(20_100, &HashMap::new());
        assert_eq!(reqs.len(), WANTED.len());
        let pos = reqs
            .iter()
            .find(|q| q.msg_id == MSG_ID_GLOBAL_POSITION_INT)
            .unwrap();
        assert_eq!(pos.interval_us, 100_000);
        let time = reqs.iter().find(|q| q.msg_id == MSG_ID_SYSTEM_TIME).unwrap();
        assert_eq!(time.interval_us, 1_000_000);
    }

    #[test]
    fn streams_already_flowing_are_left_alone() {
        let mut r = IntervalRequester::default();
        let mut now = 10_000;
        for _ in 0..11 {
            now += 1_000;
            let seen: HashMap<u32, u64> = WANTED.iter().map(|(id, _)| (*id, now)).collect();
            let (next, reqs) = r.on_heartbeat(now, &seen);
            assert!(reqs.is_empty());
            r = next;
        }
    }

    #[test]
    fn only_the_missing_stream_is_requested() {
        let mut r = IntervalRequester::default();
        let mut now = 10_000;
        let mut all = Vec::new();
        for _ in 0..11 {
            now += 1_000;
            let seen: HashMap<u32, u64> = WANTED
                .iter()
                .filter(|(id, _)| *id != MSG_ID_SYSTEM_TIME)
                .map(|(id, _)| (*id, now))
                .collect();
            let (next, reqs) = r.on_heartbeat(now, &seen);
            all.extend(reqs);
            r = next;
        }
        assert_eq!(ids(&all), vec![MSG_ID_SYSTEM_TIME]);
    }

    #[test]
    fn retries_every_5s_while_still_missing() {
        let r = IntervalRequester::default();
        let seen = HashMap::new();
        let (r, _) = r.on_heartbeat(0, &seen);
        let (r, a) = r.on_heartbeat(10_000, &seen);
        let (r, b) = r.on_heartbeat(12_000, &seen);
        let (_, c) = r.on_heartbeat(15_000, &seen);
        assert_eq!(a.len(), WANTED.len());
        assert!(b.is_empty());
        assert_eq!(
            c.len(),
            WANTED.len() - ONCE.len(),
            "state-dependent streams are not retried"
        );
    }
}
