//! Briefings: named sets of saved missions, each row with a colour and an optional vehicle.

use rgcs_core::{validate_briefing, Briefing, BriefingFull, BriefingRow, BriefingSummary};
use sqlx::{Row, Sqlite, Transaction};

use crate::{unix_ms, Result, Store, StoreError};

async fn write_rows(tx: &mut Transaction<'_, Sqlite>, id: i64, b: &Briefing) -> Result<()> {
    sqlx::query("DELETE FROM briefing_missions WHERE briefing_id = ?1")
        .bind(id)
        .execute(&mut **tx)
        .await?;
    for (pos, r) in b.rows.iter().enumerate() {
        sqlx::query(
            "INSERT INTO briefing_missions (briefing_id, position, mission_id, color, sysid) \
             VALUES (?1, ?2, ?3, ?4, ?5)",
        )
        .bind(id)
        .bind(pos as i64)
        .bind(r.mission_id)
        .bind(&r.color)
        .bind(r.sysid.map(i64::from))
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}

fn invalid(e: String) -> StoreError {
    StoreError::Invalid(format!("briefing: {e}"))
}

impl Store {
    pub async fn list_briefings(&self) -> Result<Vec<BriefingSummary>> {
        let rows = sqlx::query(
            "SELECT b.id, b.name, b.updated_at, \
             (SELECT COUNT(*) FROM briefing_missions m WHERE m.briefing_id = b.id) AS n \
             FROM briefings b ORDER BY b.updated_at DESC, b.id DESC",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .iter()
            .map(|r| BriefingSummary {
                id: r.get("id"),
                name: r.get("name"),
                mission_count: r.get::<i64, _>("n").max(0) as u32,
                updated_at: r.get::<i64, _>("updated_at").max(0) as u64,
            })
            .collect())
    }

    async fn read_briefing(&self, id: i64) -> Result<Option<Briefing>> {
        let Some(head) = sqlx::query("SELECT name, active_mission_id FROM briefings WHERE id = ?1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?
        else {
            return Ok(None);
        };
        let rows = sqlx::query(
            "SELECT mission_id, color, sysid FROM briefing_missions WHERE briefing_id = ?1 ORDER BY position",
        )
        .bind(id)
        .fetch_all(&self.pool)
        .await?;
        Ok(Some(Briefing {
            id: Some(id),
            name: head.get("name"),
            active_mission_id: head.get("active_mission_id"),
            rows: rows
                .iter()
                .map(|r| BriefingRow {
                    mission_id: r.get("mission_id"),
                    color: r.get("color"),
                    sysid: r.get::<Option<i64>, _>("sysid").map(|s| s as rgcs_core::SysId),
                })
                .collect(),
        }))
    }

    pub async fn get_briefing(&self, id: i64) -> Result<Option<BriefingFull>> {
        let Some(briefing) = self.read_briefing(id).await? else {
            return Ok(None);
        };
        let mut missions = Vec::with_capacity(briefing.rows.len());
        for r in &briefing.rows {
            missions.push(self.get_mission(r.mission_id).await?);
        }
        Ok(Some(BriefingFull { briefing, missions }))
    }

    pub async fn create_briefing(&self, b: &Briefing, created_by: &str) -> Result<Briefing> {
        validate_briefing(b).map_err(invalid)?;
        let now = unix_ms() as i64;
        let mut tx = self.pool.begin().await?;
        let id = sqlx::query(
            "INSERT INTO briefings (name, active_mission_id, created_by, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?4)",
        )
        .bind(&b.name)
        .bind(b.active_mission_id)
        .bind(created_by)
        .bind(now)
        .execute(&mut *tx)
        .await?
        .last_insert_rowid();
        write_rows(&mut tx, id, b).await?;
        tx.commit().await?;
        Ok(Briefing {
            id: Some(id),
            ..b.clone()
        })
    }

    pub async fn update_briefing(&self, id: i64, b: &Briefing) -> Result<Option<Briefing>> {
        validate_briefing(b).map_err(invalid)?;
        let mut tx = self.pool.begin().await?;
        let changed = sqlx::query(
            "UPDATE briefings SET name = ?1, active_mission_id = ?2, updated_at = ?3 WHERE id = ?4",
        )
        .bind(&b.name)
        .bind(b.active_mission_id)
        .bind(unix_ms() as i64)
        .bind(id)
        .execute(&mut *tx)
        .await?
        .rows_affected();
        if changed == 0 {
            return Ok(None);
        }
        write_rows(&mut tx, id, b).await?;
        tx.commit().await?;
        Ok(Some(Briefing {
            id: Some(id),
            ..b.clone()
        }))
    }

    pub async fn delete_briefing(&self, id: i64) -> Result<bool> {
        let changed = sqlx::query("DELETE FROM briefings WHERE id = ?1")
            .bind(id)
            .execute(&self.pool)
            .await?
            .rows_affected();
        Ok(changed > 0)
    }
}

#[cfg(test)]
mod tests {
    use rgcs_core::{demo20, Briefing, BriefingRow};

    use crate::Store;

    fn row(mission_id: i64, color: &str, sysid: Option<u8>) -> BriefingRow {
        BriefingRow {
            mission_id,
            color: color.into(),
            sysid,
        }
    }

    async fn two_missions(s: &Store) -> (i64, i64) {
        let m1 = s.create_mission(&demo20(), "admin").await.unwrap().id.unwrap();
        let m2 = s.create_mission(&demo20(), "admin").await.unwrap().id.unwrap();
        (m1, m2)
    }

    #[tokio::test]
    async fn briefing_round_trip_keeps_order_colours_and_assignments() {
        let s = Store::open_memory().await.unwrap();
        let (m1, m2) = two_missions(&s).await;
        let rows = vec![row(m2, "#ff0000", Some(3)), row(m1, "#00ff00", None)];
        let b = Briefing {
            id: None,
            name: "morning".into(),
            active_mission_id: Some(m1),
            rows: rows.clone(),
        };
        let created = s.create_briefing(&b, "admin").await.unwrap();
        let id = created.id.expect("id");
        let full = s.get_briefing(id).await.unwrap().expect("exists");
        assert_eq!(full.briefing.rows, rows);
        assert_eq!(full.briefing.active_mission_id, Some(m1));
        assert_eq!(full.missions.len(), 2);
        assert_eq!(full.missions[0].as_ref().and_then(|m| m.id), Some(m2));
        assert_eq!(full.missions[1].as_ref().and_then(|m| m.id), Some(m1));
        assert_eq!(s.list_briefings().await.unwrap()[0].mission_count, 2);

        let one = Briefing {
            rows: vec![row(m1, "#0000ff", None)],
            ..created
        };
        assert!(s.update_briefing(id, &one).await.unwrap().is_some());
        assert_eq!(s.get_briefing(id).await.unwrap().unwrap().briefing.rows, one.rows);
        assert_eq!(s.list_briefings().await.unwrap()[0].mission_count, 1);
        assert!(s.update_briefing(99, &one).await.unwrap().is_none());
        assert!(s.delete_briefing(id).await.unwrap());
        assert!(!s.delete_briefing(id).await.unwrap());
        assert!(s.get_briefing(id).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn a_deleted_mission_reads_back_as_none() {
        let s = Store::open_memory().await.unwrap();
        let (m1, m2) = two_missions(&s).await;
        let b = Briefing {
            id: None,
            name: "b".into(),
            active_mission_id: None,
            rows: vec![row(m2, "#ff0000", None), row(m1, "#00ff00", None)],
        };
        let id = s.create_briefing(&b, "admin").await.unwrap().id.unwrap();
        assert!(s.delete_mission(m1).await.unwrap());
        let full = s.get_briefing(id).await.unwrap().unwrap();
        assert_eq!(full.briefing.rows.len(), 2);
        assert!(full.missions[0].is_some());
        assert!(full.missions[1].is_none());
    }
}
