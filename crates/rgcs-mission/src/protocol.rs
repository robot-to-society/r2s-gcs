//! Mission Protocol (MAVLink) upload / download state machines. Pure: messages in, messages
//! out, the caller owns the clock and the link.
//!
//! Upload: `MISSION_COUNT` → answer every `MISSION_REQUEST(_INT)` with the matching
//! `MISSION_ITEM_INT` (seq 0 is home) → `MISSION_ACK`. Download: `MISSION_REQUEST_LIST` →
//! `MISSION_COUNT` → request items one by one → send `MISSION_ACK`. Each step is retried
//! [`ATTEMPTS`] times with a [`STEP_TIMEOUT_MS`] deadline; the timeout / retry values are the
//! builder's call (addendum §6).

use mavlink::dialects::ardupilotmega::{
    MavCmd, MavFrame, MavMessage, MavMissionResult, MavMissionType, MISSION_ACK_DATA, MISSION_COUNT_DATA,
    MISSION_ITEM_INT_DATA, MISSION_REQUEST_INT_DATA, MISSION_REQUEST_LIST_DATA,
};
use num_traits::{FromPrimitive, ToPrimitive};
use rgcs_core::{Home, Mission, MissionFrame, MissionItem, SysId};

pub const STEP_TIMEOUT_MS: u64 = 1_500;
pub const ATTEMPTS: u8 = 3;
/// The GCS identity frames are addressed to (`rgcs_mavlink::connection::GCS_SYSTEM_ID`).
pub const GCS_SYSTEM_ID: u8 = 255;
const MISSION: MavMissionType = MavMissionType::MAV_MISSION_TYPE_MISSION;

#[derive(Debug, Clone, PartialEq)]
pub enum Done {
    Ok,
    /// The vehicle answered `MISSION_ACK` with something other than ACCEPTED.
    Rejected(MavMissionResult),
    Timeout,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ProtocolError {
    /// 1-based sequence of the item whose MAV_CMD id the dialect does not know.
    #[error("item {0} uses a MAV_CMD this build does not know")]
    UnknownCommand(u16),
}

/// Our frame is for us when it names the GCS (or is broadcast) and is about the mission list.
fn for_us(target_system: u8, mission_type: MavMissionType) -> bool {
    (target_system == GCS_SYSTEM_ID || target_system == 0) && mission_type == MISSION
}

pub fn item_to_int(
    seq: u16,
    sysid: SysId,
    component: u8,
    item: &MissionItem,
    current: bool,
) -> Option<MISSION_ITEM_INT_DATA> {
    Some(MISSION_ITEM_INT_DATA {
        param1: item.params[0],
        param2: item.params[1],
        param3: item.params[2],
        param4: item.params[3],
        x: (item.lat * 1e7).round() as i32,
        y: (item.lon * 1e7).round() as i32,
        z: item.alt,
        seq,
        command: MavCmd::from_u16(item.command)?,
        target_system: sysid,
        target_component: component,
        frame: MavFrame::from_u8(item.frame.mav())?,
        current: u8::from(current),
        autocontinue: u8::from(item.autocontinue),
        mission_type: MISSION,
    })
}

/// `None` for a frame we do not model (the item is dropped from a download with a warning upstream).
pub fn int_to_item(d: &MISSION_ITEM_INT_DATA) -> Option<MissionItem> {
    Some(MissionItem {
        command: d.command.to_u16()?,
        frame: MissionFrame::from_mav(d.frame.to_u8()?)?,
        params: [d.param1, d.param2, d.param3, d.param4],
        lat: d.x as f64 / 1e7,
        lon: d.y as f64 / 1e7,
        alt: d.z,
        autocontinue: d.autocontinue != 0,
    })
}

/// A downloaded list: seq 0 becomes `home`, the rest are the items.
pub fn mission_from_items(home: Option<MissionItem>, items: Vec<MissionItem>) -> Mission {
    let default_alt = items
        .iter()
        .find(|it| it.is_positional())
        .map(|it| it.alt)
        .unwrap_or(50.0);
    let default_frame = items
        .iter()
        .find(|it| it.is_positional())
        .map(|it| it.frame)
        .unwrap_or(MissionFrame::Rel);
    Mission {
        id: None,
        name: String::new(),
        sysid: None,
        default_alt,
        default_frame,
        speed: 8.0,
        home: home.map(|h| Home {
            lat: h.lat,
            lon: h.lon,
            alt: h.alt,
        }),
        items,
    }
}

/// Retry bookkeeping shared by both directions.
#[derive(Debug, Clone, PartialEq)]
struct Step {
    last: MavMessage,
    deadline_ms: u64,
    attempts: u8,
}

impl Step {
    fn new(last: MavMessage, now_ms: u64) -> Self {
        Self {
            last,
            deadline_ms: now_ms + STEP_TIMEOUT_MS,
            attempts: 1,
        }
    }

    /// Resend when due; `None` when the attempts are exhausted.
    fn tick(&self, now_ms: u64) -> Option<(Self, Vec<MavMessage>)> {
        if now_ms < self.deadline_ms {
            return Some((self.clone(), Vec::new()));
        }
        if self.attempts >= ATTEMPTS {
            return None;
        }
        Some((
            Self {
                last: self.last.clone(),
                deadline_ms: now_ms + STEP_TIMEOUT_MS,
                attempts: self.attempts + 1,
            },
            vec![self.last.clone()],
        ))
    }
}

#[derive(Debug, Clone)]
pub struct Upload {
    sysid: SysId,
    component: u8,
    /// Home at index 0, then the mission items.
    frames: Vec<MISSION_ITEM_INT_DATA>,
    step: Step,
}

fn home_item(m: &Mission) -> MissionItem {
    let (lat, lon, alt) = match &m.home {
        Some(h) => (h.lat, h.lon, h.alt),
        None => m
            .items
            .iter()
            .find(|it| it.is_positional() && !(it.lat == 0.0 && it.lon == 0.0))
            .map(|it| (it.lat, it.lon, 0.0))
            .unwrap_or((0.0, 0.0, 0.0)),
    };
    MissionItem {
        command: 16,
        frame: MissionFrame::Abs,
        params: [0.0; 4],
        lat,
        lon,
        alt,
        autocontinue: true,
    }
}

impl Upload {
    /// Emits `MISSION_COUNT` (items + home).
    pub fn start(
        sysid: SysId,
        component: u8,
        mission: &Mission,
        now_ms: u64,
    ) -> Result<(Self, Vec<MavMessage>), ProtocolError> {
        let mut frames = Vec::with_capacity(mission.items.len() + 1);
        frames.push(
            item_to_int(0, sysid, component, &home_item(mission), true)
                .ok_or(ProtocolError::UnknownCommand(0))?,
        );
        for (i, it) in mission.items.iter().enumerate() {
            let seq = (i + 1) as u16;
            frames.push(
                item_to_int(seq, sysid, component, it, false).ok_or(ProtocolError::UnknownCommand(seq))?,
            );
        }
        let count = MavMessage::MISSION_COUNT(MISSION_COUNT_DATA {
            count: frames.len() as u16,
            target_system: sysid,
            target_component: component,
            mission_type: MISSION,
            opaque_id: 0,
        });
        Ok((
            Self {
                sysid,
                component,
                frames,
                step: Step::new(count.clone(), now_ms),
            },
            vec![count],
        ))
    }

    fn requested(self, seq: u16, now_ms: u64) -> (Self, Vec<MavMessage>, Option<Done>) {
        let Some(frame) = self.frames.get(seq as usize) else {
            return (self, Vec::new(), None);
        };
        let msg = MavMessage::MISSION_ITEM_INT(frame.clone());
        (
            Self {
                step: Step::new(msg.clone(), now_ms),
                ..self
            },
            vec![msg],
            None,
        )
    }

    /// `MISSION_REQUEST` is deprecated since 2020 but still what some firmware sends; answering
    /// it with `MISSION_ITEM_INT` is the documented behaviour.
    #[allow(deprecated)]
    pub fn on_message(self, msg: &MavMessage, now_ms: u64) -> (Self, Vec<MavMessage>, Option<Done>) {
        match msg {
            MavMessage::MISSION_REQUEST_INT(r) if for_us(r.target_system, r.mission_type) => {
                self.requested(r.seq, now_ms)
            }
            MavMessage::MISSION_REQUEST(r) if for_us(r.target_system, r.mission_type) => {
                self.requested(r.seq, now_ms)
            }
            MavMessage::MISSION_ACK(a) if for_us(a.target_system, a.mission_type) => {
                let done = if a.mavtype == MavMissionResult::MAV_MISSION_ACCEPTED {
                    Done::Ok
                } else {
                    Done::Rejected(a.mavtype)
                };
                (self, Vec::new(), Some(done))
            }
            _ => (self, Vec::new(), None),
        }
    }

    pub fn on_tick(self, now_ms: u64) -> (Self, Vec<MavMessage>, Option<Done>) {
        match self.step.tick(now_ms) {
            Some((step, out)) => (Self { step, ..self }, out, None),
            None => (self, Vec::new(), Some(Done::Timeout)),
        }
    }

    pub fn sysid(&self) -> SysId {
        self.sysid
    }

    pub fn component(&self) -> u8 {
        self.component
    }
}

#[derive(Debug, Clone)]
pub struct Download {
    sysid: SysId,
    component: u8,
    expected: Option<u16>,
    received: Vec<MISSION_ITEM_INT_DATA>,
    step: Step,
}

impl Download {
    pub fn start(sysid: SysId, component: u8, now_ms: u64) -> (Self, Vec<MavMessage>) {
        let req = MavMessage::MISSION_REQUEST_LIST(MISSION_REQUEST_LIST_DATA {
            target_system: sysid,
            target_component: component,
            mission_type: MISSION,
        });
        (
            Self {
                sysid,
                component,
                expected: None,
                received: Vec::new(),
                step: Step::new(req.clone(), now_ms),
            },
            vec![req],
        )
    }

    fn request(&self, seq: u16) -> MavMessage {
        MavMessage::MISSION_REQUEST_INT(MISSION_REQUEST_INT_DATA {
            seq,
            target_system: self.sysid,
            target_component: self.component,
            mission_type: MISSION,
        })
    }

    fn ack(&self) -> MavMessage {
        MavMessage::MISSION_ACK(MISSION_ACK_DATA {
            target_system: self.sysid,
            target_component: self.component,
            mavtype: MavMissionResult::MAV_MISSION_ACCEPTED,
            mission_type: MISSION,
            opaque_id: 0,
        })
    }

    fn finish(&self) -> Mission {
        let mut items = self.received.iter().filter_map(int_to_item);
        let home = items.next();
        mission_from_items(home, items.collect())
    }

    #[allow(clippy::type_complexity)]
    pub fn on_message(
        self,
        msg: &MavMessage,
        now_ms: u64,
    ) -> (Self, Vec<MavMessage>, Option<Result<Mission, Done>>) {
        match msg {
            MavMessage::MISSION_COUNT(c)
                if for_us(c.target_system, c.mission_type) && self.expected.is_none() =>
            {
                if c.count == 0 {
                    let out = vec![self.ack()];
                    return (self, out, Some(Ok(mission_from_items(None, Vec::new()))));
                }
                let req = self.request(0);
                (
                    Self {
                        expected: Some(c.count),
                        step: Step::new(req.clone(), now_ms),
                        ..self
                    },
                    vec![req],
                    None,
                )
            }
            MavMessage::MISSION_ITEM_INT(d) if for_us(d.target_system, d.mission_type) => {
                self.received_item(d, now_ms)
            }
            _ => (self, Vec::new(), None),
        }
    }

    #[allow(clippy::type_complexity)]
    fn received_item(
        self,
        d: &MISSION_ITEM_INT_DATA,
        now_ms: u64,
    ) -> (Self, Vec<MavMessage>, Option<Result<Mission, Done>>) {
        let Some(expected) = self.expected else {
            return (self, Vec::new(), None);
        };
        if d.seq as usize != self.received.len() {
            // Out-of-order or repeated item: ask again for the one we need.
            let req = self.request(self.received.len() as u16);
            return (self, vec![req], None);
        }
        let mut received = self.received.clone();
        received.push(d.clone());
        let next = Self { received, ..self };
        if next.received.len() as u16 == expected {
            let mission = next.finish();
            let out = vec![next.ack()];
            return (next, out, Some(Ok(mission)));
        }
        let req = next.request(next.received.len() as u16);
        (
            Self {
                step: Step::new(req.clone(), now_ms),
                ..next
            },
            vec![req],
            None,
        )
    }

    #[allow(clippy::type_complexity)]
    pub fn on_tick(self, now_ms: u64) -> (Self, Vec<MavMessage>, Option<Result<Mission, Done>>) {
        match self.step.tick(now_ms) {
            Some((step, out)) => (Self { step, ..self }, out, None),
            None => (self, Vec::new(), Some(Err(Done::Timeout))),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mavlink::dialects::ardupilotmega::*;
    use rgcs_core::{demo20, Mission, MissionFrame, MissionItem};

    const SYS: u8 = 1;
    const COMP: u8 = 1;
    const GCS: u8 = 255;

    fn mission3() -> Mission {
        let mut m = demo20();
        m.items.truncate(3);
        m
    }

    fn request_int(seq: u16) -> MavMessage {
        MavMessage::MISSION_REQUEST_INT(MISSION_REQUEST_INT_DATA {
            seq,
            target_system: GCS,
            target_component: 190,
            mission_type: MavMissionType::MAV_MISSION_TYPE_MISSION,
        })
    }

    #[allow(deprecated)]
    fn request_legacy(seq: u16) -> MavMessage {
        MavMessage::MISSION_REQUEST(MISSION_REQUEST_DATA {
            seq,
            target_system: GCS,
            target_component: 190,
            mission_type: MavMissionType::MAV_MISSION_TYPE_MISSION,
        })
    }

    fn ack(result: MavMissionResult) -> MavMessage {
        MavMessage::MISSION_ACK(MISSION_ACK_DATA {
            target_system: GCS,
            target_component: 190,
            mavtype: result,
            mission_type: MavMissionType::MAV_MISSION_TYPE_MISSION,
            opaque_id: 0,
        })
    }

    fn count(n: u16) -> MavMessage {
        MavMessage::MISSION_COUNT(MISSION_COUNT_DATA {
            count: n,
            target_system: GCS,
            target_component: 190,
            mission_type: MavMissionType::MAV_MISSION_TYPE_MISSION,
            opaque_id: 0,
        })
    }

    fn item_seq(msg: &MavMessage) -> u16 {
        match msg {
            MavMessage::MISSION_ITEM_INT(d) => d.seq,
            other => panic!("not an item: {other:?}"),
        }
    }

    #[test]
    fn upload_emits_count_then_items_then_finishes_on_ack() {
        let m = mission3();
        let (up, out) = Upload::start(SYS, COMP, &m, 0).unwrap();
        assert_eq!(out.len(), 1);
        match &out[0] {
            MavMessage::MISSION_COUNT(c) => {
                assert_eq!(c.count, 4);
                assert_eq!(c.target_system, SYS);
                assert_eq!(c.target_component, COMP);
            }
            other => panic!("{other:?}"),
        }
        let mut up = up;
        for seq in 0..4u16 {
            let (next, out, done) = up.on_message(&request_int(seq), 10);
            assert_eq!(out.len(), 1, "seq {seq}");
            assert_eq!(item_seq(&out[0]), seq);
            if seq == 0 {
                if let MavMessage::MISSION_ITEM_INT(d) = &out[0] {
                    assert_eq!(d.x, 361_620_000);
                    assert_eq!(d.y, 1_393_720_000);
                    assert_eq!(d.current, 1);
                }
            }
            assert!(done.is_none());
            up = next;
        }
        let (_, out, done) = up.on_message(&ack(MavMissionResult::MAV_MISSION_ACCEPTED), 20);
        assert!(out.is_empty());
        assert_eq!(done, Some(Done::Ok));
    }

    #[test]
    fn legacy_mission_request_is_answered_with_item_int() {
        let (up, _) = Upload::start(SYS, COMP, &mission3(), 0).unwrap();
        let (_, out, _) = up.on_message(&request_legacy(2), 5);
        assert_eq!(item_seq(&out[0]), 2);
    }

    #[test]
    fn duplicate_request_is_answered_again() {
        let (up, _) = Upload::start(SYS, COMP, &mission3(), 0).unwrap();
        let (up, _, _) = up.on_message(&request_int(2), 5);
        let (_, out, done) = up.on_message(&request_int(2), 6);
        assert_eq!(item_seq(&out[0]), 2);
        assert!(done.is_none());
    }

    #[test]
    fn upload_retries_count_then_times_out() {
        let (up, _) = Upload::start(SYS, COMP, &mission3(), 0).unwrap();
        let (up, out, done) = up.on_tick(1_000);
        assert!(out.is_empty() && done.is_none(), "not yet due");
        let (up, out, done) = up.on_tick(1_600);
        assert!(matches!(out[0], MavMessage::MISSION_COUNT(_)) && done.is_none());
        let (up, out, done) = up.on_tick(3_200);
        assert!(matches!(out[0], MavMessage::MISSION_COUNT(_)) && done.is_none());
        let (_, out, done) = up.on_tick(4_800);
        assert!(out.is_empty());
        assert_eq!(done, Some(Done::Timeout));
    }

    #[test]
    fn rejected_ack_is_reported() {
        let (up, _) = Upload::start(SYS, COMP, &mission3(), 0).unwrap();
        let (_, _, done) = up.on_message(&ack(MavMissionResult::MAV_MISSION_ERROR), 5);
        assert_eq!(done, Some(Done::Rejected(MavMissionResult::MAV_MISSION_ERROR)));
    }

    #[test]
    fn download_requests_every_item_and_acks() {
        let m = mission3();
        let (dl, out) = Download::start(SYS, COMP, 0);
        assert!(matches!(out[0], MavMessage::MISSION_REQUEST_LIST(_)));
        let (dl, out, res) = dl.on_message(&count(3), 5);
        assert!(res.is_none());
        assert!(matches!(&out[0], MavMessage::MISSION_REQUEST_INT(r) if r.seq == 0));
        let home = MissionItem {
            command: 16,
            frame: MissionFrame::Abs,
            params: [0.0; 4],
            lat: 36.162,
            lon: 139.372,
            alt: 0.0,
            autocontinue: true,
        };
        let mut dl = dl;
        let frames = [home.clone(), m.items[0].clone(), m.items[1].clone()];
        for (seq, it) in frames.iter().enumerate() {
            let msg = MavMessage::MISSION_ITEM_INT(item_to_int(seq as u16, GCS, 190, it, seq == 0).unwrap());
            let (next, out, res) = dl.on_message(&msg, 10);
            if seq < 2 {
                assert!(matches!(&out[0], MavMessage::MISSION_REQUEST_INT(r) if r.seq == seq as u16 + 1));
                assert!(res.is_none());
            } else {
                assert!(
                    matches!(&out[0], MavMessage::MISSION_ACK(a) if a.mavtype == MavMissionResult::MAV_MISSION_ACCEPTED)
                );
                let got = res.expect("done").expect("ok");
                assert_eq!(got.items.len(), 2);
                assert_eq!(got.items[0].command, 22);
                assert!((got.home.unwrap().lat - 36.162).abs() < 1e-6);
            }
            dl = next;
        }
    }

    #[test]
    fn download_ignores_other_mission_types_and_targets() {
        let (dl, _) = Download::start(SYS, COMP, 0);
        let fence = MavMessage::MISSION_COUNT(MISSION_COUNT_DATA {
            count: 9,
            target_system: GCS,
            target_component: 190,
            mission_type: MavMissionType::MAV_MISSION_TYPE_FENCE,
            opaque_id: 0,
        });
        let (dl, out, res) = dl.on_message(&fence, 5);
        assert!(out.is_empty() && res.is_none());
        let other = MavMessage::MISSION_COUNT(MISSION_COUNT_DATA {
            count: 9,
            target_system: 7,
            target_component: 190,
            mission_type: MavMissionType::MAV_MISSION_TYPE_MISSION,
            opaque_id: 0,
        });
        let (_, out, res) = dl.on_message(&other, 5);
        assert!(out.is_empty() && res.is_none());
    }

    #[test]
    fn download_times_out_without_count() {
        let (dl, _) = Download::start(SYS, COMP, 0);
        let (dl, _, _) = dl.on_tick(1_600);
        let (dl, _, _) = dl.on_tick(3_200);
        let (_, _, res) = dl.on_tick(4_800);
        assert_eq!(res, Some(Err(Done::Timeout)));
    }

    #[test]
    fn lat_lon_round_trip_through_int_is_within_1e7() {
        let it = demo20().items[3].clone();
        let back = int_to_item(&item_to_int(4, SYS, COMP, &it, false).unwrap()).unwrap();
        assert!((back.lat - it.lat).abs() <= 1e-7);
        assert!((back.lon - it.lon).abs() <= 1e-7);
        assert_eq!(back.command, it.command);
        assert_eq!(back.frame, it.frame);
        assert_eq!(back.alt, it.alt);
    }

    #[test]
    fn unknown_command_cannot_start_an_upload() {
        let mut m = mission3();
        m.items[1].command = 65_000;
        assert_eq!(
            Upload::start(SYS, COMP, &m, 0).err(),
            Some(ProtocolError::UnknownCommand(2))
        );
    }
}
