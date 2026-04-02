use axum::extract::State;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use serde_json::json;
use std::sync::Arc;
use tower_http::services::ServeDir;

use crate::AppState;

pub mod chats;
pub mod tokens;
pub mod trades;
pub mod users;

pub fn create_router(state: Arc<AppState>) -> Router {
    let upload_dir = state.upload_dir.clone();

    Router::new()
        .nest("/tokens", tokens::router(state.clone()))
        .nest("/trades", trades::router(state.clone()))
        .nest("/users", users::router(state.clone()))
        .nest("/chats", chats::router(state.clone()))
        .nest_service("/uploads", ServeDir::new(upload_dir))
        .route("/health", get(health))
        .route("/config", get(config))
        .with_state(state)
}

async fn health() -> impl IntoResponse {
    Json(json!({ "status": "ok" }))
}

async fn config(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    Json(json!({ "chains": state.chains }))
}
