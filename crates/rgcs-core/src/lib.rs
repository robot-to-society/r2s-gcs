//! Domain types shared by every RGCS crate and exported to TypeScript with `ts-rs`.
//!
//! Nothing here depends on MAVLink, tokio or the web framework: these are the
//! values that cross the WebSocket / HTTP boundary (`docs/spec/50-api.md`).

pub mod briefing;
pub mod calibration;
pub mod camera;
pub mod camera_media;
pub mod command;
pub mod gcs;
pub mod geofence;
pub mod inspector;
pub mod jst;
pub mod log;
pub mod logbook;
pub mod mission;
pub mod operator;
pub mod params;
pub mod roi;
pub mod survey_camera;
pub mod vehicle;
pub mod ws;

pub use briefing::{validate_briefing, Briefing, BriefingFull, BriefingRow, BriefingSummary};
pub use calibration::{
    CalibFrame, CalibKind, CalibPhase, CalibRecord, CalibStatus, CompassProgress, RcRange,
};
pub use camera::{
    AxisFunction, AxisMapping, ButtonFunction, ButtonMapping, CameraCaps, CameraCommand, CameraKind,
    CameraProfile, CameraSnapshot, CameraState, CenterMode, Deadman, Firmware, GimbalAttitude, GimbalCaps,
    GimbalInputProfile, GimbalMode, ProfileError, RecordingState, VideoMode, VideoSource, VideoSourceMode,
    VideoSourceStatus, ZoomCaps,
};
pub use camera_media::{
    mt11_encoding_presets, AiAck, AiTrackingCaps, CameraClock, Detection, EncodingInfo, EncodingPreset,
    NormRect, StorageInfo, StorageStatus, ThermalCaps, ThermalFrame, ThermalGain, ThermalPoint,
    ThermalState, TrackState, TrackStatus, VideoCodec, AI_BOX_PX_DEFAULT, AI_BOX_PX_RANGE,
    AI_CENTER_BOX_PX, MT11_PALETTES,
};
pub use command::{CommandResult, VehicleCommand};
pub use gcs::GcsId;
pub use geofence::{FenceZone, LatLon, RallyPoint};
pub use inspector::{InspectorDetail, InspectorDir, InspectorRow};
pub use log::{ackable, severity_of_statustext, LogEntry, MessageSource, Severity};
pub use logbook::{
    FcLogEntry, Flight, FlightInput, FlightLog, FlightPatch, FlightSquawk, FlightSquawkInput, FlightStatus,
    InspectionItem, InspectionResult, InspectionResultInput, InspectionResultRow, InspectionRun,
    InspectionRunInput, InspectionTemplate, InspectionTemplateInput, LogFetchProgress, LogSource,
    MaintenanceInput, MaintenanceRecord, PilotInfo, PilotInput, VehicleRegistry, VehicleRegistryInput,
};
pub use mission::{
    demo20, haversine_m, FenceInfo, Finding, FindingLevel, Home, Mission, MissionFrame, MissionItem,
    MissionProgress, MissionStats, MissionSummaryRow, MissionTransfer, SurveyBlock, TransferPhase,
    UploadReport,
    MAV_CMD_DO_JUMP, MAV_CMD_NAV_LAND, MAV_CMD_NAV_RETURN_TO_LAUNCH, MAV_CMD_NAV_TAKEOFF,
    MAV_CMD_NAV_WAYPOINT,
};
pub use operator::Operator;
pub use params::{ParamChange, ParamEntry, ParamHistoryEntry, ParamProgress, ParamWriteResult};
pub use roi::{
    default_roi_targets, roi_slot_id, validate_roi_targets, RoiControl, RoiControlMode, RoiMode, RoiStatus,
    RoiTarget, ROI_SLOT_COUNT,
};
pub use survey_camera::{validate_survey_camera, SurveyCamera};
pub use vehicle::{
    diff, Attitude, Battery, GeoPoint, Gps, LinkStatus, NavInfo, SysId, VehicleKind, VehicleState,
    VehicleStateDiff, VehicleSummary,
};
pub use ws::{ClientMessage, ServerMessage, VehicleMessage, VideoSourceEntry};
