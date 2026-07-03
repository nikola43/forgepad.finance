use axum::routing::{get, post};
use axum::Router;
use std::sync::Arc;

use crate::handlers;
use crate::AppState;

pub fn router(state: Arc<AppState>) -> Router<Arc<AppState>> {
    Router::new()
        .route("/toggle", post(handlers::watchlist::toggle))
        .route("/{address}", get(handlers::watchlist::get_list))
        .with_state(state)
}
