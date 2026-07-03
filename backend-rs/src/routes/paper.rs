use axum::routing::{get, post};
use axum::Router;
use std::sync::Arc;

use crate::handlers;
use crate::AppState;

pub fn router(state: Arc<AppState>) -> Router<Arc<AppState>> {
    Router::new()
        .route("/buy", post(handlers::paper::buy))
        .route("/sell", post(handlers::paper::sell))
        .route("/reset", post(handlers::paper::reset))
        .route("/{address}", get(handlers::paper::get_portfolio))
        .with_state(state)
}
