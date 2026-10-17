//! `missions` (spec 60 §3.8): saved mission plans; items and home are JSON of the core types.

use rgcs_core::{Home, Mission, MissionFrame, MissionItem, MissionSummaryRow, SysId};
use sqlx::Row;

use crate::{Result, Store, StoreError};

fn frame_str(f: MissionFrame) -> &'static str {
    match f {
        MissionFrame::Rel => "rel",
        MissionFrame::Abs => "abs",
        MissionFrame::Ter => "ter",
    }
}

fn parse_frame(s: &str) -> MissionFrame {
    match s {
        "abs" => MissionFrame::Abs,
        "ter" => MissionFrame::Ter,
        _ => MissionFrame::Rel,
    }
}

fn unix_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn json_err(e: serde_json::Error) -> StoreError {
    StoreError::Invalid(format!("mission json: {e}"))
}

fn row_to_mission(r: &sqlx::sqlite::SqliteRow) -> Result<Mission> {
    let items: Vec<MissionItem> = serde_json::from_str(&r.get::<String, _>("items")).map_err(json_err)?;
    let home: Option<Home> = match r.get::<Option<String>, _>("home") {
        Some(h) => Some(serde_json::from_str(&h).map_err(json_err)?),
        None => None,
    };
    Ok(Mission {
        id: Some(r.get::<i64, _>("id")),
        name: r.get("name"),
        sysid: r.get::<Option<i64>, _>("sysid").map(|v| v as SysId),
        default_alt: r.get::<f64, _>("default_alt") as f32,
        default_frame: parse_frame(&r.get::<String, _>("default_frame")),
        speed: r.get::<f64, _>("speed") as f32,
        home,
        items,
    })
}

impl Store {
    pub async fn list_missions(&self) -> Result<Vec<MissionSummaryRow>> {
        let rows = sqlx::query(
            "SELECT id, name, sysid, items, updated_at FROM missions ORDER BY updated_at DESC, id DESC",
        )
        .fetch_all(&self.pool)
        .await?;
        rows.iter()
            .map(|r| {
                let items: Vec<MissionItem> =
                    serde_json::from_str(&r.get::<String, _>("items")).map_err(json_err)?;
                Ok(MissionSummaryRow {
                    id: r.get("id"),
                    name: r.get("name"),
                    sysid: r.get::<Option<i64>, _>("sysid").map(|v| v as SysId),
                    item_count: items.len() as u32,
                    updated_at: r.get::<i64, _>("updated_at") as u64,
                })
            })
            .collect()
    }

    pub async fn get_mission(&self, id: i64) -> Result<Option<Mission>> {
        let row = sqlx::query("SELECT * FROM missions WHERE id = ?1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;
        row.as_ref().map(row_to_mission).transpose()
    }

    /// Inserts and returns the mission with its new id.
    pub async fn create_mission(&self, m: &Mission, created_by: &str) -> Result<Mission> {
        let now = unix_ms();
        let home = m
            .home
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(json_err)?;
        let items = serde_json::to_string(&m.items).map_err(json_err)?;
        let id = sqlx::query(
            "INSERT INTO missions (name, sysid, default_alt, default_frame, speed, home, items, created_by, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
        )
        .bind(&m.name)
        .bind(m.sysid.map(i64::from))
        .bind(m.default_alt as f64)
        .bind(frame_str(m.default_frame))
        .bind(m.speed as f64)
        .bind(home)
        .bind(items)
        .bind(created_by)
        .bind(now)
        .execute(&self.pool)
        .await?
        .last_insert_rowid();
        Ok(Mission {
            id: Some(id),
            ..m.clone()
        })
    }

    /// `None` when no mission has this id.
    pub async fn update_mission(&self, id: i64, m: &Mission) -> Result<Option<Mission>> {
        let home = m
            .home
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(json_err)?;
        let items = serde_json::to_string(&m.items).map_err(json_err)?;
        let changed = sqlx::query(
            "UPDATE missions SET name = ?2, sysid = ?3, default_alt = ?4, default_frame = ?5, speed = ?6, home = ?7, items = ?8, updated_at = ?9 \
             WHERE id = ?1",
        )
        .bind(id)
        .bind(&m.name)
        .bind(m.sysid.map(i64::from))
        .bind(m.default_alt as f64)
        .bind(frame_str(m.default_frame))
        .bind(m.speed as f64)
        .bind(home)
        .bind(items)
        .bind(unix_ms())
        .execute(&self.pool)
        .await?
        .rows_affected();
        if changed == 0 {
            return Ok(None);
        }
        Ok(Some(Mission {
            id: Some(id),
            ..m.clone()
        }))
    }

    pub async fn delete_mission(&self, id: i64) -> Result<bool> {
        let changed = sqlx::query("DELETE FROM missions WHERE id = ?1")
            .bind(id)
            .execute(&self.pool)
            .await?
            .rows_affected();
        Ok(changed > 0)
    }
}

#[cfg(test)]
mod tests {
    use rgcs_core::{demo20, MissionFrame};

    use crate::Store;

    #[tokio::test]
    async fn create_list_get_update_delete_round_trip() {
        let s = Store::open_memory().await.unwrap();
        assert!(s.list_missions().await.unwrap().is_empty());
        let created = s.create_mission(&demo20(), "admin").await.unwrap();
        assert_eq!(created.id, Some(1));
        assert_eq!(created.items.len(), 20);
        let rows = s.list_missions().await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(
            (rows[0].id, rows[0].item_count, rows[0].name.as_str()),
            (1, 20, "demo20")
        );
        assert!(rows[0].updated_at > 1_700_000_000_000);
        let mut renamed = created.clone();
        renamed.name = "renamed".into();
        renamed.default_frame = MissionFrame::Abs;
        let updated = s.update_mission(1, &renamed).await.unwrap().expect("exists");
        assert_eq!(updated.name, "renamed");
        let got = s.get_mission(1).await.unwrap().expect("exists");
        assert_eq!(got.default_frame, MissionFrame::Abs);
        assert_eq!(got.home, demo20().home);
        assert!(s.update_mission(99, &renamed).await.unwrap().is_none());
        assert!(s.delete_mission(1).await.unwrap());
        assert!(!s.delete_mission(1).await.unwrap());
        assert!(s.get_mission(1).await.unwrap().is_none());
    }
}
