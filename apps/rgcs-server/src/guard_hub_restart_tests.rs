//! Final-review fix I1: a vehicle first seen already armed (the server restarted mid-flight, so
//! the per-flight latches are gone) is alert-only until it disarms once.

use rgcs_core::{GuardConsent, GuardLevel, GuardSettings};

use super::*;

/// What `main` does at start-up: the stored settings (consent 3, L3) applied directly.
fn restart_with_l3(r: &Rig) {
    let consent = GuardConsent {
        monitoring: true,
        external_data: false,
        auto_ops: true,
        by: Some("admin".into()),
        at_ms: Some(T0),
    };
    r.app.guard.apply_settings(GuardSettings {
        enabled: true,
        consent,
        toilet_bowl: GuardLevel::L3,
        ..GuardSettings::default()
    });
}

#[tokio::test]
async fn a_vehicle_first_seen_armed_is_alert_only_until_it_disarms() {
    let mut r = Rig::new().await;
    r.copter(COPTER_LOITER, true).await;
    restart_with_l3(&r);
    let mut feed = Feed::new(&r, toilet_bowl());
    let a = feed.until_alert(&r).await;
    assert_eq!((a.phase, a.level), (GuardPhase::Alerting, GuardLevel::L1));
    assert_eq!(a.action_mode, None);
    feed.run_secs(&r, 8.0).await;
    r.flush().await;
    assert!(r.queued().is_empty(), "no SetMode before a disarm");
    let rows = r.app.store.decisions(Some(1), 10).await.unwrap();
    assert!(rows.iter().all(|x| x.level == "l1"), "recorded at the capped level");
    r.copter(COPTER_LOITER, false).await;
    Feed::new(&r, toilet_bowl()).run_secs(&r, 0.5).await;
    r.copter(COPTER_LOITER, true).await;
    Feed::new(&r, toilet_bowl()).until_alert(&r).await;
    r.flush().await;
    assert_eq!(r.queued().len(), 1, "the next flight acts again");
}

#[tokio::test]
async fn a_vehicle_seen_disarmed_while_the_guard_was_off_acts_after_arming() {
    let mut r = Rig::new().await;
    r.copter(COPTER_LOITER, false).await;
    Feed::new(&r, toilet_bowl()).run_secs(&r, 0.5).await;
    r.copter(COPTER_LOITER, true).await;
    restart_with_l3(&r);
    Feed::new(&r, toilet_bowl()).until_alert(&r).await;
    r.flush().await;
    assert_eq!(r.queued().len(), 1);
}
