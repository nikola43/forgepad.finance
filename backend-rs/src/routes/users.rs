use axum::routing::{get, post};
use axum::Router;
use std::sync::Arc;

use crate::handlers;
use crate::AppState;

pub fn router(state: Arc<AppState>) -> Router<Arc<AppState>> {
    Router::new()
        .route("/", get(handlers::users::get_user_info))
        .route("/", post(handlers::users::create_user))
        .route("/leaderboard", get(handlers::users::get_leaderboard))
        .route(
            "/followings/{address}",
            get(handlers::users::get_followings),
        )
        .route("/profile/{address}", get(handlers::users::get_user_profile))
        .route("/balance/{id}", get(handlers::users::get_balance))
        .route("/top/{count}", get(handlers::users::top_holders))
        .route("/follow/{address}", post(handlers::users::follow_user))
        .route("/unfollow/{address}", post(handlers::users::unfollow_user))
        .route("/update", post(handlers::users::update_user))
        .route("/avatar", post(handlers::users::upload_avatar))
        .with_state(state)
}
