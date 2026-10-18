//! `config.toml`: only what is needed to start (spec 30 §1). Everything else lives in SQLite.

use std::net::SocketAddr;
use std::path::{Path, PathBuf};

use serde::Deserialize;

pub const DEFAULT_PATH: &str = "/etc/rgcs/config.toml";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    Standalone,
    Edge,
    Hub,
}

/// MAVLink log retrieval (addendum §9): `auto` = on for tcp/udp links and serial links at
/// 921600 baud or more, off for slower serial links.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogFetch {
    Auto,
    On,
    Off,
}

pub const LOG_FETCH_MIN_BAUD: u32 = 921_600;

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Config {
    pub listen: SocketAddr,
    pub mavlink_url: String,
    pub data_dir: PathBuf,
    pub role: Role,
    /// Directory with the built UI (`ui/dist`). `None` serves a placeholder page.
    pub ui_dir: Option<PathBuf>,
    /// Interval of the telemetry diff frames in milliseconds.
    pub telemetry_interval_ms: u64,
    /// Raster tile template for the operations map (`{z}/{x}/{y}`); swap for imagery on site.
    pub map_tile_url: String,
    pub map_attribution: String,
    /// MediaMTX WHEP endpoint the browser offers are relayed to (spec 30 §5).
    pub whep_upstream: String,
    /// RTSP DESCRIBE probe timeout for the video source monitor.
    pub video_probe_timeout_ms: u64,
    pub log_fetch: LogFetch,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            listen: "0.0.0.0:8000".parse().expect("static address"),
            mavlink_url: "udpin:127.0.0.1:15555".into(),
            data_dir: PathBuf::from("/var/lib/rgcs"),
            role: Role::Standalone,
            ui_dir: None,
            telemetry_interval_ms: 100,
            map_tile_url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png".into(),
            map_attribution: "© OpenStreetMap contributors".into(),
            whep_upstream: "http://127.0.0.1:8889/mt11/whep".into(),
            video_probe_timeout_ms: 2000,
            log_fetch: LogFetch::Auto,
        }
    }
}

impl Config {
    pub fn parse(text: &str) -> Result<Self, toml::de::Error> {
        toml::from_str(text)
    }

    /// Whether `LOG_REQUEST_*` retrieval is offered (see [`LogFetch`]).
    pub fn log_fetch_enabled(&self) -> bool {
        match self.log_fetch {
            LogFetch::On => true,
            LogFetch::Off => false,
            LogFetch::Auto => !matches!(
                self.mavlink_url.parse::<rgcs_mavlink::LinkUrl>(),
                Ok(rgcs_mavlink::LinkUrl::Serial { baud, .. }) if baud < LOG_FETCH_MIN_BAUD
            ),
        }
    }

    /// Missing file → defaults; unreadable or invalid file → error.
    pub fn load(path: &Path) -> anyhow::Result<Self> {
        match std::fs::read_to_string(path) {
            Ok(text) => Ok(Self::parse(&text)?),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(e) => Err(e.into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_file_gives_defaults() {
        assert_eq!(Config::parse("").unwrap(), Config::default());
    }

    #[test]
    fn fields_override_defaults() {
        let c = Config::parse(
            r#"
            listen = "127.0.0.1:9000"
            mavlink_url = "/dev/ttyACM0,115200"
            role = "edge"
            ui_dir = "/opt/rgcs/ui"
            "#,
        )
        .unwrap();
        assert_eq!(c.listen.port(), 9000);
        assert_eq!(c.mavlink_url, "/dev/ttyACM0,115200");
        assert_eq!(c.role, Role::Edge);
        assert_eq!(c.ui_dir.as_deref(), Some(Path::new("/opt/rgcs/ui")));
        assert_eq!(c.telemetry_interval_ms, 100);
    }

    #[test]
    fn map_tiles_default_to_osm_and_can_be_overridden() {
        let d = Config::default();
        assert_eq!(d.map_tile_url, "https://tile.openstreetmap.org/{z}/{x}/{y}.png");
        assert_eq!(d.map_attribution, "© OpenStreetMap contributors");
        let c = Config::parse(
            "map_tile_url = 'https://tiles.example/{z}/{x}/{y}.jpg'\nmap_attribution = 'Example'",
        )
        .unwrap();
        assert_eq!(c.map_tile_url, "https://tiles.example/{z}/{x}/{y}.jpg");
        assert_eq!(c.map_attribution, "Example");
    }

    #[test]
    fn video_defaults() {
        let d = Config::default();
        assert_eq!(d.whep_upstream, "http://127.0.0.1:8889/mt11/whep");
        assert_eq!(d.video_probe_timeout_ms, 2000);
        let c = Config::parse("whep_upstream = 'http://10.0.0.2:8889/cam/whep'").unwrap();
        assert_eq!(c.whep_upstream, "http://10.0.0.2:8889/cam/whep");
    }

    #[test]
    fn unknown_keys_are_rejected() {
        assert!(Config::parse("mavlink = 'x'").is_err());
    }

    #[test]
    fn missing_file_is_fine() {
        assert_eq!(
            Config::load(Path::new("/nonexistent/rgcs.toml")).unwrap(),
            Config::default()
        );
    }

    #[test]
    fn log_fetch_auto_follows_the_link_speed() {
        let tcp = Config::parse("mavlink_url = 'tcp:127.0.0.1:5760'").unwrap();
        assert_eq!(tcp.log_fetch, LogFetch::Auto);
        assert!(tcp.log_fetch_enabled());
        assert!(!Config::parse("mavlink_url = '/dev/ttyAMA0,57600'")
            .unwrap()
            .log_fetch_enabled());
        assert!(Config::parse("mavlink_url = '/dev/ttyAMA0,921600'")
            .unwrap()
            .log_fetch_enabled());
        assert!(
            !Config::parse("mavlink_url = 'tcp:127.0.0.1:5760'\nlog_fetch = 'off'")
                .unwrap()
                .log_fetch_enabled()
        );
        assert!(
            Config::parse("mavlink_url = '/dev/ttyAMA0,57600'\nlog_fetch = 'on'")
                .unwrap()
                .log_fetch_enabled()
        );
    }
}
