use axum::routing::{get, post};
use axum::Router;
use std::sync::Arc;

use crate::handlers;
use crate::AppState;

pub fn router(state: Arc<AppState>) -> Router<Arc<AppState>> {
    Router::new()
        .route("/", post(handlers::trades::get_trades_by_token))
        .route("/recent", get(handlers::trades::get_recent_trades))
        .route("/getChartData", get(handlers::trades::get_chart_data))
        .with_state(state)
}
