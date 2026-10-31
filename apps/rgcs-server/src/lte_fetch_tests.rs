//! `lte_fetch` against the local fake (no internet).

use std::time::Duration;

use rgcs_core::LteStatus;
use rgcs_store::Store;

use crate::lte_fake::{LteFake, FAKE_LAST_MODIFIED_MS};
use crate::lte_fetch::{prune_tiles, run_area, LteFetcher};
use crate::lte_tiles::{tile_path, tiles, Rect};

fn scratch() -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("rgcs-lte-{}", uuid::Uuid::new_v4().simple()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn fetcher(fake: &LteFake, mode: &str) -> LteFetcher {
    LteFetcher::new(&fake.template(mode)).with_timing(Duration::from_millis(300), Duration::ZERO)
}

#[tokio::test]
async fn a_good_tile_is_stored_with_its_data_date() {
    let fake = LteFake::start().await;
    let dir = scratch();
    let got = fetcher(&fake, "ok").fetch_and_store(&dir, 9, 449, 205).await;
    assert_eq!(got, Ok(Some(FAKE_LAST_MODIFIED_MS)));
    let bytes = std::fs::read(tile_path(&dir, 9, 449, 205)).unwrap();
    assert!(bytes.starts_with(b"GIF89a"));
    let leftovers: Vec<_> = std::fs::read_dir(dir.join("lte/9/449")).unwrap().collect();
    assert_eq!(leftovers.len(), 1, "no temp file left behind");
}

#[tokio::test]
async fn bad_answers_get_short_codes_and_keep_the_cached_tile() {
    let fake = LteFake::start().await;
    let dir = scratch();
    fetcher(&fake, "ok").fetch_and_store(&dir, 9, 1, 2).await.unwrap();
    for (mode, code) in [
        ("html", "html"),
        ("missing", "http_404"),
        ("big", "bad_size"),
        ("huge", "too_large"),
        ("slow", "timeout"),
        ("redirect", "redirect"),
    ] {
        let got = fetcher(&fake, mode).fetch_and_store(&dir, 9, 1, 2).await;
        assert_eq!(got, Err(code.to_string()), "{mode}");
    }
    assert!(std::fs::read(tile_path(&dir, 9, 1, 2))
        .unwrap()
        .starts_with(b"GIF89a"));
    let closed = LteFetcher::new("http://127.0.0.1:1/{z}/{x}/{y}.gif");
    assert_eq!(
        closed.fetch_and_store(&dir, 9, 1, 2).await,
        Err("connect".to_string())
    );
}

#[tokio::test]
async fn at_most_two_requests_are_in_flight() {
    let fake = LteFake::start().await;
    let dir = scratch();
    let f = fetcher(&fake, "paced");
    let jobs = (0..8).map(|x| f.fetch_and_store(&dir, 10, x, 0));
    let results = futures::future::join_all(jobs).await;
    assert!(results.iter().all(Result::is_ok));
    assert_eq!(fake.hits(), 8);
    assert_eq!(fake.peak(), 2);
}

#[tokio::test]
async fn requests_are_spaced() {
    let fake = LteFake::start().await;
    let dir = scratch();
    let f =
        LteFetcher::new(&fake.template("ok")).with_timing(Duration::from_secs(1), Duration::from_millis(100));
    let t0 = std::time::Instant::now();
    let jobs = (0..4).map(|x| f.fetch_and_store(&dir, 10, x, 0));
    futures::future::join_all(jobs).await;
    assert!(t0.elapsed() >= Duration::from_millis(300), "{:?}", t0.elapsed());
}

/// A rectangle inside one tile at every zoom 8–14: 7 tiles.
const SMALL: Rect = Rect {
    south: 33.668,
    west: 135.904,
    north: 33.6683,
    east: 135.9042,
};

async fn run(mode: &str) -> (rgcs_core::LteArea, std::path::PathBuf) {
    let fake = LteFake::start().await;
    let store = Store::open_memory().await.unwrap();
    let dir = scratch();
    let r = SMALL;
    let area = store
        .create_lte_area("a", (r.south, r.west, r.north, r.east), 7)
        .await
        .unwrap();
    assert!(store.begin_lte_fetch(area.id, 7).await.unwrap());
    run_area(fetcher(&fake, mode), store.clone(), dir.clone(), area.id, r).await;
    (store.get_lte_area(area.id).await.unwrap().unwrap(), dir)
}

#[tokio::test]
async fn an_area_fetch_ends_ready_partial_or_failed() {
    let (ok, dir) = run("ok").await;
    assert_eq!(
        (ok.status, ok.tiles_ok, ok.tiles_failed),
        (LteStatus::Ready, 7, 0)
    );
    assert_eq!(ok.data_modified, Some(FAKE_LAST_MODIFIED_MS));
    assert!(ok.fetched_at.is_some() && ok.last_error.is_none());
    assert_eq!(cached(&dir).len(), 7);

    let (mixed, _) = run("mixed").await;
    assert_eq!(mixed.status, LteStatus::Partial);
    assert_eq!(mixed.tiles_ok + mixed.tiles_failed, 7);
    assert!(mixed.tiles_ok > 0 && mixed.tiles_failed > 0);
    assert_eq!(mixed.last_error.as_deref(), Some("http_404"));

    let (bad, _) = run("missing").await;
    assert_eq!(
        (bad.status, bad.tiles_ok, bad.tiles_failed),
        (LteStatus::Failed, 0, 7)
    );
    assert!(bad.data_modified.is_none());
}

/// Every cached tile file under `<dir>/lte`.
fn cached(dir: &std::path::Path) -> Vec<std::path::PathBuf> {
    fn walk(p: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
        for e in std::fs::read_dir(p).into_iter().flatten().flatten() {
            if e.path().is_dir() {
                walk(&e.path(), out);
            } else {
                out.push(e.path());
            }
        }
    }
    let mut out = Vec::new();
    walk(&dir.join("lte"), &mut out);
    out
}

#[tokio::test]
async fn pruning_keeps_tiles_another_area_covers() {
    let dir = scratch();
    // Two side-by-side rectangles that share tiles at the low zooms.
    let a = Rect {
        south: 33.60,
        west: 135.80,
        north: 33.65,
        east: 135.85,
    };
    let b = Rect {
        south: 33.60,
        west: 135.85,
        north: 33.65,
        east: 135.90,
    };
    for (z, x, y) in tiles(&a).chain(tiles(&b)) {
        let p = tile_path(&dir, z, x, y);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, b"GIF89a").unwrap();
    }
    let removed = prune_tiles(&dir, a, &[b]).await;
    assert!(removed > 0);
    for (z, x, y) in tiles(&b) {
        assert!(tile_path(&dir, z, x, y).exists(), "b keeps {z}/{x}/{y}");
    }
    let left = cached(&dir).len() as u64;
    assert_eq!(left, tiles(&b).count() as u64);
    // The last area takes its tiles with it.
    prune_tiles(&dir, b, &[]).await;
    assert!(cached(&dir).is_empty());
}
