use std::sync::Arc;

use axum::extract::State;
use axum::Json;
use diesel::prelude::*;
use diesel::sql_types::{Double, Nullable, Text};
use diesel_async::RunQueryDsl;
use serde::Serialize;

use crate::errors::{AppError, AppResult};
use crate::AppState;

// ---------------------------------------------------------------------------
// Seasons leaderboard — a time-boxed competition with a countdown + prize pot.
//
// The season window and prize pot live in code as constants. Each competitor's
// "points" for the season combines their net trading volume (buys minus sells,
// floored at zero) over the window with any `points_ledger` grants that landed
// inside the window. Only the top 50 with positive points are returned.
// ---------------------------------------------------------------------------

const SEASON_NAME: &str = "Season 1";
const SEASON_START: i64 = 1782000000;
const SEASON_END: i64 = 1786000000;
const PRIZE_POT_ETH: f64 = 1.0;

#[derive(QueryableByName)]
struct LeaderRow {
    #[diesel(sql_type = Text)]
    address: String,
    #[diesel(sql_type = Nullable<Text>)]
    username: Option<String>,
    #[diesel(sql_type = Nullable<Text>)]
    avatar: Option<String>,
    #[diesel(sql_type = Double)]
    points: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeasonEntry {
    rank: i32,
    address: String,
    username: Option<String>,
    avatar: Option<String>,
    points: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeasonResponse {
    name: String,
    starts_at: i64,
    ends_at: i64,
    prize_pot_eth: f64,
    leaderboard: Vec<SeasonEntry>,
}

// GET /season
pub async fn get_season(
    State(state): State<Arc<AppState>>,
) -> AppResult<Json<SeasonResponse>> {
    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;

    // SEASON_START / SEASON_END are compile-time i64 constants, so inlining them
    // into the SQL is injection-safe.
    let start = SEASON_START;
    let end = SEASON_END;

    // Canonical scoring — handlers/points.rs. The season table used to carry its
    // own copy of the formula; keeping one definition is what guarantees the
    // number here matches the one the Distributor pays on.
    let points = crate::handlers::points::points_expr();
    let rows: Vec<LeaderRow> = diesel::sql_query(format!(
        "{with} \
         SELECT u.address, u.username, u.avatar, \
           {points} AS points \
         FROM users u {joins} \
         WHERE {points} > 0 \
         ORDER BY points DESC, u.address ASC \
         LIMIT 50",
        with = crate::handlers::points::points_with(start, end),
        joins = crate::handlers::points::POINTS_JOINS,
    ))
    .load(&mut conn)
    .await?;

    let leaderboard = rows
        .into_iter()
        .enumerate()
        .map(|(i, r)| SeasonEntry {
            rank: (i as i32) + 1,
            address: r.address,
            username: r.username,
            avatar: r.avatar,
            points: r.points,
        })
        .collect();

    Ok(Json(SeasonResponse {
        name: SEASON_NAME.to_string(),
        starts_at: SEASON_START,
        ends_at: SEASON_END,
        prize_pot_eth: PRIZE_POT_ETH,
        leaderboard,
    }))
}
