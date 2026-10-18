//! `app_settings` (migration 0001): small key → value application settings (spec 50 §2.4).

use sqlx::Row;

use crate::{Result, Store};

/// Key of the 地図表示 › ジンバルを地面に投影 switch (spec 10 §7).
pub const GIMBAL_GROUND_PROJECTION: &str = "map.gimbal_ground_projection";

impl Store {
    pub async fn app_setting(&self, key: &str) -> Result<Option<String>> {
        let row = sqlx::query("SELECT value FROM app_settings WHERE key = ?1")
            .bind(key)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.map(|r| r.get("value")))
    }

    pub async fn put_app_setting(&self, key: &str, value: &str) -> Result<()> {
        sqlx::query("INSERT INTO app_settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
            .bind(key)
            .bind(value)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use crate::Store;

    #[tokio::test]
    async fn app_setting_round_trips_and_survives_a_reopen() {
        let dir = std::env::temp_dir().join(format!("rgcs-app-{}", uuid::Uuid::new_v4().simple()));
        let path = dir.join("rgcs.db");
        {
            let s = Store::open(&path).await.unwrap();
            assert_eq!(s.app_setting("map.gimbal_ground_projection").await.unwrap(), None);
            s.put_app_setting("map.gimbal_ground_projection", "true")
                .await
                .unwrap();
            s.put_app_setting("map.gimbal_ground_projection", "false")
                .await
                .unwrap();
            s.put_app_setting("map.gimbal_ground_projection", "true")
                .await
                .unwrap();
        }
        let s = Store::open(&path).await.unwrap();
        assert_eq!(
            s.app_setting("map.gimbal_ground_projection")
                .await
                .unwrap()
                .as_deref(),
            Some("true")
        );
        let _ = std::fs::remove_dir_all(dir);
    }
}
