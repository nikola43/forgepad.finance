use axum::routing::get;
use axum::Router;
use std::sync::Arc;

use crate::handlers;
use crate::AppState;

pub fn router(state: Arc<AppState>) -> Router<Arc<AppState>> {
    Router::new()
        .route("/{address}", get(handlers::creator::get_dashboard))
        .with_state(state)
}
