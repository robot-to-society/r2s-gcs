//! One `CameraCommand` → wire frames, with the refusals of spec 70 §3 (plan rulings 2, 4, 9).

use std::time::{Duration, Instant};

use rgcs_core::{
    mt11_encoding_presets, CameraCommand, CameraState, RecordingState, ThermalGain, VideoMode,
    AI_BOX_PX_DEFAULT,
};
use tokio::sync::watch;

use crate::siyi::ai::{self, ClickError, DETECTION_LOOKBACK};
use crate::siyi::apply::Media;
use crate::siyi::client::Link;
use crate::siyi::encode;
use crate::CameraError;

/// 0x55 (AI mode on) needs this long before a 0x56 select is accepted (`video_routes.py`).
const AI_MODE_SETTLE: Duration = Duration::from_millis(100);

/// One command → one or more wire frames; re-reads what the camera changed.
/// `Encoding` leaves the 0x20 re-read to the session (300 ms later).
pub(crate) async fn exec(
    link: &mut Link<'_>,
    state: &watch::Sender<CameraState>,
    media: &Media,
    cmd: CameraCommand,
) -> Result<Media, CameraError> {
    use CameraCommand::*;
    let snap = state.borrow().clone();
    match cmd {
        GimbalRate { yaw, pitch } => link.udp(0x07, &encode::gimbal_rate(yaw, pitch)).await,
        GimbalAngle { yaw_deg, pitch_deg } => link.udp(0x0E, &encode::gimbal_angle(yaw_deg, pitch_deg)).await,
        GimbalCenter { mode } => link.udp(0x08, &encode::center(mode)).await,
        GimbalMode { mode } => two(link, (0x0C, &encode::gimbal_mode(mode)), (0x19, &[])).await,
        ZoomAbsolute { zoom } => zoom_to(link, zoom, snap.zoom_max).await,
        ZoomStep { steps } => zoom_to(link, snap.zoom + f32::from(steps), snap.zoom_max).await,
        ZoomReset => zoom_to(link, 1.0, snap.zoom_max).await,
        ZoomSpeed { dir } => link.tcp(0x05, &encode::zoom_speed(dir)).await,
        Focus { dir } => link.tcp(0x06, &encode::focus(dir)).await,
        Photo => link.tcp(0x0C, &encode::photo()).await,
        RecordStart => record(link, snap.recording != RecordingState::Recording).await,
        RecordStop => record(link, snap.recording == RecordingState::Recording).await,
        VideoMode { mode } => video_mode(link, &snap, mode).await,
        ThermalGain { gain } => thermal_gain(link, gain).await,
        ThermalPalette { palette } => link.tcp(0x1B, &encode::thermal_palette(palette)).await,
        MeasurePoint { x, y } => measure_point(link, &snap, x, y).await,
        AiSelectBox { x, y, box_px } => ai_select_box(link, &snap, x, y, box_px).await,
        AiSelectPoint { x, y } => ai_select_point(link, &snap, media, x, y).await,
        AiCancel => link.tcp(0x56, &ai::encode_ai_select(None)).await,
        Encoding { preset } => set_encoding(link, state, &preset).await,
        SyncClock => {
            return Ok(Media {
                clock: media.clock.request(),
                ..media.clone()
            })
        }
    }?;
    Ok(media.clone())
}

async fn two(link: &mut Link<'_>, a: (u8, &[u8]), b: (u8, &[u8])) -> Result<(), CameraError> {
    link.tcp(a.0, a.1).await?;
    link.tcp(b.0, b.1).await
}

pub(crate) async fn zoom_to(link: &mut Link<'_>, zoom: f32, max: f32) -> Result<(), CameraError> {
    link.tcp(0x0F, &encode::zoom_absolute(zoom, max)).await?;
    link.tcp(0x18, &[]).await
}

/// The SDK only has a toggle; send it only when the current state differs (Review Focus 5).
pub(crate) async fn record(link: &mut Link<'_>, toggle: bool) -> Result<(), CameraError> {
    if toggle {
        link.tcp(0x0C, &encode::record_toggle()).await?;
    }
    link.tcp(0x0A, &[]).await
}

/// IR / 2画面 cannot track (40 §3.1): an active track is cancelled first.
async fn video_mode(link: &mut Link<'_>, snap: &CameraState, mode: VideoMode) -> Result<(), CameraError> {
    if mode != VideoMode::Rgb && snap.track.is_some() {
        link.tcp(0x56, &ai::encode_ai_select(None)).await?;
    }
    two(link, (0x11, &encode::video_mode(mode)), (0x10, &[])).await
}

async fn thermal_gain(link: &mut Link<'_>, gain: ThermalGain) -> Result<(), CameraError> {
    two(link, (0x38, &encode::thermal_gain(gain)), (0x37, &[])).await
}

fn stream_of(snap: &CameraState) -> Result<(u16, u16), CameraError> {
    snap.stream.ok_or(CameraError::Refused("stream_unknown"))
}

fn require_mode(snap: &CameraState, mode: VideoMode, code: &'static str) -> Result<(), CameraError> {
    if snap.video_mode == Some(mode) {
        Ok(())
    } else {
        Err(CameraError::Refused(code))
    }
}

async fn measure_point(link: &mut Link<'_>, snap: &CameraState, x: f32, y: f32) -> Result<(), CameraError> {
    require_mode(snap, VideoMode::Thermal, "thermal_only")?;
    let (w, h) = stream_of(snap)?;
    let (px, py) = ai::normalized_to_stream_point(x, y, w, h);
    link.tcp(0x12, &encode::point_temp(px, py)).await
}

/// 0x55 on, a short settle, then the 0x56 selection.
async fn ai_select(link: &mut Link<'_>, payload: [u8; 9]) -> Result<(), CameraError> {
    link.tcp(0x55, &ai::ai_mode(true)).await?;
    tokio::time::sleep(AI_MODE_SETTLE).await;
    link.tcp(0x56, &payload).await
}

async fn ai_select_box(
    link: &mut Link<'_>,
    snap: &CameraState,
    x: f32,
    y: f32,
    box_px: Option<u16>,
) -> Result<(), CameraError> {
    require_mode(snap, VideoMode::Rgb, "rgb_only")?;
    let (w, h) = stream_of(snap)?;
    let b = ai::click_to_stream_box(x, y, w, h, box_px.unwrap_or(AI_BOX_PX_DEFAULT)).map_err(click_error)?;
    ai_select(link, ai::encode_ai_select(Some(b))).await
}

/// Ctrl+click: the detection under the click in the last second, else the click itself.
async fn ai_select_point(
    link: &mut Link<'_>,
    snap: &CameraState,
    media: &Media,
    x: f32,
    y: f32,
) -> Result<(), CameraError> {
    require_mode(snap, VideoMode::Rgb, "rgb_only")?;
    let (w, h) = stream_of(snap)?;
    let (nx, ny) = point_target(media, Instant::now(), x, y)?;
    let (px, py) = ai::normalized_to_stream_point(nx, ny, w, h);
    ai_select(link, ai::encode_ai_select_point(px, py)).await
}

/// The normalized point a Ctrl+click selects: a recent detection's centre, or the click.
pub(crate) fn point_target(media: &Media, now: Instant, x: f32, y: f32) -> Result<(f32, f32), CameraError> {
    let recent: Vec<&ai::DetectionFrame> = media
        .history
        .iter()
        .filter(|(t, _)| now.saturating_duration_since(*t) <= DETECTION_LOOKBACK)
        .map(|(_, f)| f)
        .collect();
    if recent.is_empty() {
        return Ok((x, y));
    }
    let d = ai::pick_detection(&recent, x, y).ok_or(CameraError::Refused("no_detection"))?;
    Ok(((d.x0 + d.x1) / 2.0, (d.y0 + d.y1) / 2.0))
}

fn click_error(e: ClickError) -> CameraError {
    match e {
        ClickError::StreamUnknown => CameraError::Refused("stream_unknown"),
        ClickError::OutOfRange => CameraError::Protocol("click outside the frame".into()),
    }
}

/// 0x21 for a preset; the resolution is unknown until 0x20 answers again (Review Focus 4).
async fn set_encoding(
    link: &mut Link<'_>,
    state: &watch::Sender<CameraState>,
    preset: &str,
) -> Result<(), CameraError> {
    let p = mt11_encoding_presets()
        .into_iter()
        .find(|p| p.id == preset)
        .ok_or(CameraError::Unsupported("encoding preset"))?;
    state.send_modify(|s| {
        *s = CameraState {
            stream: None,
            encoding: None,
            ..s.clone()
        }
    });
    link.tcp(0x21, &ai::encode_encoding(&p)).await
}
