use axum::routing::{get, post};
use axum::Router;
use std::sync::Arc;

use crate::handlers;
use crate::AppState;

pub fn router(state: Arc<AppState>) -> Router<Arc<AppState>> {
    Router::new()
        .route("/king", get(handlers::tokens::get_king))
        .route("/", get(handlers::tokens::list_tokens))
        .route("/", post(handlers::tokens::create_token))
        .route("/{tokenAddress}/move", post(handlers::tokens::move_token))
        .route(
            "/{network}/{tokenAddress}",
            get(handlers::tokens::get_token_details),
        )
        .route("/upload", post(handlers::tokens::upload_logo))
        .with_state(state)
}
