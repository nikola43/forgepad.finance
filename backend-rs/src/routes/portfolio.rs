use axum::routing::get;
use axum::Router;
use std::sync::Arc;

use crate::handlers;
use crate::AppState;

pub fn router(state: Arc<AppState>) -> Router<Arc<AppState>> {
    Router::new()
        .route("/{address}", get(handlers::portfolio::get_portfolio))
        .with_state(state)
}
