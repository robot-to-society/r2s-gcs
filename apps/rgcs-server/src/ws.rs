//! `/ws`: snapshot on connect, then every broadcast frame. Client frames are parsed and,
//! until the input gate lands (M2), answered with an error frame.

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use futures::{SinkExt, StreamExt};
use rgcs_core::{ClientMessage, ServerMessage};
use tokio::sync::broadcast;
use tracing::warn;

use crate::app::AppState;

/// Client frames are small control messages; anything bigger is not ours.
const MAX_MESSAGE_SIZE: usize = 16 * 1024;

pub async fn handler(ws: WebSocketUpgrade, headers: HeaderMap, State(app): State<AppState>) -> Response {
    let origin = headers.get("origin").and_then(|v| v.to_str().ok());
    let host = headers.get("host").and_then(|v| v.to_str().ok());
    if !origin_allowed(origin, host) {
        return (StatusCode::FORBIDDEN, "origin not allowed").into_response();
    }
    ws.max_message_size(MAX_MESSAGE_SIZE)
        .on_upgrade(move |socket| session(socket, app))
        .into_response()
}

/// Same-origin only: the UI is served by this server, so a browser `Origin` must match the
/// `Host` it connected to. Non-browser clients send no `Origin` and are allowed (spec 70 §5).
pub fn origin_allowed(origin: Option<&str>, host: Option<&str>) -> bool {
    match (origin, host) {
        (None, _) => true,
        (Some(o), Some(h)) => {
            let authority = o
                .strip_prefix("http://")
                .or_else(|| o.strip_prefix("https://"))
                .unwrap_or("");
            !authority.is_empty() && authority.eq_ignore_ascii_case(h)
        }
        (Some(_), None) => false,
    }
}

async fn session(socket: WebSocket, app: AppState) {
    let (mut sink, mut stream) = socket.split();
    // Subscribe before taking the snapshot so no frame is lost in between.
    let mut rx = app.tx.subscribe();
    if send(&mut sink, &snapshot(&app).await).await.is_err() {
        return;
    }
    loop {
        tokio::select! {
            frame = rx.recv() => match frame {
                Ok(f) => { if send(&mut sink, &f).await.is_err() { break; } }
                Err(broadcast::error::RecvError::Lagged(n)) => {
                    // Diffs were dropped: the client's state is stale until it gets a full snapshot.
                    warn!(skipped = n, "ws client lagged, resyncing");
                    if send(&mut sink, &snapshot(&app).await).await.is_err() { break; }
                }
                Err(broadcast::error::RecvError::Closed) => break,
            },
            incoming = stream.next() => match incoming {
                Some(Ok(Message::Text(text))) => {
                    if let Some(reply) = handle_client(&text) {
                        if send(&mut sink, &reply).await.is_err() { break; }
                    }
                }
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                Some(Ok(_)) => {}
            }
        }
    }
}

async fn snapshot(app: &AppState) -> ServerMessage {
    ServerMessage::Snapshot {
        vehicles: app.router.lock().await.states(),
    }
}

/// Reply for a client frame; `None` when nothing needs to be said.
pub fn handle_client(text: &str) -> Option<ServerMessage> {
    match serde_json::from_str::<ClientMessage>(text) {
        Ok(ClientMessage::GimbalRate { .. })
        | Ok(ClientMessage::InputHb { .. })
        | Ok(ClientMessage::Select { .. }) => Some(ServerMessage::Error {
            code: "unsupported_capability".into(),
            message: "joystick input is not available yet".into(),
        }),
        Err(e) => Some(ServerMessage::Error {
            code: "validation".into(),
            message: e.to_string(),
        }),
    }
}

async fn send(
    sink: &mut futures::stream::SplitSink<WebSocket, Message>,
    frame: &ServerMessage,
) -> Result<(), ()> {
    let text = serde_json::to_string(frame).map_err(|_| ())?;
    sink.send(Message::Text(text.into())).await.map_err(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn origin_must_match_host_when_present() {
        assert!(origin_allowed(None, Some("pi.local:8000")));
        assert!(origin_allowed(
            Some("http://pi.local:8000"),
            Some("pi.local:8000")
        ));
        assert!(origin_allowed(Some("https://HUB.example"), Some("hub.example")));
        assert!(!origin_allowed(
            Some("http://evil.example"),
            Some("pi.local:8000")
        ));
        assert!(!origin_allowed(Some("http://pi.local:8000"), None));
        assert!(!origin_allowed(Some("null"), Some("pi.local:8000")));
    }

    #[test]
    fn malformed_client_frames_get_a_validation_error() {
        match handle_client("{\"t\":\"bogus\"}") {
            Some(ServerMessage::Error { code, .. }) => assert_eq!(code, "validation"),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn joystick_frames_are_refused_for_now() {
        match handle_client("{\"t\":\"input_hb\",\"sysid\":1}") {
            Some(ServerMessage::Error { code, .. }) => assert_eq!(code, "unsupported_capability"),
            other => panic!("{other:?}"),
        }
    }
}
