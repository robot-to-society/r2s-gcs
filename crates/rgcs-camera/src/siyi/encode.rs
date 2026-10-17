//! Command payloads (the `data` part); the client wraps them with `make_packet`.

use rgcs_core::{CenterMode, GimbalMode, VideoMode};

pub const PITCH_MIN: f32 = -90.0;
pub const PITCH_MAX: f32 = 30.0;

/// CMD 0x00 heartbeat payload.
pub fn heartbeat() -> [u8; 1] {
    [0]
}

/// CMD 0x07 (UDP): −100..100, +yaw = right, +pitch = up.
pub fn gimbal_rate(yaw: i8, pitch: i8) -> [u8; 2] {
    [yaw as u8, pitch as u8]
}

/// CMD 0x0E (UDP): tenths of a degree, i16 LE; pitch clamped to the MT11 range.
pub fn gimbal_angle(yaw_deg: f32, pitch_deg: f32) -> [u8; 4] {
    let yaw = (yaw_deg * 10.0).round() as i16;
    let pitch = (pitch_deg.clamp(PITCH_MIN, PITCH_MAX) * 10.0).round() as i16;
    let [y0, y1] = yaw.to_le_bytes();
    let [p0, p1] = pitch.to_le_bytes();
    [y0, y1, p0, p1]
}

/// CMD 0x08 (UDP).
pub fn center(mode: CenterMode) -> [u8; 1] {
    [match mode {
        CenterMode::OneKeyReset => 1,
        CenterMode::CenterFaceDown => 2,
        CenterMode::Center => 3,
        CenterMode::FaceDown => 4,
    }]
}

/// CMD 0x0C func_type for the motion mode.
pub fn gimbal_mode(mode: GimbalMode) -> [u8; 1] {
    [match mode {
        GimbalMode::Lock => 3,
        GimbalMode::Follow => 4,
        GimbalMode::Fpv => 5,
    }]
}

/// CMD 0x0C func 0.
pub fn photo() -> [u8; 1] {
    [0]
}

/// CMD 0x0C func 2 (toggle; the client checks the state first).
pub fn record_toggle() -> [u8; 1] {
    [2]
}

/// CMD 0x0F: integer part and tenths, clamped to 1..max.
pub fn zoom_absolute(zoom: f32, max: f32) -> [u8; 2] {
    let clamped = zoom.clamp(1.0, max);
    let mut int_part = clamped.trunc() as u16;
    let mut tenths = ((clamped - clamped.trunc()) * 10.0).round() as u8;
    if tenths > 9 {
        int_part += 1;
        tenths = 0;
    }
    [int_part.min(255) as u8, tenths]
}

/// CMD 0x05: 1 zoom in, 0 stop, −1 zoom out (sent as 0xFF).
pub fn zoom_speed(dir: i8) -> [u8; 1] {
    [dir.signum() as u8]
}

/// CMD 0x06 manual focus: 1 far, 0 stop, −1 near.
pub fn focus(dir: i8) -> [u8; 1] {
    [dir.signum() as u8]
}

/// CMD 0x11 (main, sub) stream pairs.
pub fn video_mode(mode: VideoMode) -> [u8; 2] {
    match mode {
        VideoMode::Rgb => [0, 2],
        VideoMode::Thermal => [2, 0],
        VideoMode::SideBySide => [3, 2],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rgcs_core::{CenterMode, GimbalMode, VideoMode};

    #[test]
    fn gimbal_angle_rounds_to_tenths_and_clamps() {
        assert_eq!(gimbal_angle(60.54, 0.0), [0x5D, 0x02, 0, 0]);
        assert_eq!(gimbal_angle(0.0, 45.0), gimbal_angle(0.0, 30.0));
        assert_eq!(gimbal_angle(0.0, -120.0), gimbal_angle(0.0, -90.0));
    }

    #[test]
    fn gimbal_mode_bytes() {
        assert_eq!(gimbal_mode(GimbalMode::Lock), [0x03]);
        assert_eq!(gimbal_mode(GimbalMode::Follow), [0x04]);
        assert_eq!(gimbal_mode(GimbalMode::Fpv), [0x05]);
    }

    #[test]
    fn zoom_absolute_int_and_tenths() {
        assert_eq!(zoom_absolute(2.5, 165.0), [2, 5]);
        assert_eq!(zoom_absolute(9.96, 165.0), [10, 0]);
        assert_eq!(zoom_absolute(0.2, 165.0), [1, 0]);
        assert_eq!(zoom_absolute(999.0, 165.0), [165, 0]);
    }

    #[test]
    fn video_mode_pairs() {
        assert_eq!(video_mode(VideoMode::Rgb), [0, 2]);
        assert_eq!(video_mode(VideoMode::Thermal), [2, 0]);
        assert_eq!(video_mode(VideoMode::SideBySide), [3, 2]);
    }

    #[test]
    fn gimbal_rate_clamps_to_i8_range() {
        assert_eq!(gimbal_rate(100, -100), [100, 0x9C]);
        assert_eq!(center(CenterMode::OneKeyReset), [1]);
        assert_eq!(center(CenterMode::FaceDown), [4]);
        assert_eq!(heartbeat(), [0]);
        assert_eq!(photo(), [0]);
        assert_eq!(record_toggle(), [2]);
        assert_eq!(zoom_speed(-1), [0xFF]);
        assert_eq!(zoom_speed(1), [1]);
        assert_eq!(focus(0), [0]);
    }
}
