//! A briefing: several saved missions opened together, each with a colour and an optional
//! vehicle assignment (docs/superpowers multi-mission briefing).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{Mission, SysId};

pub const MAX_BRIEFING_ROWS: usize = 20;
pub const MAX_BRIEFING_NAME: usize = 80;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BriefingRow {
    #[ts(type = "number")]
    pub mission_id: i64,
    pub color: String,
    pub sysid: Option<SysId>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Briefing {
    #[ts(type = "number | null")]
    pub id: Option<i64>,
    pub name: String,
    #[ts(type = "number | null")]
    pub active_mission_id: Option<i64>,
    pub rows: Vec<BriefingRow>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BriefingSummary {
    #[ts(type = "number")]
    pub id: i64,
    pub name: String,
    pub mission_count: u32,
    #[ts(type = "number")]
    pub updated_at: u64,
}

/// A briefing with its missions; `missions[i]` belongs to `rows[i]` (`None` once deleted).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BriefingFull {
    pub briefing: Briefing,
    pub missions: Vec<Option<Mission>>,
}

fn is_hex_colour(s: &str) -> bool {
    s.len() == 7 && s.starts_with('#') && s[1..].chars().all(|c| c.is_ascii_hexdigit())
}

pub fn validate_briefing(b: &Briefing) -> Result<(), String> {
    let name_len = b.name.chars().count();
    if name_len == 0 || name_len > MAX_BRIEFING_NAME {
        return Err(format!("briefing name must be 1-{MAX_BRIEFING_NAME} characters"));
    }
    if b.rows.len() > MAX_BRIEFING_ROWS {
        return Err(format!("a briefing holds at most {MAX_BRIEFING_ROWS} missions"));
    }
    for (i, r) in b.rows.iter().enumerate() {
        if !is_hex_colour(&r.color) {
            return Err(format!("row {i}: colour must be #rrggbb"));
        }
        for (j, o) in b.rows.iter().enumerate().take(i) {
            if o.mission_id == r.mission_id {
                return Err(format!(
                    "mission {} appears twice (rows {j} and {i})",
                    r.mission_id
                ));
            }
            if r.sysid.is_some() && o.sysid == r.sysid {
                return Err(format!(
                    "vehicle {} is assigned twice (rows {j} and {i})",
                    r.sysid.unwrap_or(0)
                ));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(mission_id: i64, sysid: Option<SysId>) -> BriefingRow {
        BriefingRow {
            mission_id,
            color: "#ff0000".into(),
            sysid,
        }
    }

    fn briefing(rows: Vec<BriefingRow>) -> Briefing {
        Briefing {
            id: None,
            name: "b".into(),
            active_mission_id: None,
            rows,
        }
    }

    #[test]
    fn validate_rejects_duplicates_bad_colours_and_long_lists() {
        assert!(validate_briefing(&briefing(vec![row(1, Some(1)), row(2, None)])).is_ok());
        assert!(validate_briefing(&briefing(vec![row(1, None), row(2, None)])).is_ok());
        assert!(validate_briefing(&briefing(vec![row(1, None), row(1, None)])).is_err());
        assert!(validate_briefing(&briefing(vec![row(1, Some(2)), row(2, Some(2))])).is_err());
        let mut red = row(1, None);
        red.color = "red".into();
        assert!(validate_briefing(&briefing(vec![red])).is_err());
        let many = (0..21).map(|i| row(i, None)).collect();
        assert!(validate_briefing(&briefing(many)).is_err());
        let mut unnamed = briefing(vec![]);
        unnamed.name = String::new();
        assert!(validate_briefing(&unnamed).is_err());
    }
}
