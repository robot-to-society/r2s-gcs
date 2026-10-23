//! Network view types (`docs/spec/80-network.md`, `GET /api/network`). The topology itself
//! follows in the network view plan's Task 2.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// What a MAVLink component is (80 §2): from its HEARTBEAT `MAV_TYPE`, else from its COMPID.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, rename_all = "snake_case")]
pub enum ComponentKind {
    Autopilot,
    Camera,
    Gimbal,
    Companion,
    Gcs,
    Other,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn component_kind_is_snake_case() {
        assert_eq!(
            serde_json::to_string(&ComponentKind::Autopilot).unwrap(),
            "\"autopilot\""
        );
        assert_eq!(serde_json::to_string(&ComponentKind::Gcs).unwrap(), "\"gcs\"");
    }
}
