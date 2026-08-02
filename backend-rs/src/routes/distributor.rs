use axum::routing::get;
use axum::Router;
use std::sync::Arc;

use crate::handlers;
use crate::AppState;

pub fn router(state: Arc<AppState>) -> Router<Arc<AppState>> {
    Router::new()
        .route("/shares", get(handlers::distributor::get_shares))
        .route("/pot", get(handlers::distributor::get_pot))
        // GET lists the public payout ledger; POST records a round (api-key
        // gated, called by the round-runner). Same path, different methods.
        .route(
            "/rounds",
            get(handlers::distributor::list_rounds).post(handlers::distributor::record_round),
        )
        .route("/rounds/{id}", get(handlers::distributor::get_round))
        .route("/payouts/{address}", get(handlers::distributor::get_address_payouts))
        .route("/claimable/{address}", get(handlers::distributor::get_claimable))
        .route("/stats", get(handlers::distributor::get_stats))
        .with_state(state)
}
