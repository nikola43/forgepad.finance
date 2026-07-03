use axum::routing::{get, post};
use axum::Router;
use std::sync::Arc;

use crate::handlers;
use crate::AppState;

pub fn router(state: Arc<AppState>) -> Router<Arc<AppState>> {
    Router::new()
        .route("/start", post(handlers::stream::start_stream))
        .route("/stop", post(handlers::stream::stop_stream))
        .route("/{tokenAddress}", get(handlers::stream::get_status))
        .route("/{tokenAddress}/join", get(handlers::stream::join_stream))
        .route("/{tokenAddress}/heartbeat", post(handlers::stream::heartbeat))
        .with_state(state)
}
