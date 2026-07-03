use axum::extract::State;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use serde_json::json;
use std::sync::Arc;
use tower_http::services::ServeDir;

use crate::AppState;

pub mod airdrop;
pub mod analytics;
pub mod chats;
pub mod creator;
pub mod discover;
pub mod kings;
pub mod paper;
pub mod portfolio;
pub mod referrals;
pub mod rewards;
pub mod season;
pub mod stream;
pub mod tier;
pub mod tokens;
pub mod trades;
pub mod users;
pub mod wallet;
pub mod watchlist;

pub fn create_router(state: Arc<AppState>) -> Router {
    let upload_dir = state.upload_dir.clone();

    Router::new()
        .nest("/tokens", tokens::router(state.clone()))
        .nest("/trades", trades::router(state.clone()))
        .nest("/users", users::router(state.clone()))
        .nest("/chats", chats::router(state.clone()))
        .nest("/rewards", rewards::router(state.clone()))
        .nest("/referrals", referrals::router(state.clone()))
        .nest("/creator", creator::router(state.clone()))
        .nest("/watchlist", watchlist::router(state.clone()))
        .nest("/season", season::router(state.clone()))
        .nest("/kings", kings::router(state.clone()))
        .nest("/airdrop", airdrop::router(state.clone()))
        .nest("/tier", tier::router(state.clone()))
        .nest("/portfolio", portfolio::router(state.clone()))
        .nest("/discover", discover::router(state.clone()))
        .nest("/analytics", analytics::router(state.clone()))
        .nest("/wallet", wallet::router(state.clone()))
        .nest("/stream", stream::router(state.clone()))
        .nest("/paper", paper::router(state.clone()))
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
