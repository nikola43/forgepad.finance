use axum::routing::get;
use axum::Router;
use std::sync::Arc;

use crate::handlers;
use crate::AppState;

pub fn router(state: Arc<AppState>) -> Router<Arc<AppState>> {
    Router::new()
        .route("/token/{network}/{address}", get(handlers::analytics::get_token_analytics))
        .route("/top-traders/{network}/{address}", get(handlers::analytics::get_top_traders))
        .with_state(state)
}
