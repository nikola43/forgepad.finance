use axum::routing::get;
use axum::Router;
use std::sync::Arc;

use crate::handlers;
use crate::AppState;

pub fn router(state: Arc<AppState>) -> Router<Arc<AppState>> {
    Router::new()
        // Read-only. Rewards are granted automatically by the indexer as they
        // are earned (handlers::rewards::sync_grants) — there is no claim step.
        .route("/{address}", get(handlers::rewards::get_rewards))
        .with_state(state)
}
