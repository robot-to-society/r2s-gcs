//! `lte_areas`: the rectangles whose docomo LTE tiles the server fetched (LTE overlay design).

use rgcs_core::{LteArea, LteStatus};
use sqlx::Row;

use crate::{unix_ms, Result, Store};

/// `(south, west, north, east)` in degrees.
pub type Rect = (f64, f64, f64, f64);

fn opt_ms(r: &sqlx::sqlite::SqliteRow, col: &str) -> Option<u64> {
    r.get::<Option<i64>, _>(col).map(|v| v.max(0) as u64)
}

fn count(r: &sqlx::sqlite::SqliteRow, col: &str) -> u64 {
    r.get::<i64, _>(col).max(0) as u64
}

fn row_to_area(r: &sqlx::sqlite::SqliteRow) -> LteArea {
    LteArea {
        id: r.get("id"),
        name: r.get("name"),
        south: r.get("south"),
        west: r.get("west"),
        north: r.get("north"),
        east: r.get("east"),
        status: LteStatus::parse(&r.get::<String, _>("status")),
        tiles_total: count(r, "tiles_total"),
        tiles_ok: count(r, "tiles_ok"),
        tiles_failed: count(r, "tiles_failed"),
        fetched_at: opt_ms(r, "fetched_at"),
        data_modified: opt_ms(r, "data_modified"),
        last_error: r.get("last_error"),
        created_at: count(r, "created_at"),
    }
}

impl Store {
    /// Every area, oldest first.
    pub async fn list_lte_areas(&self) -> Result<Vec<LteArea>> {
        let rows = sqlx::query("SELECT * FROM lte_areas ORDER BY id")
            .fetch_all(&self.pool)
            .await?;
        Ok(rows.iter().map(row_to_area).collect())
    }

    pub async fn get_lte_area(&self, id: i64) -> Result<Option<LteArea>> {
        let row = sqlx::query("SELECT * FROM lte_areas WHERE id = ?1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.as_ref().map(row_to_area))
    }

    /// A new `idle` area (the caller validated the rectangle and counted its tiles).
    pub async fn create_lte_area(&self, name: &str, rect: Rect, tiles_total: u64) -> Result<LteArea> {
        let (south, west, north, east) = rect;
        let id: i64 = sqlx::query_scalar(
            "INSERT INTO lte_areas (name, south, west, north, east, tiles_total, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) RETURNING id",
        )
        .bind(name)
        .bind(south)
        .bind(west)
        .bind(north)
        .bind(east)
        .bind(tiles_total as i64)
        .bind(unix_ms() as i64)
        .fetch_one(&self.pool)
        .await?;
        Ok(self.get_lte_area(id).await?.expect("row just inserted"))
    }

    /// Claims the area for a fetch: `false` when it is already fetching or does not exist.
    /// Counters and the error start over; the data date is kept.
    pub async fn begin_lte_fetch(&self, id: i64, tiles_total: u64) -> Result<bool> {
        let done = sqlx::query(
            "UPDATE lte_areas SET status = 'fetching', tiles_total = ?2, tiles_ok = 0, \
             tiles_failed = 0, last_error = NULL WHERE id = ?1 AND status != 'fetching'",
        )
        .bind(id)
        .bind(tiles_total as i64)
        .execute(&self.pool)
        .await?;
        Ok(done.rows_affected() == 1)
    }

    /// Progress of a running fetch: counters, the newest data date, the latest error code.
    pub async fn lte_progress(
        &self,
        id: i64,
        ok: u64,
        failed: u64,
        data_modified: Option<u64>,
        last_error: Option<&str>,
    ) -> Result<()> {
        sqlx::query(
            "UPDATE lte_areas SET tiles_ok = ?2, tiles_failed = ?3, \
             data_modified = CASE WHEN ?4 IS NULL THEN data_modified \
               WHEN data_modified IS NULL OR ?4 > data_modified THEN ?4 ELSE data_modified END, \
             last_error = COALESCE(?5, last_error) WHERE id = ?1",
        )
        .bind(id)
        .bind(ok as i64)
        .bind(failed as i64)
        .bind(data_modified.map(|v| v as i64))
        .bind(last_error)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn finish_lte_fetch(&self, id: i64, status: LteStatus, fetched_at: u64) -> Result<()> {
        sqlx::query("UPDATE lte_areas SET status = ?2, fetched_at = ?3 WHERE id = ?1")
            .bind(id)
            .bind(status.as_str())
            .bind(fetched_at as i64)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// Removes an area that is not fetching; `false` when none was removed.
    pub async fn delete_lte_area(&self, id: i64) -> Result<bool> {
        let done = sqlx::query("DELETE FROM lte_areas WHERE id = ?1 AND status != 'fetching'")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(done.rows_affected() == 1)
    }

    /// Boot: a row still `fetching` was cut off by a restart. It becomes `partial` when some
    /// tiles arrived, `idle` otherwise, with `last_error = "interrupted"`. Returns the count.
    pub async fn reset_interrupted_lte_fetches(&self) -> Result<u64> {
        let done = sqlx::query(
            "UPDATE lte_areas SET status = CASE WHEN tiles_ok > 0 THEN 'partial' ELSE 'idle' END, \
             last_error = 'interrupted' WHERE status = 'fetching'",
        )
        .execute(&self.pool)
        .await?;
        Ok(done.rows_affected())
    }
}

#[cfg(test)]
mod tests {
    use rgcs_core::LteStatus;

    use crate::Store;

    const RECT: (f64, f64, f64, f64) = (33.6, 135.85, 33.7, 135.95);

    #[tokio::test]
    async fn create_list_get_delete() {
        let s = Store::open_memory().await.unwrap();
        assert!(s.list_lte_areas().await.unwrap().is_empty());
        let a = s.create_lte_area("那智勝浦", RECT, 120).await.unwrap();
        assert_eq!(
            (a.name.as_str(), a.status, a.tiles_total),
            ("那智勝浦", LteStatus::Idle, 120)
        );
        assert_eq!((a.south, a.west, a.north, a.east), RECT);
        assert!(a.created_at > 1_700_000_000_000);
        assert!(a.fetched_at.is_none() && a.data_modified.is_none() && a.last_error.is_none());
        s.create_lte_area("b", RECT, 5).await.unwrap();
        let ids: Vec<_> = s.list_lte_areas().await.unwrap().iter().map(|a| a.id).collect();
        assert_eq!(ids, vec![a.id, a.id + 1]);
        assert_eq!(s.get_lte_area(a.id).await.unwrap(), Some(a.clone()));
        assert!(s.delete_lte_area(a.id).await.unwrap());
        assert!(!s.delete_lte_area(a.id).await.unwrap());
        assert_eq!(s.get_lte_area(a.id).await.unwrap(), None);
    }

    #[tokio::test]
    async fn fetch_lifecycle_and_busy_rules() {
        let s = Store::open_memory().await.unwrap();
        let a = s.create_lte_area("a", RECT, 100).await.unwrap();
        assert!(s.begin_lte_fetch(a.id, 100).await.unwrap());
        assert!(
            !s.begin_lte_fetch(a.id, 100).await.unwrap(),
            "busy while fetching"
        );
        assert!(!s.begin_lte_fetch(999, 1).await.unwrap(), "unknown id");
        assert!(
            !s.delete_lte_area(a.id).await.unwrap(),
            "no delete while fetching"
        );
        s.lte_progress(a.id, 10, 1, Some(2_000), Some("http_404"))
            .await
            .unwrap();
        s.lte_progress(a.id, 20, 1, Some(1_000), None).await.unwrap();
        let mid = s.get_lte_area(a.id).await.unwrap().unwrap();
        assert_eq!(
            (mid.status, mid.tiles_ok, mid.tiles_failed),
            (LteStatus::Fetching, 20, 1)
        );
        assert_eq!(mid.data_modified, Some(2_000), "keeps the newest date");
        assert_eq!(mid.last_error.as_deref(), Some("http_404"));
        s.finish_lte_fetch(a.id, LteStatus::Partial, 5_000).await.unwrap();
        let done = s.get_lte_area(a.id).await.unwrap().unwrap();
        assert_eq!((done.status, done.fetched_at), (LteStatus::Partial, Some(5_000)));
        // A refresh starts over but keeps the data date.
        assert!(s.begin_lte_fetch(a.id, 100).await.unwrap());
        let again = s.get_lte_area(a.id).await.unwrap().unwrap();
        assert_eq!(
            (again.tiles_ok, again.tiles_failed, again.last_error),
            (0, 0, None)
        );
        assert_eq!(again.data_modified, Some(2_000));
    }

    #[tokio::test]
    async fn interrupted_fetches_are_reset_on_boot() {
        let s = Store::open_memory().await.unwrap();
        let none = s.create_lte_area("none", RECT, 10).await.unwrap();
        let some = s.create_lte_area("some", RECT, 10).await.unwrap();
        let done = s.create_lte_area("done", RECT, 10).await.unwrap();
        for a in [&none, &some, &done] {
            s.begin_lte_fetch(a.id, 10).await.unwrap();
        }
        s.lte_progress(some.id, 3, 0, None, None).await.unwrap();
        s.finish_lte_fetch(done.id, LteStatus::Ready, 1).await.unwrap();
        assert_eq!(s.reset_interrupted_lte_fetches().await.unwrap(), 2);
        let status = |id| {
            let s = s.clone();
            async move { s.get_lte_area(id).await.unwrap().unwrap() }
        };
        let n = status(none.id).await;
        assert_eq!(
            (n.status, n.last_error.as_deref()),
            (LteStatus::Idle, Some("interrupted"))
        );
        assert_eq!(status(some.id).await.status, LteStatus::Partial);
        assert_eq!(status(done.id).await.status, LteStatus::Ready);
    }
}
