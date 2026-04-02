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
            |socket: SocketRef, Data(payload): Data<SubAddPayload>, state: SioState<Arc<AppState>>| async move {
                tracing::debug!("SubAdd: {}", payload.address);
                let _ = socket.join(payload.address.clone());
                state
                    .ws_subs
                    .entry(payload.address)
                    .or_default()
                    .insert(socket.id.as_str().parse().unwrap_or(0));
            },
        );

        socket.on(
            "SubRemove",
            |socket: SocketRef, Data(payload): Data<SubRemovePayload>, state: SioState<Arc<AppState>>| async move {
                tracing::debug!("SubRemove: {}", payload.address);
                let _ = socket.leave(payload.address.clone());
                if let Some(mut subs) = state.ws_subs.get_mut(&payload.address) {
                    subs.remove(&socket.id.as_str().parse().unwrap_or(0));
                }
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
        while let Ok(event) = rx.recv().await {
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
