use axum::routing::{get, post};
use axum::Router;
use std::sync::Arc;

use crate::handlers;
use crate::AppState;

pub fn router(state: Arc<AppState>) -> Router<Arc<AppState>> {
    Router::new()
        .route("/{address}", get(handlers::rewards::get_rewards))
        .route(
            "/{address}/claim/{questKey}",
            post(handlers::rewards::claim_quest),
        )
        .with_state(state)
}
