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
        }
    }
}

impl Config {
    pub fn parse(text: &str) -> Result<Self, toml::de::Error> {
        toml::from_str(text)
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
}
