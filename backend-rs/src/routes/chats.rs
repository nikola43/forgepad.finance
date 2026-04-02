use axum::routing::post;
use axum::Router;
use std::sync::Arc;

use crate::handlers;
use crate::AppState;

pub fn router(state: Arc<AppState>) -> Router<Arc<AppState>> {
    Router::new()
        .route("/", post(handlers::chats::get_chats))
        .route("/reply", post(handlers::chats::reply))
        .with_state(state)
}
