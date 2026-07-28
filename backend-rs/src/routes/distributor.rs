use axum::routing::{get, post};
use axum::Router;
use std::sync::Arc;

use crate::handlers;
use crate::AppState;

pub fn router(state: Arc<AppState>) -> Router<Arc<AppState>> {
    Router::new()
        .route("/shares", get(handlers::distributor::get_shares))
        .route("/pot", get(handlers::distributor::get_pot))
        .route("/rounds", post(handlers::distributor::record_round))
        .with_state(state)
}
