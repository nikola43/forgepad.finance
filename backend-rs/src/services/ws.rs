use serde::Deserialize;
use socketioxide::extract::{Data, SocketRef, State as SioState};
use socketioxide::{SocketIo, layer::SocketIoLayer};
use std::sync::Arc;

use crate::{AppState, WsEvent};

#[derive(Debug, Deserialize)]
pub struct SubAddPayload {
    pub address: String,
    pub dex: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SubRemovePayload {
    pub address: String,
}

/// Create the socket.io layer and spawn the broadcast forwarder.
pub fn create_socketio(state: Arc<AppState>) -> SocketIoLayer {
    let (sio_layer, io) = SocketIo::builder()
        .with_state(state.clone())
        .build_layer();

    io.ns("/", move |socket: SocketRef, _state: SioState<Arc<AppState>>| async move {
        tracing::debug!("Socket.IO client connected: {}", socket.id);

        socket.on(
            "SubAdd",
            |socket: SocketRef, Data(payload): Data<SubAddPayload>, _state: SioState<Arc<AppState>>| async move {
                tracing::debug!("SubAdd: {}", payload.address);
                // Room membership (join/leave) is the source of truth for
                // subscriptions. The previous ws_subs bookkeeping keyed on a
                // parsed socket id that always resolved to 0, so it was dead
                // code and has been removed.
                let _ = socket.join(payload.address);
            },
        );

        socket.on(
            "SubRemove",
            |socket: SocketRef, Data(payload): Data<SubRemovePayload>, _state: SioState<Arc<AppState>>| async move {
                tracing::debug!("SubRemove: {}", payload.address);
                let _ = socket.leave(payload.address);
            },
        );

        socket.on_disconnect(
            |socket: SocketRef, _state: SioState<Arc<AppState>>| async move {
                tracing::debug!("Socket.IO client disconnected: {}", socket.id);
            },
        );
    });

    // Spawn broadcast forwarder: listens on ws_tx and emits to socket.io rooms
    let io_clone = io.clone();
    let state_clone = state.clone();
    tokio::spawn(async move {
        let mut rx = state_clone.ws_tx.subscribe();
        // TODO: broadcast channel capacity is defined in lib.rs
        // (AppState::new -> broadcast::channel(1024)). Increase it there if
        // lagging becomes frequent under load.
        loop {
            let event = match rx.recv().await {
                Ok(event) => event,
                // Slow consumer: skip dropped messages instead of dying.
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                // Sender dropped / channel closed: stop the forwarder.
                Err(_) => break,
            };
            match &event {
                WsEvent::Trade {
                    token_address,
                    date,
                    token_price,
                    volume,
                } => {
                    // Emit 'm' event in the format the frontend expects:
                    // "tokenAddress~date~tokenPrice~volume"
                    let msg = format!("{token_address}~{date}~{token_price}~{volume}");
                    let _ = io_clone
                        .to(token_address.clone())
                        .emit("m", &msg)
                        .await;
                }
                WsEvent::Deployed { token } => {
                    // Broadcast to all connected clients
                    let _ = io_clone
                        .emit("deployed", token)
                        .await;
                }
            }
        }
    });

    sio_layer
}
