//! MT11 simulator for tests and the dev stack: answers the P2 command subset the way the
//! Python app observed the camera doing, and records every frame it receives.

use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, UdpSocket};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

pub use crate::siyi::client::Transport;
use crate::siyi::frame::{make_packet, Parser};

pub const FIRMWARE_REPLY: [u8; 12] = [0x01, 0x00, 0x01, 0x89, 0x0A, 0x01, 0x00, 0x8A, 0, 0, 0, 0];

#[derive(Debug, Clone)]
pub struct SimState {
    pub record_sta: u8,
    pub zoom: (u8, u8),
    pub video_mode: (u8, u8),
    /// 0 lock, 1 follow, 2 fpv (0x19 encoding).
    pub gimbal_mode: u8,
}

impl Default for SimState {
    fn default() -> Self {
        Self {
            record_sta: 0,
            zoom: (1, 0),
            video_mode: (0, 2),
            gimbal_mode: 1,
        }
    }
}

type Received = (Transport, u8, Vec<u8>);

pub struct SimServer {
    pub addr: SocketAddr,
    pub received: mpsc::UnboundedReceiver<Received>,
    state: Arc<Mutex<SimState>>,
    tasks: Arc<Mutex<Vec<JoinHandle<()>>>>,
}

/// Reply (cmd, data) for a request, updating the simulated state.
pub fn reply_for(state: &Mutex<SimState>, cmd: u8, payload: &[u8]) -> Option<(u8, Vec<u8>)> {
    let mut s = state.lock().expect("sim state");
    match cmd {
        0x01 => Some((0x01, FIRMWARE_REPLY.to_vec())),
        0x0A => Some((0x0A, vec![0, 0, 0, s.record_sta])),
        0x0C => match payload.first()? {
            2 => {
                s.record_sta = if s.record_sta == 1 { 0 } else { 1 };
                Some((0x0B, vec![if s.record_sta == 1 { 5 } else { 6 }]))
            }
            f @ 3..=5 => {
                s.gimbal_mode = f - 3;
                Some((0x0C, vec![*f]))
            }
            f => Some((0x0C, vec![*f])),
        },
        0x0F => {
            s.zoom = (*payload.first()?, *payload.get(1)?);
            Some((0x0F, vec![s.zoom.0, s.zoom.1]))
        }
        0x18 => Some((0x18, vec![s.zoom.0, s.zoom.1])),
        0x10 => Some((0x10, vec![s.video_mode.0, s.video_mode.1])),
        0x11 => {
            s.video_mode = (*payload.first()?, *payload.get(1)?);
            Some((0x11, vec![s.video_mode.0, s.video_mode.1]))
        }
        0x19 => Some((0x19, vec![s.gimbal_mode])),
        0x0D => {
            let mut data = Vec::new();
            for v in [905i16, -300, 5, 0, 0, 0] {
                data.extend(v.to_le_bytes());
            }
            Some((0x0D, data))
        }
        _ => None,
    }
}

impl SimServer {
    pub async fn start() -> Self {
        Self::start_on(0).await
    }

    /// TCP and UDP on the same port (0 = ephemeral).
    pub async fn start_on(port: u16) -> Self {
        let listener = TcpListener::bind(("127.0.0.1", port))
            .await
            .expect("sim tcp bind");
        let addr = listener.local_addr().expect("sim addr");
        let udp = UdpSocket::bind(addr).await.expect("sim udp bind");
        let (tx, received) = mpsc::unbounded_channel();
        let state = Arc::new(Mutex::new(SimState::default()));
        let tasks: Arc<Mutex<Vec<JoinHandle<()>>>> = Arc::new(Mutex::new(Vec::new()));

        let accept = {
            let (tx, state, tasks) = (tx.clone(), state.clone(), tasks.clone());
            tokio::spawn(async move {
                loop {
                    let Ok((stream, _)) = listener.accept().await else {
                        return;
                    };
                    let (tx, state) = (tx.clone(), state.clone());
                    let conn = tokio::spawn(serve_tcp(stream, tx, state));
                    tasks.lock().expect("sim tasks").push(conn);
                }
            })
        };
        let udp_task = {
            let (tx, state) = (tx.clone(), state.clone());
            tokio::spawn(async move {
                let mut buf = [0u8; 2048];
                let mut parser = Parser::default();
                while let Ok((n, _)) = udp.recv_from(&mut buf).await {
                    for f in parser.push(&buf[..n]) {
                        let _ = reply_for(&state, f.cmd, &f.payload);
                        let _ = tx.send((Transport::Udp, f.cmd, f.payload));
                    }
                }
            })
        };
        tasks.lock().expect("sim tasks").extend([accept, udp_task]);
        Self {
            addr,
            received,
            state,
            tasks,
        }
    }

    pub fn set_zoom(&self, int_part: u8, tenths: u8) {
        self.state.lock().expect("sim state").zoom = (int_part, tenths);
    }

    pub fn set_record(&self, sta: u8) {
        self.state.lock().expect("sim state").record_sta = sta;
    }

    /// Drops the listener and every live connection (the client sees EOF).
    pub async fn stop(self) {
        for t in self.tasks.lock().expect("sim tasks").drain(..) {
            t.abort();
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
}

async fn serve_tcp(
    mut stream: tokio::net::TcpStream,
    tx: mpsc::UnboundedSender<Received>,
    state: Arc<Mutex<SimState>>,
) {
    let mut buf = [0u8; 4096];
    let mut parser = Parser::default();
    let mut seq: u16 = 0;
    loop {
        let n = match stream.read(&mut buf).await {
            Ok(0) | Err(_) => return,
            Ok(n) => n,
        };
        for f in parser.push(&buf[..n]) {
            let reply = reply_for(&state, f.cmd, &f.payload);
            let _ = tx.send((Transport::Tcp, f.cmd, f.payload));
            if let Some((cmd, data)) = reply {
                seq = seq.wrapping_add(1);
                if stream.write_all(&make_packet(cmd, &data, 2, seq)).await.is_err() {
                    return;
                }
            }
        }
    }
}
