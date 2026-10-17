//! Camera / gimbal abstraction shared by the drivers, the server and the UI (spec 40 §1).
//! P2 carries the MT11 subset (gimbal, zoom, photo, record, video type); thermal, AI, ROI
//! and encoding caps arrive with their drivers.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::vehicle::SysId;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, rename_all = "snake_case")]
pub enum CameraKind {
    None,
    Mavlink,
    SiyiMt11,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, rename_all = "snake_case")]
pub enum VideoMode {
    Rgb,
    Thermal,
    SideBySide,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, rename_all = "snake_case")]
pub enum GimbalMode {
    Lock,
    Follow,
    Fpv,
}

/// SIYI 0x08 centre variants (1..4 on the wire).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, rename_all = "snake_case")]
pub enum CenterMode {
    OneKeyReset,
    CenterFaceDown,
    Center,
    FaceDown,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GimbalCaps {
    pub rate: bool,
    pub angle: bool,
    pub center: bool,
    pub modes: Vec<GimbalMode>,
    pub attitude: bool,
    pub pitch_range: (f32, f32),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ZoomCaps {
    pub max: f32,
    pub absolute: bool,
    pub step: bool,
    pub continuous: bool,
}

/// What a camera can do; the UI hides (not disables) everything absent (spec 40 §1.1).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CameraCaps {
    pub kind: CameraKind,
    pub gimbal: Option<GimbalCaps>,
    pub zoom: Option<ZoomCaps>,
    pub focus: bool,
    pub photo: bool,
    pub record: bool,
    pub video_modes: Vec<VideoMode>,
}

impl CameraCaps {
    pub fn none() -> Self {
        Self {
            kind: CameraKind::None,
            gimbal: None,
            zoom: None,
            focus: false,
            photo: false,
            record: false,
            video_modes: Vec::new(),
        }
    }

    /// SIYI MT11 (spec 40 §2): zoom to 165×, pitch −90..30, Lock / Follow / FPV.
    pub fn siyi_mt11() -> Self {
        Self {
            kind: CameraKind::SiyiMt11,
            gimbal: Some(GimbalCaps {
                rate: true,
                angle: true,
                center: true,
                modes: vec![GimbalMode::Lock, GimbalMode::Follow, GimbalMode::Fpv],
                attitude: true,
                pitch_range: (-90.0, 30.0),
            }),
            zoom: Some(ZoomCaps {
                max: 165.0,
                absolute: true,
                step: true,
                continuous: true,
            }),
            focus: true,
            photo: true,
            record: true,
            video_modes: vec![VideoMode::Rgb, VideoMode::Thermal, VideoMode::SideBySide],
        }
    }

    /// The server refuses commands the caps do not cover (spec 70 §3).
    pub fn supports(&self, cmd: &CameraCommand) -> bool {
        use CameraCommand::*;
        let gimbal = self.gimbal.as_ref();
        let zoom = self.zoom.as_ref();
        match cmd {
            GimbalRate { .. } => gimbal.is_some_and(|g| g.rate),
            GimbalAngle { .. } => gimbal.is_some_and(|g| g.angle),
            GimbalCenter { .. } => gimbal.is_some_and(|g| g.center),
            GimbalMode { mode } => gimbal.is_some_and(|g| g.modes.contains(mode)),
            ZoomAbsolute { .. } | ZoomReset => zoom.is_some_and(|z| z.absolute),
            ZoomStep { .. } => zoom.is_some_and(|z| z.step),
            ZoomSpeed { .. } => zoom.is_some_and(|z| z.continuous),
            Focus { .. } => self.focus,
            Photo => self.photo,
            RecordStart | RecordStop => self.record,
            VideoMode { mode } => self.video_modes.contains(mode),
        }
    }
}

/// Commands to a camera (spec 40 §1.2, P2 subset). JSON: `{"cmd": "...", "args": {...}}`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "cmd", content = "args", rename_all = "snake_case")]
#[ts(export, rename_all = "snake_case")]
pub enum CameraCommand {
    /// −100..100, +yaw = right, +pitch = up.
    GimbalRate {
        yaw: i8,
        pitch: i8,
    },
    GimbalAngle {
        yaw_deg: f32,
        pitch_deg: f32,
    },
    GimbalCenter {
        mode: CenterMode,
    },
    GimbalMode {
        mode: GimbalMode,
    },
    ZoomAbsolute {
        zoom: f32,
    },
    ZoomStep {
        steps: i8,
    },
    /// 1 in, 0 stop, −1 out.
    ZoomSpeed {
        dir: i8,
    },
    ZoomReset,
    Focus {
        dir: i8,
    },
    Photo,
    RecordStart,
    RecordStop,
    VideoMode {
        mode: VideoMode,
    },
}

impl CameraCommand {
    /// The serde tag, used in the audit log.
    pub fn name(&self) -> &'static str {
        match self {
            Self::GimbalRate { .. } => "gimbal_rate",
            Self::GimbalAngle { .. } => "gimbal_angle",
            Self::GimbalCenter { .. } => "gimbal_center",
            Self::GimbalMode { .. } => "gimbal_mode",
            Self::ZoomAbsolute { .. } => "zoom_absolute",
            Self::ZoomStep { .. } => "zoom_step",
            Self::ZoomSpeed { .. } => "zoom_speed",
            Self::ZoomReset => "zoom_reset",
            Self::Focus { .. } => "focus",
            Self::Photo => "photo",
            Self::RecordStart => "record_start",
            Self::RecordStop => "record_stop",
            Self::VideoMode { .. } => "video_mode",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, rename_all = "snake_case")]
pub enum RecordingState {
    Idle,
    Recording,
    NoCard,
    CardError,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GimbalAttitude {
    pub yaw: f32,
    pub pitch: f32,
    pub roll: f32,
    #[ts(type = "number")]
    pub age_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Firmware {
    pub camera: String,
    pub gimbal: String,
    pub zoom: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CameraState {
    pub connected: bool,
    pub last_error: Option<String>,
    pub firmware: Option<Firmware>,
    pub recording: RecordingState,
    pub zoom: f32,
    pub zoom_max: f32,
    pub video_mode: Option<VideoMode>,
    pub gimbal: Option<GimbalAttitude>,
    pub gimbal_mode: Option<GimbalMode>,
    /// Main-stream resolution once known (0x20); UI normalises pixel coordinates with it.
    pub stream: Option<(u16, u16)>,
}

impl CameraState {
    pub fn disconnected(zoom_max: f32) -> Self {
        Self {
            connected: false,
            last_error: None,
            firmware: None,
            recording: RecordingState::Idle,
            zoom: 1.0,
            zoom_max,
            video_mode: None,
            gimbal: None,
            gimbal_mode: None,
            stream: None,
        }
    }
}

/// One entry of the WebSocket snapshot.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CameraSnapshot {
    pub sysid: SysId,
    pub caps: CameraCaps,
    pub state: CameraState,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, rename_all = "snake_case")]
pub enum VideoSource {
    Mt11,
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, rename_all = "snake_case")]
pub enum VideoSourceMode {
    Auto,
    Mt11,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct VideoSourceStatus {
    pub mode: VideoSourceMode,
    pub source: VideoSource,
    pub scanning: bool,
    pub probe_ok: bool,
    /// MediaMTX path the WHEP relay forwards to.
    pub whep_path: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, rename_all = "snake_case")]
pub enum Deadman {
    Ok,
    Lost,
}

/// Per-vehicle camera configuration (spec 60 §3.3). Stored as one row per sysid.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CameraProfile {
    pub sysid: SysId,
    pub kind: CameraKind,
    /// IPv4 dotted address (also used to build the RTSP URL).
    pub host: String,
    pub port: u16,
    /// `{host}` is expanded for MT11; arbitrary for MAVLink cameras.
    pub rtsp_url: String,
    pub comp_id: u8,
    pub video_source_mode: VideoSourceMode,
    pub android_url: String,
    pub encoding_preset: String,
    pub thermal_palette: u8,
    pub thermal_overlay: bool,
    pub ai_box_px: u16,
    pub clock_sync: bool,
    pub auto_record: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProfileError {
    pub field: &'static str,
    pub message: String,
}

impl std::fmt::Display for ProfileError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.field, self.message)
    }
}

impl CameraProfile {
    pub fn default_for(sysid: SysId) -> Self {
        Self {
            sysid,
            kind: CameraKind::None,
            host: "192.168.144.25".into(),
            port: 37260,
            rtsp_url: "rtsp://{host}:8554/video1".into(),
            comp_id: 100,
            video_source_mode: VideoSourceMode::Auto,
            android_url: "http://127.0.0.1:8080".into(),
            encoding_preset: "h264_1080p".into(),
            thermal_palette: 3,
            thermal_overlay: true,
            ai_box_px: 100,
            clock_sync: true,
            auto_record: true,
        }
    }

    pub fn rtsp_url_resolved(&self) -> String {
        self.rtsp_url.replace("{host}", &self.host)
    }

    /// Range / format checks from spec 60 §3.3; the first failing field is reported.
    pub fn validate(&self) -> Result<(), ProfileError> {
        let err = |field: &'static str, message: &str| {
            Err(ProfileError {
                field,
                message: message.into(),
            })
        };
        if self.host.parse::<std::net::Ipv4Addr>().is_err() {
            return err("host", "must be an IPv4 address");
        }
        if self.port == 0 {
            return err("port", "must be 1-65535");
        }
        if !self.rtsp_url.starts_with("rtsp://") {
            return err("rtsp_url", "must start with rtsp://");
        }
        if self.comp_id == 0 {
            return err("comp_id", "must be 1-255");
        }
        if !(32..=600).contains(&self.ai_box_px) {
            return err("ai_box_px", "must be 32-600");
        }
        if !(self.thermal_palette == 0 || (2..=11).contains(&self.thermal_palette)) {
            return err("thermal_palette", "must be 0 or 2-11");
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn siyi_caps_match_spec() {
        let c = CameraCaps::siyi_mt11();
        assert_eq!(c.kind, CameraKind::SiyiMt11);
        let z = c.zoom.as_ref().unwrap();
        assert_eq!(z.max, 165.0);
        assert!(z.absolute && z.step && z.continuous);
        let g = c.gimbal.as_ref().unwrap();
        assert_eq!(g.pitch_range, (-90.0, 30.0));
        assert_eq!(
            g.modes,
            vec![GimbalMode::Lock, GimbalMode::Follow, GimbalMode::Fpv]
        );
        assert!(g.rate && g.angle && g.center && g.attitude);
        assert_eq!(
            c.video_modes,
            vec![VideoMode::Rgb, VideoMode::Thermal, VideoMode::SideBySide]
        );
        assert!(c.photo && c.record && c.focus);
    }

    #[test]
    fn none_caps_support_nothing() {
        let c = CameraCaps::none();
        assert_eq!(c.kind, CameraKind::None);
        for cmd in [
            CameraCommand::Photo,
            CameraCommand::RecordStart,
            CameraCommand::ZoomReset,
            CameraCommand::GimbalRate { yaw: 1, pitch: 1 },
            CameraCommand::VideoMode { mode: VideoMode::Rgb },
        ] {
            assert!(!c.supports(&cmd), "{cmd:?}");
        }
    }

    #[test]
    fn supports_checks_the_right_cap() {
        let mut c = CameraCaps::siyi_mt11();
        assert!(c.supports(&CameraCommand::ZoomSpeed { dir: 1 }));
        c.zoom = Some(ZoomCaps {
            continuous: false,
            ..c.zoom.clone().unwrap()
        });
        assert!(!c.supports(&CameraCommand::ZoomSpeed { dir: 1 }));
        assert!(c.supports(&CameraCommand::ZoomStep { steps: 1 }));
        assert!(c.supports(&CameraCommand::GimbalCenter {
            mode: CenterMode::OneKeyReset
        }));
        c.video_modes = vec![VideoMode::Rgb];
        assert!(!c.supports(&CameraCommand::VideoMode {
            mode: VideoMode::Thermal
        }));
        assert!(c.supports(&CameraCommand::VideoMode { mode: VideoMode::Rgb }));
        c.gimbal = None;
        assert!(!c.supports(&CameraCommand::GimbalRate { yaw: 0, pitch: 0 }));
    }

    #[test]
    fn profile_validation_names_the_field() {
        let ok = CameraProfile::default_for(1);
        assert_eq!(ok.validate(), Ok(()));
        let bad_host = CameraProfile {
            host: "camera.local".into(),
            ..ok.clone()
        };
        assert_eq!(
            bad_host.validate(),
            Err(ProfileError {
                field: "host",
                message: "must be an IPv4 address".into()
            })
        );
        let bad_port = CameraProfile {
            port: 0,
            ..ok.clone()
        };
        assert_eq!(bad_port.validate().unwrap_err().field, "port");
        let bad_rtsp = CameraProfile {
            rtsp_url: "http://x".into(),
            ..ok.clone()
        };
        assert_eq!(bad_rtsp.validate().unwrap_err().field, "rtsp_url");
        let bad_box = CameraProfile {
            ai_box_px: 10,
            ..ok.clone()
        };
        assert_eq!(bad_box.validate().unwrap_err().field, "ai_box_px");
        let bad_palette = CameraProfile {
            thermal_palette: 1,
            ..ok.clone()
        };
        assert_eq!(bad_palette.validate().unwrap_err().field, "thermal_palette");
        assert_eq!(ok.rtsp_url_resolved(), "rtsp://192.168.144.25:8554/video1");
    }

    #[test]
    fn command_json_shape() {
        let rate = CameraCommand::GimbalRate { yaw: 10, pitch: -5 };
        let json = serde_json::to_string(&rate).unwrap();
        assert_eq!(json, r#"{"cmd":"gimbal_rate","args":{"yaw":10,"pitch":-5}}"#);
        assert_eq!(serde_json::from_str::<CameraCommand>(&json).unwrap(), rate);
        assert_eq!(
            serde_json::to_string(&CameraCommand::Photo).unwrap(),
            r#"{"cmd":"photo"}"#
        );
        assert_eq!(
            CameraCommand::VideoMode {
                mode: VideoMode::SideBySide
            }
            .name(),
            "video_mode"
        );
        let state = CameraState::disconnected(165.0);
        assert!(!state.connected);
        assert_eq!(state.recording, RecordingState::Idle);
        assert_eq!(state.zoom_max, 165.0);
    }
}
