use axum::routing::get;
use axum::Router;
use std::sync::Arc;

use crate::handlers;
use crate::AppState;

pub fn router(state: Arc<AppState>) -> Router<Arc<AppState>> {
    Router::new()
        // Static route is matched before the dynamic `{address}` in axum.
        .route("/leaderboard", get(handlers::referrals::get_leaderboard))
        .route("/{address}", get(handlers::referrals::get_summary))
        .with_state(state)
}
