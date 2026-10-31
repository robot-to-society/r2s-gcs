//! Docomo LTE overlay: tile math, tile validation and paths (pure; LTE overlay design).

use std::path::{Path, PathBuf};

use serde::Deserialize;

/// Zoom levels fetched for an area (MapLibre overzooms above the top one).
pub const LTE_MIN_ZOOM: u8 = 8;
pub const LTE_MAX_ZOOM: u8 = 14;
/// Larger requests are refused (`too_many_tiles`) before anything is fetched.
pub const LTE_MAX_TILES: u64 = 3000;
/// The tile route answers 404 above this zoom.
pub const TILE_ROUTE_MAX_ZOOM: u8 = 22;
/// The docomo service-area tiles (LTE).
pub const DEFAULT_LTE_TILE_URL: &str =
    "https://servicearea.nttdocomo.co.jp/map/1014/0000000000000000/{z}/{x}/{z}_{x}_{y}.gif";
/// Docomo serves 256×256 tiles.
const TILE_PX: u16 = 256;

/// A 1×1 transparent GIF: the answer for a tile that is not cached.
pub const TRANSPARENT_GIF: &[u8] = &[
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff,
    0xff, 0xff, 0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00,
    0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b,
];

/// A rectangle in degrees.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
pub struct Rect {
    pub south: f64,
    pub west: f64,
    pub north: f64,
    pub east: f64,
}

impl Rect {
    /// `-85 < south < north < 85`, `-180 <= west < east <= 180` (NaN fails every comparison).
    pub fn is_valid(&self) -> bool {
        -85.0 < self.south
            && self.south < self.north
            && self.north < 85.0
            && -180.0 <= self.west
            && self.west < self.east
            && self.east <= 180.0
    }
}

/// The inclusive tile ranges of a rectangle at one zoom.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TileRange {
    pub z: u8,
    pub x0: u32,
    pub x1: u32,
    pub y0: u32,
    pub y1: u32,
}

impl TileRange {
    pub fn tile_count(&self) -> u64 {
        u64::from(self.x1 - self.x0 + 1) * u64::from(self.y1 - self.y0 + 1)
    }

    pub fn contains(&self, x: u32, y: u32) -> bool {
        (self.x0..=self.x1).contains(&x) && (self.y0..=self.y1).contains(&y)
    }
}

fn clamp_tile(v: f64, z: u8) -> u32 {
    let max = (1u64 << z) - 1;
    (v.floor().max(0.0) as u64).min(max) as u32
}

fn lon_to_x(lon: f64, z: u8) -> u32 {
    clamp_tile((lon + 180.0) / 360.0 * (1u64 << z) as f64, z)
}

fn lat_to_y(lat: f64, z: u8) -> u32 {
    let r = lat.to_radians();
    let y = (1.0 - (r.tan() + 1.0 / r.cos()).ln() / std::f64::consts::PI) / 2.0;
    clamp_tile(y * (1u64 << z) as f64, z)
}

/// Every tile at zoom `z` that intersects `r` (north is the smaller y).
pub fn range(r: &Rect, z: u8) -> TileRange {
    TileRange {
        z,
        x0: lon_to_x(r.west, z),
        x1: lon_to_x(r.east, z),
        y0: lat_to_y(r.north, z),
        y1: lat_to_y(r.south, z),
    }
}

/// The ranges of zoom 8–14.
pub fn ranges(r: &Rect) -> Vec<TileRange> {
    (LTE_MIN_ZOOM..=LTE_MAX_ZOOM).map(|z| range(r, z)).collect()
}

/// Tiles needed for `r` across zoom 8–14.
pub fn count(r: &Rect) -> u64 {
    ranges(r).iter().map(TileRange::tile_count).sum()
}

/// Every `(z, x, y)` of `r`, zoom ascending.
pub fn tiles(r: &Rect) -> impl Iterator<Item = (u8, u32, u32)> {
    ranges(r)
        .into_iter()
        .flat_map(|t| (t.x0..=t.x1).flat_map(move |x| (t.y0..=t.y1).map(move |y| (t.z, x, y))))
}

/// Whether fetching `r` would include the tile.
pub fn covers(r: &Rect, z: u8, x: u32, y: u32) -> bool {
    (LTE_MIN_ZOOM..=LTE_MAX_ZOOM).contains(&z) && range(r, z).contains(x, y)
}

/// A well-formed tile address the route serves (anything else is 404).
pub fn in_range(z: u8, x: u32, y: u32) -> bool {
    z <= TILE_ROUTE_MAX_ZOOM && u64::from(x) < (1u64 << z) && u64::from(y) < (1u64 << z)
}

/// Accepts a docomo tile: a GIF87a / GIF89a of 256×256 served as `image/gif`.
pub fn check_tile(content_type: Option<&str>, body: &[u8]) -> Result<(), &'static str> {
    let ct = content_type.unwrap_or("").trim().to_ascii_lowercase();
    if ct.starts_with("text/html") || body.first() == Some(&b'<') {
        return Err("html");
    }
    let magic = body.get(..6);
    if !ct.starts_with("image/gif") || !(magic == Some(b"GIF87a") || magic == Some(b"GIF89a")) {
        return Err("not_gif");
    }
    let (Some(w), Some(h)) = (body.get(6..8), body.get(8..10)) else {
        return Err("not_gif");
    };
    let px = |b: &[u8]| u16::from_le_bytes([b[0], b[1]]);
    if px(w) != TILE_PX || px(h) != TILE_PX {
        return Err("bad_size");
    }
    Ok(())
}

/// The template with `{z}`, `{x}` and `{y}` filled in (each may repeat).
pub fn tile_url(template: &str, z: u8, x: u32, y: u32) -> String {
    template
        .replace("{z}", &z.to_string())
        .replace("{x}", &x.to_string())
        .replace("{y}", &y.to_string())
}

/// `<data_dir>/lte/{z}/{x}/{y}.gif`.
pub fn tile_path(data_dir: &Path, z: u8, x: u32, y: u32) -> PathBuf {
    data_dir
        .join("lte")
        .join(z.to_string())
        .join(x.to_string())
        .join(format!("{y}.gif"))
}

/// `"205.gif"` → 205; anything else → `None`.
pub fn parse_tile_name(name: &str) -> Option<u32> {
    let digits = name.strip_suffix(".gif")?;
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    digits.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    const NACHI: Rect = Rect {
        south: 33.62,
        west: 135.85,
        north: 33.71,
        east: 135.96,
    };

    fn gif(w: u16, h: u16) -> Vec<u8> {
        let mut b = b"GIF89a".to_vec();
        b.extend_from_slice(&w.to_le_bytes());
        b.extend_from_slice(&h.to_le_bytes());
        b.extend_from_slice(&[0, 0, 0, 0x3b]);
        b
    }

    #[test]
    fn rect_rules() {
        assert!(NACHI.is_valid());
        let bad = |s, w, n, e| {
            !Rect {
                south: s,
                west: w,
                north: n,
                east: e,
            }
            .is_valid()
        };
        assert!(bad(33.7, 135.8, 33.6, 135.9), "south above north");
        assert!(bad(33.6, 135.9, 33.7, 135.8), "west east of east");
        assert!(bad(-85.0, 0.0, 10.0, 1.0), "south at the pole limit");
        assert!(bad(0.0, 0.0, 85.0, 1.0), "north at the pole limit");
        assert!(bad(0.0, -180.1, 1.0, 1.0));
        assert!(bad(0.0, 0.0, 1.0, f64::NAN));
        assert!(!bad(-84.9, -180.0, 84.9, 180.0));
    }

    #[test]
    fn a_point_falls_in_the_expected_tile() {
        let r = Rect {
            south: 33.668,
            west: 135.904,
            north: 33.6683,
            east: 135.9042,
        };
        let z8 = range(&r, 8);
        assert_eq!((z8.x0, z8.x1, z8.y0, z8.y1), (224, 224, 102, 102));
        assert_eq!(count(&r), 7, "one tile per zoom 8–14");
    }

    #[test]
    fn counts_tiles_and_lists_them() {
        let total = count(&NACHI);
        let listed: Vec<_> = tiles(&NACHI).collect();
        assert_eq!(listed.len() as u64, total);
        assert!(total > 7 && total < LTE_MAX_TILES, "{total}");
        assert!(listed.iter().all(|&(z, x, y)| covers(&NACHI, z, x, y)));
        assert!(!covers(&NACHI, 8, 0, 0));
        assert!(!covers(&NACHI, 7, 112, 51), "zoom 7 is outside the fetched range");
    }

    #[test]
    fn the_world_is_clamped_and_too_many() {
        let world = Rect {
            south: -84.9,
            west: -180.0,
            north: 84.9,
            east: 180.0,
        };
        let z8 = range(&world, 8);
        assert_eq!(
            (z8.x0, z8.x1, z8.y0, z8.y1),
            (0, 255, 1, 254),
            "84.9° is inside the top / bottom row"
        );
        assert!(count(&world) > LTE_MAX_TILES);
    }

    #[test]
    fn tile_checks() {
        assert_eq!(check_tile(Some("image/gif"), &gif(256, 256)), Ok(()));
        let mut g87 = gif(256, 256);
        g87[4] = b'7';
        assert_eq!(check_tile(Some("image/gif; charset=binary"), &g87), Ok(()));
        assert_eq!(check_tile(Some("image/gif"), &gif(512, 256)), Err("bad_size"));
        assert_eq!(check_tile(Some("text/html"), b"GIF89a"), Err("html"));
        assert_eq!(check_tile(Some("image/gif"), b"<html>"), Err("html"));
        assert_eq!(check_tile(Some("image/png"), &gif(256, 256)), Err("not_gif"));
        assert_eq!(check_tile(None, &gif(256, 256)), Err("not_gif"));
        assert_eq!(check_tile(Some("image/gif"), b"GIF89a\x00"), Err("not_gif"));
        assert_eq!(
            check_tile(Some("image/gif"), b"\x89PNG\r\n\x1a\n0000"),
            Err("not_gif")
        );
    }

    #[test]
    fn transparent_gif_is_a_gif() {
        assert!(TRANSPARENT_GIF.starts_with(b"GIF89a"));
        assert_eq!(*TRANSPARENT_GIF.last().unwrap(), 0x3b);
    }

    #[test]
    fn urls_paths_and_names() {
        let t = "http://127.0.0.1:9/map/{z}/{x}/{z}_{x}_{y}.gif";
        assert_eq!(
            tile_url(t, 14, 14530, 6540),
            "http://127.0.0.1:9/map/14/14530/14_14530_6540.gif"
        );
        let p = tile_path(std::path::Path::new("/data"), 9, 449, 205);
        assert_eq!(p, std::path::PathBuf::from("/data/lte/9/449/205.gif"));
        assert_eq!(parse_tile_name("205.gif"), Some(205));
        assert_eq!(parse_tile_name("205"), None);
        assert_eq!(parse_tile_name("-1.gif"), None);
        assert_eq!(parse_tile_name("../x.gif"), None);
        assert!(in_range(0, 0, 0) && in_range(14, 16383, 16383));
        assert!(!in_range(14, 16384, 0) && !in_range(14, 0, 16384));
        assert!(!in_range(TILE_ROUTE_MAX_ZOOM + 1, 0, 0));
    }
}
