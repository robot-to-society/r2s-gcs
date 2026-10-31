//! Docomo LTE area overlay (design 2026-10-31-docomo-lte-overlay): the rectangles whose
//! service-area tiles the server fetched. Times are unix milliseconds.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Where an area's fetch stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum LteStatus {
    /// Never fetched, or a fetch was interrupted before any tile arrived.
    Idle,
    Fetching,
    /// Every tile arrived.
    Ready,
    /// Some tiles failed.
    Partial,
    /// Every tile failed.
    Failed,
}

impl LteStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Fetching => "fetching",
            Self::Ready => "ready",
            Self::Partial => "partial",
            Self::Failed => "failed",
        }
    }

    /// Unknown text reads as `Idle`.
    pub fn parse(s: &str) -> Self {
        match s {
            "fetching" => Self::Fetching,
            "ready" => Self::Ready,
            "partial" => Self::Partial,
            "failed" => Self::Failed,
            _ => Self::Idle,
        }
    }
}

/// One named rectangle and its fetch counters (polled by the UI while fetching).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct LteArea {
    #[ts(type = "number")]
    pub id: i64,
    pub name: String,
    pub south: f64,
    pub west: f64,
    pub north: f64,
    pub east: f64,
    pub status: LteStatus,
    #[ts(type = "number")]
    pub tiles_total: u64,
    #[ts(type = "number")]
    pub tiles_ok: u64,
    #[ts(type = "number")]
    pub tiles_failed: u64,
    /// When the last fetch completed.
    #[ts(type = "number | null")]
    pub fetched_at: Option<u64>,
    /// The newest `Last-Modified` the tiles carried (docomo's data date).
    #[ts(type = "number | null")]
    pub data_modified: Option<u64>,
    /// Short error code of the last failed tile (`http_404`, `timeout`, …).
    pub last_error: Option<String>,
    #[ts(type = "number")]
    pub created_at: u64,
}

/// `POST /api/lte/areas/estimate` answer: the tiles a rectangle needs (zoom 8–14).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct LteEstimate {
    #[ts(type = "number")]
    pub tiles: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_is_lowercase_and_area_round_trips() {
        assert_eq!(serde_json::to_string(&LteStatus::Partial).unwrap(), "\"partial\"");
        let area = LteArea {
            id: 3,
            name: "那智勝浦".into(),
            south: 33.6,
            west: 135.85,
            north: 33.7,
            east: 135.95,
            status: LteStatus::Fetching,
            tiles_total: 120,
            tiles_ok: 10,
            tiles_failed: 1,
            fetched_at: None,
            data_modified: Some(1_790_000_000_000),
            last_error: Some("http_404".into()),
            created_at: 1_790_000_000_001,
        };
        let v = serde_json::to_value(&area).unwrap();
        assert_eq!(v["status"], "fetching");
        assert!(v["fetched_at"].is_null());
        let back: LteArea = serde_json::from_value(v).unwrap();
        assert_eq!(back, area);
        let est = serde_json::to_value(LteEstimate { tiles: 42 }).unwrap();
        assert_eq!(est, serde_json::json!({ "tiles": 42 }));
    }
}
