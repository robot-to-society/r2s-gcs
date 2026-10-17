//! Mission planning types (spec 10 §6, addendum §5.2): the saved mission, its items, the
//! validation findings and the progress frame. Pure data + rules; no MAVLink here.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::vehicle::SysId;

pub const MAV_CMD_NAV_WAYPOINT: u16 = 16;
pub const MAV_CMD_NAV_LOITER_UNLIM: u16 = 17;
pub const MAV_CMD_NAV_LOITER_TURNS: u16 = 18;
pub const MAV_CMD_NAV_LOITER_TIME: u16 = 19;
pub const MAV_CMD_NAV_RETURN_TO_LAUNCH: u16 = 20;
pub const MAV_CMD_NAV_LAND: u16 = 21;
pub const MAV_CMD_NAV_TAKEOFF: u16 = 22;
pub const MAV_CMD_NAV_SPLINE_WAYPOINT: u16 = 82;
pub const MAV_CMD_NAV_DELAY: u16 = 93;
pub const MAV_CMD_CONDITION_DELAY: u16 = 112;
pub const MAV_CMD_DO_JUMP: u16 = 177;
pub const MAV_CMD_DO_SET_ROI: u16 = 201;

/// Flights longer than this (estimated) get a `long_flight` warning: a stand-in for a battery
/// model the project does not have yet.
pub const LONG_FLIGHT_S: f64 = 1_200.0;
const EARTH_RADIUS_M: f64 = 6_371_000.0;

/// Altitude reference (memory: Rel / Abs / Ter combo precedes every altitude input).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, rename_all = "lowercase")]
pub enum MissionFrame {
    Rel,
    Abs,
    Ter,
}

impl MissionFrame {
    /// `MAV_FRAME_GLOBAL_RELATIVE_ALT` / `MAV_FRAME_GLOBAL` / `MAV_FRAME_GLOBAL_TERRAIN_ALT`.
    pub fn mav(self) -> u8 {
        match self {
            Self::Rel => 3,
            Self::Abs => 0,
            Self::Ter => 10,
        }
    }

    pub fn from_mav(id: u8) -> Option<Self> {
        match id {
            3 => Some(Self::Rel),
            0 => Some(Self::Abs),
            10 => Some(Self::Ter),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct MissionItem {
    /// MAV_CMD id (16 = NAV_WAYPOINT, 22 = NAV_TAKEOFF, …).
    pub command: u16,
    pub frame: MissionFrame,
    pub params: [f32; 4],
    pub lat: f64,
    pub lon: f64,
    pub alt: f32,
    pub autocontinue: bool,
}

impl MissionItem {
    /// NAV commands that carry a position the vehicle flies to.
    pub fn is_positional(&self) -> bool {
        matches!(
            self.command,
            16..=22 | MAV_CMD_NAV_SPLINE_WAYPOINT | MAV_CMD_DO_SET_ROI
        )
    }

    fn has_position(&self) -> bool {
        self.is_positional() && !(self.lat == 0.0 && self.lon == 0.0)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Home {
    pub lat: f64,
    pub lon: f64,
    pub alt: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Mission {
    #[ts(type = "number | null")]
    pub id: Option<i64>,
    pub name: String,
    pub sysid: Option<SysId>,
    pub default_alt: f32,
    pub default_frame: MissionFrame,
    /// Planned ground speed (m/s) for the time estimate.
    pub speed: f32,
    pub home: Option<Home>,
    pub items: Vec<MissionItem>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct MissionSummaryRow {
    #[ts(type = "number")]
    pub id: i64,
    pub name: String,
    pub sysid: Option<SysId>,
    pub item_count: u32,
    #[ts(type = "number")]
    pub updated_at: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, rename_all = "lowercase")]
pub enum FindingLevel {
    Fatal,
    Warn,
}

/// One validation result; `code` is the contract the UI translates.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Finding {
    pub level: FindingLevel,
    pub code: String,
    /// 1-based mission sequence of the offending item, when there is one.
    pub seq: Option<u16>,
    pub message: String,
}

impl Finding {
    fn fatal(code: &str, seq: Option<u16>, message: impl Into<String>) -> Self {
        Self {
            level: FindingLevel::Fatal,
            code: code.into(),
            seq,
            message: message.into(),
        }
    }

    fn warn(code: &str, seq: Option<u16>, message: impl Into<String>) -> Self {
        Self {
            level: FindingLevel::Warn,
            code: code.into(),
            seq,
            message: message.into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct MissionStats {
    pub distance_m: f64,
    pub duration_s: f64,
    pub max_alt: f32,
}

/// `MISSION_CURRENT` as the UI sees it; `total` once the server knows the vehicle's mission.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct MissionProgress {
    pub seq: u16,
    pub total: Option<u16>,
}

/// Result of `PUT /api/vehicles/{sysid}/mission`: what was written and whether the read-back matched.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UploadReport {
    pub items: u32,
    pub verified: bool,
    /// 1-based sequences whose read-back differed.
    pub mismatched: Vec<u16>,
    pub findings: Vec<Finding>,
}

/// Geofence parameters as far as they are known (`FENCE_ENABLE`, `FENCE_ALT_MAX`, `FENCE_RADIUS`).
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct FenceInfo {
    pub enabled: Option<bool>,
    pub alt_max: Option<f32>,
    pub radius: Option<f32>,
}

pub fn haversine_m(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let (p1, p2) = (lat1.to_radians(), lat2.to_radians());
    let dp = p2 - p1;
    let dl = (lon2 - lon1).to_radians();
    let a = (dp / 2.0).sin().powi(2) + p1.cos() * p2.cos() * (dl / 2.0).sin().powi(2);
    2.0 * EARTH_RADIUS_M * a.sqrt().asin()
}

impl Mission {
    pub fn has_fatal(findings: &[Finding]) -> bool {
        findings.iter().any(|f| f.level == FindingLevel::Fatal)
    }

    /// Spec 10 §6 pre-upload checks; fatal findings refuse the upload.
    pub fn validate(&self, fence: &FenceInfo) -> Vec<Finding> {
        let mut out = Vec::new();
        if self.items.is_empty() {
            out.push(Finding::fatal("empty", None, "mission has no items"));
            return out;
        }
        if self.items[0].command != MAV_CMD_NAV_TAKEOFF {
            out.push(Finding::fatal(
                "first_not_takeoff",
                Some(1),
                "the first item must be NAV_TAKEOFF",
            ));
        }
        out.extend(self.fence_findings(fence));
        out.extend(self.structure_findings());
        if self.stats().duration_s > LONG_FLIGHT_S {
            out.push(Finding::warn(
                "long_flight",
                None,
                "estimated flight time exceeds 20 minutes",
            ));
        }
        out
    }

    fn fence_findings(&self, fence: &FenceInfo) -> Vec<Finding> {
        let mut out = Vec::new();
        match fence.enabled {
            None => {
                out.push(Finding::warn(
                    "fence_unknown",
                    None,
                    "fence parameters not read yet",
                ));
                return out;
            }
            Some(false) => return out,
            Some(true) => {}
        }
        match fence.alt_max {
            None => out.push(Finding::warn("fence_unknown", None, "FENCE_ALT_MAX not read yet")),
            Some(max) => out.extend(self.alt_findings(max)),
        }
        if let Some(radius) = fence.radius {
            out.extend(self.radius_findings(radius));
        }
        out
    }

    fn alt_findings(&self, max: f32) -> Vec<Finding> {
        let mut out = Vec::new();
        for (i, it) in self.items.iter().enumerate().filter(|(_, it)| it.is_positional()) {
            let seq = Some((i + 1) as u16);
            match it.frame {
                MissionFrame::Rel if it.alt > max => out.push(Finding::fatal(
                    "fence_alt",
                    seq,
                    format!("altitude {} m exceeds FENCE_ALT_MAX {} m", it.alt, max),
                )),
                MissionFrame::Rel => {}
                _ => out.push(Finding::warn(
                    "fence_frame_unchecked",
                    seq,
                    "non-relative altitude is not compared with the fence",
                )),
            }
        }
        out
    }

    fn radius_findings(&self, radius: f32) -> Vec<Finding> {
        let centre = match &self.home {
            Some(h) => Some((h.lat, h.lon)),
            None => self
                .items
                .iter()
                .find(|it| it.has_position())
                .map(|it| (it.lat, it.lon)),
        };
        let Some((clat, clon)) = centre else {
            return Vec::new();
        };
        self.items
            .iter()
            .enumerate()
            .filter(|(_, it)| it.has_position())
            .filter(|(_, it)| haversine_m(clat, clon, it.lat, it.lon) > radius as f64)
            .map(|(i, _)| {
                Finding::fatal(
                    "fence_radius",
                    Some((i + 1) as u16),
                    format!("outside FENCE_RADIUS {radius} m"),
                )
            })
            .collect()
    }

    fn structure_findings(&self) -> Vec<Finding> {
        let mut out = Vec::new();
        let n = self.items.len();
        let mut frames: Vec<MissionFrame> = Vec::new();
        for (i, it) in self.items.iter().enumerate() {
            let seq = Some((i + 1) as u16);
            if it.command == MAV_CMD_DO_JUMP {
                let target = it.params[0];
                if target < 1.0 || target > n as f32 {
                    out.push(Finding::fatal(
                        "jump_target",
                        seq,
                        format!("DO_JUMP target {target} is not an item"),
                    ));
                }
            }
            if it.is_positional() {
                if !frames.contains(&it.frame) {
                    frames.push(it.frame);
                }
                if it.frame == MissionFrame::Ter {
                    out.push(Finding::warn(
                        "terrain_frame",
                        seq,
                        "terrain altitude needs terrain data on the vehicle",
                    ));
                }
                if it.lat == 0.0
                    && it.lon == 0.0
                    && !matches!(it.command, MAV_CMD_NAV_RETURN_TO_LAUNCH | MAV_CMD_NAV_LAND)
                {
                    out.push(Finding::warn("zero_position", seq, "item has no position"));
                }
            }
        }
        if frames.len() > 1 {
            out.push(Finding::warn(
                "mixed_frames",
                None,
                "items use more than one altitude frame",
            ));
        }
        if let Some(last) = self.items.last() {
            if !matches!(last.command, MAV_CMD_NAV_LAND | MAV_CMD_NAV_RETURN_TO_LAUNCH) {
                out.push(Finding::warn(
                    "no_land_or_rtl",
                    Some(n as u16),
                    "mission does not end with LAND or RTL",
                ));
            }
        }
        out
    }

    /// Total path length, time estimate (distance / speed + explicit waits) and the highest altitude.
    pub fn stats(&self) -> MissionStats {
        let mut distance = 0.0;
        let mut prev: Option<(f64, f64)> = self.home.as_ref().map(|h| (h.lat, h.lon));
        let mut max_alt: f32 = 0.0;
        let mut waits = 0.0f64;
        for it in &self.items {
            if it.has_position() {
                if let Some((plat, plon)) = prev {
                    distance += haversine_m(plat, plon, it.lat, it.lon);
                }
                prev = Some((it.lat, it.lon));
                max_alt = max_alt.max(it.alt);
            }
            waits += match it.command {
                MAV_CMD_NAV_WAYPOINT | MAV_CMD_NAV_LOITER_TIME | MAV_CMD_CONDITION_DELAY => {
                    it.params[0].max(0.0) as f64
                }
                MAV_CMD_NAV_DELAY if it.params[0] >= 0.0 => it.params[0] as f64,
                _ => 0.0,
            };
        }
        MissionStats {
            distance_m: distance,
            duration_s: distance / (self.speed.max(0.1) as f64) + waits,
            max_alt,
        }
    }
}

/// The 20-item demo mission around the SITL home (also the `.waypoints` golden fixture).
pub fn demo20() -> Mission {
    let (lat0, lon0): (f64, f64) = (36.162, 139.372);
    let dlat = 400.0 / 111_320.0 / 4.0; // 4 rows across 400 m north
    let dlon = 1000.0 / (111_320.0 * lat0.to_radians().cos()); // 1 km east
    let item = |command: u16, lat: f64, lon: f64, alt: f32| MissionItem {
        command,
        frame: MissionFrame::Rel,
        params: [0.0; 4],
        lat,
        lon,
        alt,
        autocontinue: true,
    };
    let mut items = vec![item(MAV_CMD_NAV_TAKEOFF, lat0, lon0, 30.0)];
    for i in 0..18u32 {
        let row = i / 2;
        let east = (i % 2 == 0) == (row % 2 == 0);
        let lat = lat0 + dlat * (row as f64 + 1.0);
        let lon = if east { lon0 + dlon } else { lon0 };
        let alt = if row % 2 == 0 { 60.0 } else { 80.0 };
        items.push(item(MAV_CMD_NAV_WAYPOINT, lat, lon, alt));
    }
    items.push(item(MAV_CMD_NAV_RETURN_TO_LAUNCH, 0.0, 0.0, 0.0));
    Mission {
        id: None,
        name: "demo20".into(),
        sysid: None,
        default_alt: 60.0,
        default_frame: MissionFrame::Rel,
        speed: 8.0,
        home: Some(Home {
            lat: lat0,
            lon: lon0,
            alt: 0.0,
        }),
        items,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(command: u16, lat: f64, lon: f64, alt: f32) -> MissionItem {
        MissionItem {
            command,
            frame: MissionFrame::Rel,
            params: [0.0; 4],
            lat,
            lon,
            alt,
            autocontinue: true,
        }
    }

    fn mission(items: Vec<MissionItem>) -> Mission {
        Mission {
            id: None,
            name: "t".into(),
            sysid: None,
            default_alt: 50.0,
            default_frame: MissionFrame::Rel,
            speed: 8.0,
            home: None,
            items,
        }
    }

    fn codes(f: &[Finding]) -> Vec<&str> {
        f.iter().map(|x| x.code.as_str()).collect()
    }

    #[test]
    fn frames_map_to_mav_ids() {
        assert_eq!(MissionFrame::Rel.mav(), 3);
        assert_eq!(MissionFrame::Abs.mav(), 0);
        assert_eq!(MissionFrame::Ter.mav(), 10);
        assert_eq!(MissionFrame::from_mav(10), Some(MissionFrame::Ter));
        assert_eq!(MissionFrame::from_mav(5), None);
    }

    #[test]
    fn validate_flags_empty_and_first_not_takeoff() {
        let f = mission(vec![]).validate(&FenceInfo::default());
        assert_eq!(f[0].level, FindingLevel::Fatal);
        assert_eq!(f[0].code, "empty");
        let f = mission(vec![item(MAV_CMD_NAV_WAYPOINT, 36.0, 139.0, 50.0)]).validate(&FenceInfo::default());
        assert!(codes(&f).contains(&"first_not_takeoff"));
        assert!(Mission::has_fatal(&f));
    }

    #[test]
    fn fence_alt_is_fatal_only_when_known_and_enabled() {
        let m = mission(vec![
            item(MAV_CMD_NAV_TAKEOFF, 36.162, 139.372, 30.0),
            item(MAV_CMD_NAV_WAYPOINT, 36.163, 139.373, 120.0),
        ]);
        let f = m.validate(&FenceInfo {
            enabled: Some(true),
            alt_max: Some(100.0),
            radius: None,
        });
        let fatal: Vec<_> = f.iter().filter(|x| x.level == FindingLevel::Fatal).collect();
        assert_eq!(fatal.len(), 1);
        assert_eq!(fatal[0].code, "fence_alt");
        assert_eq!(fatal[0].seq, Some(2));
        let f = m.validate(&FenceInfo::default());
        assert!(!Mission::has_fatal(&f));
        assert!(codes(&f).contains(&"fence_unknown"));
        let f = m.validate(&FenceInfo {
            enabled: Some(false),
            alt_max: None,
            radius: None,
        });
        assert!(!codes(&f).contains(&"fence_unknown"));
    }

    #[test]
    fn fence_radius_uses_home_when_present() {
        let mut m = mission(vec![
            item(MAV_CMD_NAV_TAKEOFF, 36.162, 139.372, 30.0),
            item(MAV_CMD_NAV_WAYPOINT, 36.162, 139.390, 50.0), // ≈1.6 km east
        ]);
        let fence = FenceInfo {
            enabled: Some(true),
            alt_max: Some(120.0),
            radius: Some(1000.0),
        };
        let f = m.validate(&fence);
        assert!(codes(&f).contains(&"fence_radius"));
        // Home halfway between the two points: both are ~810 m from it, inside the 1 km fence.
        m.home = Some(Home {
            lat: 36.162,
            lon: 139.381,
            alt: 0.0,
        });
        let f = m.validate(&fence);
        assert!(!codes(&f).contains(&"fence_radius"), "{f:?}");
    }

    #[test]
    fn jump_target_out_of_range_is_fatal() {
        let mut jump = item(MAV_CMD_DO_JUMP, 0.0, 0.0, 0.0);
        jump.params[0] = 5.0;
        let m = mission(vec![item(MAV_CMD_NAV_TAKEOFF, 36.162, 139.372, 30.0), jump]);
        let f = m.validate(&FenceInfo::default());
        let j = f.iter().find(|x| x.code == "jump_target").expect("finding");
        assert_eq!(j.level, FindingLevel::Fatal);
        assert_eq!(j.seq, Some(2));
    }

    #[test]
    fn stats_sum_distance_time_and_max_alt() {
        let mut wp = item(MAV_CMD_NAV_WAYPOINT, 36.162, 139.3831, 80.0);
        wp.params[0] = 10.0;
        let m = mission(vec![item(MAV_CMD_NAV_TAKEOFF, 36.162, 139.372, 30.0), wp]);
        let s = m.stats();
        assert!((990.0..1010.0).contains(&s.distance_m), "{}", s.distance_m);
        assert!((123.0..137.0).contains(&s.duration_s), "{}", s.duration_s);
        assert_eq!(s.max_alt, 80.0);
    }

    #[test]
    fn demo_mission_is_valid_with_warnings_only() {
        let f = demo20().validate(&FenceInfo::default());
        assert!(!Mission::has_fatal(&f), "{f:?}");
        assert_eq!(demo20().items.len(), 20);
    }
}
