//! Flights (様式 1 rows) with squawks, minute totals and append-only corrections.
//! `takeoff_at` / `landed_at` are unix ms; a flight is open while `landed_at IS NULL`.

use rgcs_core::jst;
use rgcs_core::{Flight, FlightInput, FlightPatch, FlightSquawk, FlightSquawkInput, FlightStatus, SysId};
use sqlx::Row;

use crate::{unix_ms, Result, Store, StoreError};

/// Raw column values of one `flights` row (what a patch rewrites).
#[derive(Debug, Clone)]
struct Cols {
    sysid: SysId,
    status: FlightStatus,
    pilot: String,
    pilot_license: String,
    takeoff_at: u64,
    landed_at: Option<u64>,
    takeoff_lat: Option<f64>,
    takeoff_lon: Option<f64>,
    landing_lat: Option<f64>,
    landing_lon: Option<f64>,
    takeoff_place: String,
    landing_place: String,
    purposes: Vec<String>,
    specific_flight: Vec<String>,
    summary: String,
    safety_notes: String,
    supersedes: Option<i64>,
    created_by: String,
    created_at: u64,
}

fn json_list(s: &str) -> Vec<String> {
    serde_json::from_str(s).unwrap_or_default()
}

fn to_json(v: &[String]) -> String {
    serde_json::to_string(v).unwrap_or_else(|_| "[]".into())
}

fn ms(v: i64) -> u64 {
    v.max(0) as u64
}

fn cols_of(r: &sqlx::sqlite::SqliteRow) -> Cols {
    Cols {
        sysid: r.get::<i64, _>("sysid") as SysId,
        status: if r.get::<String, _>("status") == "confirmed" {
            FlightStatus::Confirmed
        } else {
            FlightStatus::Draft
        },
        pilot: r.get("pilot"),
        pilot_license: r.get("pilot_license"),
        takeoff_at: ms(r.get("takeoff_at")),
        landed_at: r.get::<Option<i64>, _>("landed_at").map(ms),
        takeoff_lat: r.get("takeoff_lat"),
        takeoff_lon: r.get("takeoff_lon"),
        landing_lat: r.get("landing_lat"),
        landing_lon: r.get("landing_lon"),
        takeoff_place: r.get("takeoff_place"),
        landing_place: r.get("landing_place"),
        purposes: json_list(&r.get::<String, _>("purposes")),
        specific_flight: json_list(&r.get::<String, _>("specific_flight")),
        summary: r.get("summary"),
        safety_notes: r.get("safety_notes"),
        supersedes: r.get("supersedes"),
        created_by: r.get("created_by"),
        created_at: ms(r.get("created_at")),
    }
}

fn apply_patch(c: &Cols, p: &FlightPatch) -> Cols {
    Cols {
        pilot: p.pilot.clone().unwrap_or_else(|| c.pilot.clone()),
        pilot_license: p.pilot_license.clone().unwrap_or_else(|| c.pilot_license.clone()),
        takeoff_at: p.takeoff_at.unwrap_or(c.takeoff_at),
        landed_at: p.landed_at.or(c.landed_at),
        takeoff_place: p.takeoff_place.clone().unwrap_or_else(|| c.takeoff_place.clone()),
        landing_place: p.landing_place.clone().unwrap_or_else(|| c.landing_place.clone()),
        purposes: p.purposes.clone().unwrap_or_else(|| c.purposes.clone()),
        specific_flight: p
            .specific_flight
            .clone()
            .unwrap_or_else(|| c.specific_flight.clone()),
        summary: p.summary.clone().unwrap_or_else(|| c.summary.clone()),
        safety_notes: p.safety_notes.clone().unwrap_or_else(|| c.safety_notes.clone()),
        status: p.status.unwrap_or(c.status),
        ..c.clone()
    }
}

fn check_times(takeoff: u64, landed: Option<u64>) -> Result<()> {
    match landed {
        Some(l) if l < takeoff => Err(StoreError::Invalid("landed_at before takeoff_at".into())),
        _ => Ok(()),
    }
}

/// Minutes of every landed, non-superseded flight of a vehicle: `(landed_at, minutes)`.
type Landed = Vec<(u64, u32)>;

fn total_for(initial: u32, landed: &Landed, upto: Option<u64>) -> u32 {
    landed
        .iter()
        .filter(|(at, _)| upto.is_none_or(|u| *at <= u))
        .fold(initial, |acc, (_, m)| acc.saturating_add(*m))
}

fn build(id: i64, c: Cols, initial: u32, landed: &Landed, squawks: Vec<FlightSquawk>) -> Flight {
    let flight_minutes = c
        .landed_at
        .map(|l| jst::ceil_minutes(c.takeoff_at, l))
        .unwrap_or(0);
    Flight {
        id,
        sysid: c.sysid,
        status: c.status,
        pilot: c.pilot,
        pilot_license: c.pilot_license,
        takeoff_at: c.takeoff_at,
        landed_at: c.landed_at,
        takeoff_lat: c.takeoff_lat,
        takeoff_lon: c.takeoff_lon,
        landing_lat: c.landing_lat,
        landing_lon: c.landing_lon,
        takeoff_place: c.takeoff_place,
        landing_place: c.landing_place,
        purposes: c.purposes,
        specific_flight: c.specific_flight,
        summary: c.summary,
        safety_notes: c.safety_notes,
        flight_minutes,
        total_minutes: total_for(initial, landed, c.landed_at),
        squawks,
        supersedes: c.supersedes,
        created_by: c.created_by,
        created_at: c.created_at,
        updated_at: 0,
    }
}

fn squawk_of(r: &sqlx::sqlite::SqliteRow) -> FlightSquawk {
    FlightSquawk {
        id: r.get("id"),
        flight_id: r.get("flight_id"),
        occurred_on: r.get("occurred_on"),
        description: r.get("description"),
        action_on: r.get("action_on"),
        action: r.get("action"),
        confirmer: r.get("confirmer"),
        created_by: r.get("created_by"),
        created_at: ms(r.get("created_at")),
    }
}

impl Store {
    async fn insert_cols(&self, c: &Cols) -> Result<i64> {
        let now = unix_ms() as i64;
        let res = sqlx::query(
            "INSERT INTO flights (sysid, status, pilot, pilot_license, takeoff_at, landed_at, takeoff_lat, takeoff_lon, \
             landing_lat, landing_lon, takeoff_place, landing_place, purposes, specific_flight, summary, safety_notes, \
             supersedes, created_by, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?19)",
        )
        .bind(i64::from(c.sysid))
        .bind(c.status.as_str())
        .bind(&c.pilot)
        .bind(&c.pilot_license)
        .bind(c.takeoff_at as i64)
        .bind(c.landed_at.map(|v| v as i64))
        .bind(c.takeoff_lat)
        .bind(c.takeoff_lon)
        .bind(c.landing_lat)
        .bind(c.landing_lon)
        .bind(&c.takeoff_place)
        .bind(&c.landing_place)
        .bind(to_json(&c.purposes))
        .bind(to_json(&c.specific_flight))
        .bind(&c.summary)
        .bind(&c.safety_notes)
        .bind(c.supersedes)
        .bind(&c.created_by)
        .bind(now)
        .execute(&self.pool)
        .await?;
        Ok(res.last_insert_rowid())
    }

    async fn update_cols(&self, id: i64, c: &Cols) -> Result<()> {
        sqlx::query(
            "UPDATE flights SET status = ?2, pilot = ?3, pilot_license = ?4, takeoff_at = ?5, landed_at = ?6, \
             takeoff_place = ?7, landing_place = ?8, purposes = ?9, specific_flight = ?10, summary = ?11, \
             safety_notes = ?12, updated_at = ?13 WHERE id = ?1",
        )
        .bind(id)
        .bind(c.status.as_str())
        .bind(&c.pilot)
        .bind(&c.pilot_license)
        .bind(c.takeoff_at as i64)
        .bind(c.landed_at.map(|v| v as i64))
        .bind(&c.takeoff_place)
        .bind(&c.landing_place)
        .bind(to_json(&c.purposes))
        .bind(to_json(&c.specific_flight))
        .bind(&c.summary)
        .bind(&c.safety_notes)
        .bind(unix_ms() as i64)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn cols(&self, id: i64) -> Result<Option<Cols>> {
        let row = sqlx::query("SELECT * FROM flights WHERE id = ?1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.as_ref().map(cols_of))
    }

    async fn landed(&self, sysid: SysId) -> Result<Landed> {
        let rows = sqlx::query(
            "SELECT takeoff_at, landed_at FROM flights WHERE sysid = ?1 AND landed_at IS NOT NULL \
             AND id NOT IN (SELECT supersedes FROM flights WHERE supersedes IS NOT NULL)",
        )
        .bind(i64::from(sysid))
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .iter()
            .map(|r| {
                let l = ms(r.get("landed_at"));
                (l, jst::ceil_minutes(ms(r.get("takeoff_at")), l))
            })
            .collect())
    }

    async fn squawks_of(&self, sysid: SysId) -> Result<Vec<FlightSquawk>> {
        let rows = sqlx::query(
            "SELECT s.* FROM flight_squawks s JOIN flights f ON f.id = s.flight_id WHERE f.sysid = ?1 ORDER BY s.id",
        )
        .bind(i64::from(sysid))
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.iter().map(squawk_of).collect())
    }

    async fn assemble(&self, id: i64, c: Cols) -> Result<Flight> {
        let initial = self.initial_flight_minutes(c.sysid).await?;
        let landed = self.landed(c.sysid).await?;
        let squawks: Vec<FlightSquawk> = self
            .squawks_of(c.sysid)
            .await?
            .into_iter()
            .filter(|s| s.flight_id == id)
            .collect();
        Ok(build(id, c, initial, &landed, squawks))
    }

    /// Opens a draft at the first ARM; returns its id.
    #[allow(clippy::too_many_arguments)]
    pub async fn open_flight(
        &self,
        sysid: SysId,
        pilot: &str,
        pilot_license: &str,
        takeoff_at: u64,
        lat: Option<f64>,
        lon: Option<f64>,
        by: &str,
    ) -> Result<i64> {
        self.insert_cols(&Cols {
            sysid,
            status: FlightStatus::Draft,
            pilot: pilot.into(),
            pilot_license: pilot_license.into(),
            takeoff_at,
            landed_at: None,
            takeoff_lat: lat,
            takeoff_lon: lon,
            landing_lat: None,
            landing_lon: None,
            takeoff_place: String::new(),
            landing_place: String::new(),
            purposes: vec![],
            specific_flight: vec![],
            summary: String::new(),
            safety_notes: String::new(),
            supersedes: None,
            created_by: by.into(),
            created_at: 0,
        })
        .await
    }

    /// A re-ARM inside the window continues the flight: the landing is cleared. False when the
    /// row is no longer a draft (confirmed records are immutable) or does not exist.
    pub async fn reopen_flight(&self, id: i64) -> Result<bool> {
        let res = sqlx::query(
            "UPDATE flights SET landed_at = NULL, landing_lat = NULL, landing_lon = NULL, updated_at = ?2 \
             WHERE id = ?1 AND status = 'draft'",
        )
        .bind(id)
        .bind(unix_ms() as i64)
        .execute(&self.pool)
        .await?;
        Ok(res.rows_affected() == 1)
    }

    /// The id of the row that corrected `id`, if any.
    pub async fn flight_superseded_by(&self, id: i64) -> Result<Option<i64>> {
        let v: Option<i64> =
            sqlx::query_scalar("SELECT id FROM flights WHERE supersedes = ?1 ORDER BY id DESC LIMIT 1")
                .bind(id)
                .fetch_optional(&self.pool)
                .await?;
        Ok(v)
    }

    pub async fn land_flight(
        &self,
        id: i64,
        landed_at: u64,
        lat: Option<f64>,
        lon: Option<f64>,
    ) -> Result<()> {
        sqlx::query(
            "UPDATE flights SET landed_at = ?2, landing_lat = ?3, landing_lon = ?4, updated_at = ?5 WHERE id = ?1",
        )
        .bind(id)
        .bind(landed_at as i64)
        .bind(lat)
        .bind(lon)
        .bind(unix_ms() as i64)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// The flight still in the air for `sysid` (`landed_at IS NULL`), newest first.
    pub async fn open_flight_of(&self, sysid: SysId) -> Result<Option<Flight>> {
        let row = sqlx::query(
            "SELECT id FROM flights WHERE sysid = ?1 AND landed_at IS NULL ORDER BY id DESC LIMIT 1",
        )
        .bind(i64::from(sysid))
        .fetch_optional(&self.pool)
        .await?;
        match row {
            Some(r) => self.flight(r.get("id")).await,
            None => Ok(None),
        }
    }

    pub async fn flight(&self, id: i64) -> Result<Option<Flight>> {
        match self.cols(id).await? {
            Some(c) => Ok(Some(self.assemble(id, c).await?)),
            None => Ok(None),
        }
    }

    /// Non-superseded flights of one vehicle, ascending takeoff, within JST days when given.
    pub async fn list_flights(
        &self,
        sysid: SysId,
        from: Option<&str>,
        to: Option<&str>,
    ) -> Result<Vec<Flight>> {
        let (lo, hi) = jst::day_range_ms(from.unwrap_or("1970-01-01"), to.unwrap_or("9999-12-30"))
            .ok_or_else(|| StoreError::Invalid("date range".into()))?;
        let rows = sqlx::query(
            "SELECT * FROM flights WHERE sysid = ?1 AND takeoff_at >= ?2 AND takeoff_at < ?3 \
             AND id NOT IN (SELECT supersedes FROM flights WHERE supersedes IS NOT NULL) ORDER BY takeoff_at, id",
        )
        .bind(i64::from(sysid))
        .bind(lo as i64)
        .bind(hi as i64)
        .fetch_all(&self.pool)
        .await?;
        let initial = self.initial_flight_minutes(sysid).await?;
        let landed = self.landed(sysid).await?;
        let squawks = self.squawks_of(sysid).await?;
        Ok(rows
            .iter()
            .map(|r| {
                let id: i64 = r.get("id");
                let own = squawks.iter().filter(|s| s.flight_id == id).cloned().collect();
                build(id, cols_of(r), initial, &landed, own)
            })
            .collect())
    }

    /// A flight flown without RGCS connected (draft).
    pub async fn create_flight(&self, sysid: SysId, input: &FlightInput, by: &str) -> Result<Flight> {
        check_times(input.takeoff_at, Some(input.landed_at))?;
        let id = self
            .insert_cols(&Cols {
                sysid,
                status: FlightStatus::Draft,
                pilot: input.pilot.clone(),
                pilot_license: input.pilot_license.clone(),
                takeoff_at: input.takeoff_at,
                landed_at: Some(input.landed_at),
                takeoff_lat: None,
                takeoff_lon: None,
                landing_lat: None,
                landing_lon: None,
                takeoff_place: input.takeoff_place.clone(),
                landing_place: input.landing_place.clone(),
                purposes: input.purposes.clone(),
                specific_flight: input.specific_flight.clone(),
                summary: input.summary.clone(),
                safety_notes: input.safety_notes.clone(),
                supersedes: None,
                created_by: by.into(),
                created_at: 0,
            })
            .await?;
        self.flight(id)
            .await?
            .ok_or_else(|| StoreError::Invalid("flight vanished".into()))
    }

    /// Draft: edited in place. Confirmed: a superseding copy is inserted and returned.
    pub async fn patch_flight(&self, id: i64, patch: &FlightPatch, by: &str) -> Result<Option<Flight>> {
        let Some(current) = self.cols(id).await? else {
            return Ok(None);
        };
        let next = apply_patch(&current, patch);
        check_times(next.takeoff_at, next.landed_at)?;
        if next.status == FlightStatus::Confirmed && next.landed_at.is_none() {
            return Err(StoreError::Invalid("an open flight cannot be confirmed".into()));
        }
        let target = if current.status == FlightStatus::Draft {
            self.update_cols(id, &next).await?;
            id
        } else {
            let new_id = self
                .insert_cols(&Cols {
                    status: FlightStatus::Confirmed,
                    supersedes: Some(id),
                    created_by: by.into(),
                    ..next
                })
                .await?;
            // The confirmed row keeps its own squawks; the correction gets copies.
            sqlx::query(
                "INSERT INTO flight_squawks (flight_id, occurred_on, description, action_on, action, confirmer, created_by, created_at) \
                 SELECT ?2, occurred_on, description, action_on, action, confirmer, created_by, created_at \
                 FROM flight_squawks WHERE flight_id = ?1 ORDER BY id",
            )
            .bind(id)
            .bind(new_id)
            .execute(&self.pool)
            .await?;
            new_id
        };
        self.flight(target).await
    }

    /// False unless the flight exists and is a draft.
    pub async fn delete_draft(&self, id: i64) -> Result<bool> {
        sqlx::query("DELETE FROM flight_squawks WHERE flight_id = ?1 AND (SELECT status FROM flights WHERE id = ?1) = 'draft'")
            .bind(id)
            .execute(&self.pool)
            .await?;
        let res = sqlx::query("DELETE FROM flights WHERE id = ?1 AND status = 'draft'")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(res.rows_affected() == 1)
    }

    /// `None` when the flight does not exist.
    pub async fn add_squawk(
        &self,
        flight_id: i64,
        input: &FlightSquawkInput,
        by: &str,
    ) -> Result<Option<FlightSquawk>> {
        if self.cols(flight_id).await?.is_none() {
            return Ok(None);
        }
        let res = sqlx::query(
            "INSERT INTO flight_squawks (flight_id, occurred_on, description, action_on, action, confirmer, created_by, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        )
        .bind(flight_id)
        .bind(&input.occurred_on)
        .bind(&input.description)
        .bind(&input.action_on)
        .bind(&input.action)
        .bind(&input.confirmer)
        .bind(by)
        .bind(unix_ms() as i64)
        .execute(&self.pool)
        .await?;
        let row = sqlx::query("SELECT * FROM flight_squawks WHERE id = ?1")
            .bind(res.last_insert_rowid())
            .fetch_one(&self.pool)
            .await?;
        Ok(Some(squawk_of(&row)))
    }

    /// Registry initial minutes + every landed, non-superseded flight.
    pub async fn total_flight_minutes(&self, sysid: SysId) -> Result<u32> {
        let initial = self.initial_flight_minutes(sysid).await?;
        Ok(total_for(initial, &self.landed(sysid).await?, None))
    }

    /// Who last touched this vehicle (newest audit row), used as the draft's pilot.
    pub async fn last_operator(&self, sysid: SysId) -> Result<Option<String>> {
        let v: Option<String> =
            sqlx::query_scalar("SELECT operator FROM audit_log WHERE sysid = ?1 ORDER BY id DESC LIMIT 1")
                .bind(i64::from(sysid))
                .fetch_optional(&self.pool)
                .await?;
        Ok(v)
    }
}

#[cfg(test)]
mod tests {
    use rgcs_core::{FlightInput, FlightPatch, FlightSquawkInput, FlightStatus, VehicleRegistryInput};

    use crate::audit::AuditInput;
    use crate::Store;

    /// 2026-12-01 23:30 JST.
    const T0: u64 = 1_796_050_800_000 + 23 * 3_600_000 + 30 * 60_000;

    fn registry(initial: u32) -> VehicleRegistryInput {
        VehicleRegistryInput {
            name: "UAV-01".into(),
            registration: "".into(),
            uas_type: "".into(),
            model: "".into(),
            type_cert_no: "".into(),
            airworthiness_class: "".into(),
            airworthiness_no: "".into(),
            manufacturer: "".into(),
            serial_no: "".into(),
            initial_flight_minutes: initial,
            inspection_template_id: None,
        }
    }

    fn manual(takeoff: u64, landed: u64) -> FlightInput {
        FlightInput {
            pilot: "admin".into(),
            pilot_license: "".into(),
            takeoff_at: takeoff,
            landed_at: landed,
            takeoff_place: "".into(),
            landing_place: "".into(),
            purposes: vec!["空撮".into()],
            specific_flight: vec![],
            summary: "".into(),
            safety_notes: "".into(),
        }
    }

    #[tokio::test]
    async fn open_land_and_totals() {
        let s = Store::open_memory().await.unwrap();
        s.put_registry(1, &registry(100), "copter").await.unwrap();
        let id = s
            .open_flight(1, "admin", "", T0, Some(36.1), Some(139.3), "system")
            .await
            .unwrap();
        assert_eq!(s.open_flight_of(1).await.unwrap().unwrap().id, id);
        s.land_flight(id, T0 + 61_000, Some(36.2), Some(139.4))
            .await
            .unwrap();
        assert!(s.open_flight_of(1).await.unwrap().is_none());
        let f = s.flight(id).await.unwrap().unwrap();
        assert_eq!(
            (f.flight_minutes, f.total_minutes, f.status),
            (2, 102, FlightStatus::Draft)
        );
        assert_eq!(f.landing_lat, Some(36.2));
        let id2 = s
            .open_flight(1, "admin", "", T0 + 3_600_000, None, None, "system")
            .await
            .unwrap();
        s.land_flight(id2, T0 + 3_600_000 + 30_000, None, None)
            .await
            .unwrap();
        let list = s.list_flights(1, None, None).await.unwrap();
        assert_eq!(
            list.iter()
                .map(|f| (f.flight_minutes, f.total_minutes))
                .collect::<Vec<_>>(),
            vec![(2, 102), (1, 103)]
        );
        assert_eq!(s.total_flight_minutes(1).await.unwrap(), 103);
        assert_eq!(s.registry(1, "x").await.unwrap().total_flight_minutes, 103);
    }

    #[tokio::test]
    async fn reopen_clears_the_landing() {
        let s = Store::open_memory().await.unwrap();
        let id = s
            .open_flight(1, "admin", "", T0, None, None, "system")
            .await
            .unwrap();
        s.land_flight(id, T0 + 10_000, Some(1.0), Some(2.0))
            .await
            .unwrap();
        assert!(s.reopen_flight(id).await.unwrap());
        let f = s.open_flight_of(1).await.unwrap().unwrap();
        assert_eq!((f.id, f.landed_at, f.landing_lat), (id, None, None));
    }

    #[tokio::test]
    async fn patch_on_a_confirmed_flight_supersedes_it() {
        let s = Store::open_memory().await.unwrap();
        let f = s
            .create_flight(1, &manual(T0, T0 + 120_000), "admin")
            .await
            .unwrap();
        let p = FlightPatch {
            takeoff_place: Some("A".into()),
            ..FlightPatch::default()
        };
        let same = s.patch_flight(f.id, &p, "admin").await.unwrap().unwrap();
        assert_eq!((same.id, same.takeoff_place.as_str()), (f.id, "A"));
        let confirmed = s
            .patch_flight(
                f.id,
                &FlightPatch {
                    status: Some(FlightStatus::Confirmed),
                    ..FlightPatch::default()
                },
                "admin",
            )
            .await
            .unwrap()
            .unwrap();
        assert_eq!((confirmed.id, confirmed.status), (f.id, FlightStatus::Confirmed));
        let newer = s
            .patch_flight(
                f.id,
                &FlightPatch {
                    summary: Some("fixed".into()),
                    ..FlightPatch::default()
                },
                "admin",
            )
            .await
            .unwrap()
            .unwrap();
        assert_ne!(newer.id, f.id);
        assert_eq!(
            (newer.supersedes, newer.status, newer.takeoff_place.as_str()),
            (Some(f.id), FlightStatus::Confirmed, "A")
        );
        let list = s.list_flights(1, None, None).await.unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!((list[0].id, list[0].summary.as_str()), (newer.id, "fixed"));
        assert!(s.patch_flight(999, &p, "admin").await.unwrap().is_none());
        assert!(s.create_flight(1, &manual(T0, T0 - 1), "admin").await.is_err());
    }

    #[tokio::test]
    async fn delete_only_drafts() {
        let s = Store::open_memory().await.unwrap();
        let f = s.create_flight(1, &manual(T0, T0 + 1), "admin").await.unwrap();
        s.patch_flight(
            f.id,
            &FlightPatch {
                status: Some(FlightStatus::Confirmed),
                ..FlightPatch::default()
            },
            "admin",
        )
        .await
        .unwrap();
        assert!(!s.delete_draft(f.id).await.unwrap());
        let d = s.create_flight(1, &manual(T0, T0 + 1), "admin").await.unwrap();
        assert!(s.delete_draft(d.id).await.unwrap());
        assert!(s.flight(d.id).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn squawks_ride_with_the_flight() {
        let s = Store::open_memory().await.unwrap();
        let f = s.create_flight(1, &manual(T0, T0 + 1), "admin").await.unwrap();
        let input = FlightSquawkInput {
            occurred_on: "2026-12-05".into(),
            description: "振動".into(),
            action_on: "".into(),
            action: "".into(),
            confirmer: "".into(),
        };
        assert!(s.add_squawk(f.id, &input, "admin").await.unwrap().is_some());
        assert!(s.add_squawk(999, &input, "admin").await.unwrap().is_none());
        let got = s.flight(f.id).await.unwrap().unwrap();
        assert_eq!(got.squawks.len(), 1);
        assert_eq!(got.squawks[0].description, "振動");
    }

    #[tokio::test]
    async fn range_filter_uses_jst_days() {
        let s = Store::open_memory().await.unwrap();
        s.create_flight(1, &manual(T0, T0 + 1), "admin").await.unwrap();
        assert_eq!(
            s.list_flights(1, Some("2026-12-01"), Some("2026-12-01"))
                .await
                .unwrap()
                .len(),
            1
        );
        assert!(s
            .list_flights(1, Some("2026-12-02"), Some("2026-12-02"))
            .await
            .unwrap()
            .is_empty());
        assert!(s.list_flights(2, None, None).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn last_operator_comes_from_the_audit_log() {
        let s = Store::open_memory().await.unwrap();
        s.record_audit(AuditInput {
            operator: "admin",
            sysid: Some(1),
            target: "vehicle",
            command: "arm",
            args: None,
            result: "ok",
            reason: None,
        })
        .await
        .unwrap();
        assert_eq!(s.last_operator(1).await.unwrap().as_deref(), Some("admin"));
        assert_eq!(s.last_operator(2).await.unwrap(), None);
    }

    #[tokio::test]
    async fn reopen_only_drafts_and_open_flights_cannot_be_confirmed() {
        let s = Store::open_memory().await.unwrap();
        let id = s
            .open_flight(1, "admin", "", T0, None, None, "system")
            .await
            .unwrap();
        let confirm = FlightPatch {
            status: Some(FlightStatus::Confirmed),
            ..FlightPatch::default()
        };
        assert!(
            s.patch_flight(id, &confirm, "admin").await.is_err(),
            "still in the air"
        );
        s.land_flight(id, T0 + 10_000, None, None).await.unwrap();
        assert!(s.reopen_flight(id).await.unwrap());
        s.land_flight(id, T0 + 20_000, None, None).await.unwrap();
        s.patch_flight(id, &confirm, "admin").await.unwrap().unwrap();
        assert!(
            !s.reopen_flight(id).await.unwrap(),
            "confirmed records are immutable"
        );
        assert!(s.open_flight_of(1).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn supersede_copies_squawks_and_marks_the_old_row() {
        let s = Store::open_memory().await.unwrap();
        let f = s.create_flight(1, &manual(T0, T0 + 1), "admin").await.unwrap();
        let sq = FlightSquawkInput {
            occurred_on: "2026-12-05".into(),
            description: "振動".into(),
            action_on: "".into(),
            action: "".into(),
            confirmer: "".into(),
        };
        s.add_squawk(f.id, &sq, "admin").await.unwrap();
        s.patch_flight(
            f.id,
            &FlightPatch {
                status: Some(FlightStatus::Confirmed),
                ..FlightPatch::default()
            },
            "admin",
        )
        .await
        .unwrap();
        assert_eq!(s.flight_superseded_by(f.id).await.unwrap(), None);
        let newer = s
            .patch_flight(
                f.id,
                &FlightPatch {
                    summary: Some("x".into()),
                    ..FlightPatch::default()
                },
                "admin",
            )
            .await
            .unwrap()
            .unwrap();
        assert_eq!(newer.squawks.len(), 1);
        assert_eq!(
            s.flight(f.id).await.unwrap().unwrap().squawks.len(),
            1,
            "the confirmed row is untouched"
        );
        assert_eq!(s.flight_superseded_by(f.id).await.unwrap(), Some(newer.id));
        assert_eq!(s.flight_superseded_by(newer.id).await.unwrap(), None);
    }
}
