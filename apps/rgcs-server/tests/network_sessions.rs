//! Review focus 3 and 4: the client address survives `into_make_service_with_connect_info`,
//! and a closed socket leaves no ghost session.

mod common;

use std::net::SocketAddr;
use std::time::Duration;

use futures::StreamExt;
use rgcs_server::app;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;

async fn wait_for(what: &str, mut ok: impl FnMut() -> bool) {
    for _ in 0..100 {
        if ok() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("timed out waiting for {what}");
}

#[tokio::test]
async fn ws_session_is_listed_with_address_and_removed_on_close() {
    let (router, state) = common::spawn_app().await;
    let cookie = common::login(&router).await;
    let served = app::build(state.clone(), None).into_make_service_with_connect_info::<SocketAddr>();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let server = tokio::spawn(async move { axum::serve(listener, served).await });

    let mut req = format!("ws://127.0.0.1:{port}/ws").into_client_request().unwrap();
    req.headers_mut().insert("cookie", HeaderValue::from_str(&cookie).unwrap());
    req.headers_mut()
        .insert("user-agent", HeaderValue::from_static("test Firefox/131.0"));
    let (mut socket, _) = tokio_tungstenite::connect_async(req).await.expect("ws connect");
    let first = socket.next().await.expect("snapshot frame").expect("frame ok");
    assert!(first.to_text().unwrap().contains("snapshot"));

    let rows = state.sessions.list();
    assert_eq!(rows.len(), 1);
    assert!(rows[0].addr.as_deref().unwrap_or("").starts_with("127.0.0.1:"), "{:?}", rows[0].addr);
    assert_eq!(rows[0].browser, "Firefox");
    assert_eq!(rows[0].username, "admin");

    drop(socket);
    wait_for("session removal", || state.sessions.list().is_empty()).await;
    server.abort();
}
