//! Final-review fixes at the hub level: the L2 due state (I2).

use super::*;

/// L2 countdown, then a 1.5 s gap in the position stream across the deadline (no fresh
/// `Detected` at the deadline), then the bowl again.
async fn due_rig() -> (Rig, Feed, GuardAlert) {
    let mut r = copter_rig().await;
    r.enable("l2").await;
    let mut feed = Feed::new(&r, toilet_bowl());
    let a = feed.until_alert(&r).await;
    feed.run_secs(&r, 3.5).await;
    r.set_now(a.ts + 5_000);
    r.app.guard.tick();
    r.flush().await;
    assert_eq!(r.phase(), Some(GuardPhase::Due));
    assert!(r.queued().is_empty(), "nothing without a fresh Detected");
    let due = r.alerts().into_iter().last().unwrap();
    assert_eq!(due.text, "兆候が続けば ALT_HOLD へ切り替えます");
    assert_eq!(
        (due.action_mode.as_deref(), due.deadline_ms),
        (Some("ALT_HOLD"), None)
    );
    feed.start += 1_500;
    (r, feed, a)
}

#[tokio::test]
async fn l2_due_acts_on_the_first_fresh_detection() {
    let (mut r, mut feed, _) = due_rig().await;
    feed.run_secs(&r, 0.5).await;
    r.flush().await;
    let jobs = r.queued();
    assert_eq!(jobs.len(), 1);
    assert_eq!(
        jobs[0].cmd,
        VehicleCommand::SetMode {
            mode: "ALT_HOLD".into()
        }
    );
    feed.run_secs(&r, 3.0).await;
    r.flush().await;
    assert!(r.queued().is_empty(), "at most one action");
}

#[tokio::test]
async fn l2_due_is_cancellable() {
    let (mut r, mut feed, a) = due_rig().await;
    let op = r.op.clone();
    let path = format!("/api/guard/alerts/{}/cancel", a.id);
    let (status, body) = r.call(Method::POST, &path, &op, None).await;
    assert_eq!(
        (status, &body["data"]["phase"]),
        (StatusCode::OK, &json!("cancelled"))
    );
    feed.run_secs(&r, 3.0).await;
    r.flush().await;
    assert!(r.queued().is_empty());
}
