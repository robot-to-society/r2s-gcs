//! ArduPilot custom-mode numbers → mode names, and MAV_TYPE → vehicle kind.

use mavlink::dialects::ardupilotmega::MavType;
use rgcs_core::VehicleKind;

const COPTER: &[(u32, &str)] = &[
    (0, "STABILIZE"),
    (1, "ACRO"),
    (2, "ALT_HOLD"),
    (3, "AUTO"),
    (4, "GUIDED"),
    (5, "LOITER"),
    (6, "RTL"),
    (7, "CIRCLE"),
    (9, "LAND"),
    (11, "DRIFT"),
    (13, "SPORT"),
    (14, "FLIP"),
    (15, "AUTOTUNE"),
    (16, "POSHOLD"),
    (17, "BRAKE"),
    (18, "THROW"),
    (19, "AVOID_ADSB"),
    (20, "GUIDED_NOGPS"),
    (21, "SMART_RTL"),
    (22, "FLOWHOLD"),
    (23, "FOLLOW"),
    (24, "ZIGZAG"),
    (25, "SYSTEMID"),
    (26, "AUTOROTATE"),
    (27, "AUTO_RTL"),
    (28, "TURTLE"),
];

const ROVER: &[(u32, &str)] = &[
    (0, "MANUAL"),
    (1, "ACRO"),
    (3, "STEERING"),
    (4, "HOLD"),
    (5, "LOITER"),
    (6, "FOLLOW"),
    (7, "SIMPLE"),
    (8, "DOCK"),
    (9, "CIRCLE"),
    (10, "AUTO"),
    (11, "RTL"),
    (12, "SMART_RTL"),
    (15, "GUIDED"),
    (16, "INITIALISING"),
];

const PLANE: &[(u32, &str)] = &[
    (0, "MANUAL"),
    (1, "CIRCLE"),
    (2, "STABILIZE"),
    (3, "TRAINING"),
    (4, "ACRO"),
    (5, "FBWA"),
    (6, "FBWB"),
    (7, "CRUISE"),
    (8, "AUTOTUNE"),
    (10, "AUTO"),
    (11, "RTL"),
    (12, "LOITER"),
    (13, "TAKEOFF"),
    (14, "AVOID_ADSB"),
    (15, "GUIDED"),
    (16, "INITIALISING"),
    (17, "QSTABILIZE"),
    (18, "QHOVER"),
    (19, "QLOITER"),
    (20, "QLAND"),
    (21, "QRTL"),
    (22, "QAUTOTUNE"),
    (23, "QACRO"),
    (24, "THERMAL"),
    (25, "LOITER_ALT_QLAND"),
];

/// Mode name for the UI; unknown numbers are shown as `MODE(n)` rather than hidden.
pub fn mode_name(kind: VehicleKind, custom_mode: u32) -> String {
    let table = match kind {
        VehicleKind::Copter => COPTER,
        VehicleKind::Rover => ROVER,
        VehicleKind::Plane => PLANE,
        VehicleKind::Other => &[],
    };
    table
        .iter()
        .find(|(n, _)| *n == custom_mode)
        .map(|(_, name)| (*name).to_string())
        .unwrap_or_else(|| format!("MODE({custom_mode})"))
}

/// Reverse lookup for DO_SET_MODE; names are matched case-insensitively.
pub fn mode_number(kind: VehicleKind, name: &str) -> Option<u32> {
    let table = match kind {
        VehicleKind::Copter => COPTER,
        VehicleKind::Rover => ROVER,
        VehicleKind::Plane => PLANE,
        VehicleKind::Other => &[],
    };
    table
        .iter()
        .find(|(_, n)| n.eq_ignore_ascii_case(name))
        .map(|(num, _)| *num)
}

pub fn vehicle_kind(mavtype: MavType) -> VehicleKind {
    const COPTERS: &[MavType] = &[
        MavType::MAV_TYPE_QUADROTOR,
        MavType::MAV_TYPE_HEXAROTOR,
        MavType::MAV_TYPE_OCTOROTOR,
        MavType::MAV_TYPE_TRICOPTER,
        MavType::MAV_TYPE_COAXIAL,
        MavType::MAV_TYPE_HELICOPTER,
        MavType::MAV_TYPE_DODECAROTOR,
        MavType::MAV_TYPE_DECAROTOR,
        MavType::MAV_TYPE_GENERIC_MULTIROTOR,
    ];
    const ROVERS: &[MavType] = &[MavType::MAV_TYPE_GROUND_ROVER, MavType::MAV_TYPE_SURFACE_BOAT];
    const PLANES: &[MavType] = &[
        MavType::MAV_TYPE_FIXED_WING,
        MavType::MAV_TYPE_VTOL_TAILSITTER_DUOROTOR,
        MavType::MAV_TYPE_VTOL_TAILSITTER_QUADROTOR,
        MavType::MAV_TYPE_VTOL_TILTROTOR,
        MavType::MAV_TYPE_VTOL_FIXEDROTOR,
        MavType::MAV_TYPE_VTOL_TAILSITTER,
        MavType::MAV_TYPE_VTOL_TILTWING,
    ];
    if COPTERS.contains(&mavtype) {
        VehicleKind::Copter
    } else if ROVERS.contains(&mavtype) {
        VehicleKind::Rover
    } else if PLANES.contains(&mavtype) {
        VehicleKind::Plane
    } else {
        VehicleKind::Other
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copter_and_rover_modes() {
        assert_eq!(mode_name(VehicleKind::Copter, 3), "AUTO");
        assert_eq!(mode_name(VehicleKind::Copter, 6), "RTL");
        assert_eq!(mode_name(VehicleKind::Rover, 10), "AUTO");
        assert_eq!(mode_name(VehicleKind::Rover, 4), "HOLD");
        assert_eq!(mode_name(VehicleKind::Plane, 11), "RTL");
    }

    #[test]
    fn mode_number_round_trips() {
        assert_eq!(mode_number(VehicleKind::Copter, "rtl"), Some(6));
        assert_eq!(mode_number(VehicleKind::Rover, "HOLD"), Some(4));
        assert_eq!(mode_number(VehicleKind::Copter, "WARP"), None);
        assert_eq!(mode_number(VehicleKind::Other, "AUTO"), None);
    }

    #[test]
    fn unknown_mode_is_visible() {
        assert_eq!(mode_name(VehicleKind::Copter, 99), "MODE(99)");
        assert_eq!(mode_name(VehicleKind::Other, 1), "MODE(1)");
    }

    #[test]
    fn mav_type_maps_to_kind() {
        assert_eq!(vehicle_kind(MavType::MAV_TYPE_QUADROTOR), VehicleKind::Copter);
        assert_eq!(vehicle_kind(MavType::MAV_TYPE_GROUND_ROVER), VehicleKind::Rover);
        assert_eq!(vehicle_kind(MavType::MAV_TYPE_FIXED_WING), VehicleKind::Plane);
        assert_eq!(vehicle_kind(MavType::MAV_TYPE_GCS), VehicleKind::Other);
    }
}
