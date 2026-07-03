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

    let rows: Vec<LeaderRow> = diesel::sql_query(format!(
        "SELECT u.address, u.username, u.avatar, \
           GREATEST(COALESCE(tv.net_usd, 0), 0) + COALESCE(pl.pts, 0) AS points \
         FROM users u \
         LEFT JOIN ( \
           SELECT swapper_id AS uid, \
             SUM(CASE WHEN trade_type = 'buy' \
                      THEN eth_amount::float8 * eth_price::float8 \
                      ELSE -(eth_amount::float8 * eth_price::float8) END) AS net_usd \
           FROM trades \
           WHERE traded_at BETWEEN {start} AND {end} \
           GROUP BY swapper_id \
         ) tv ON tv.uid = u.id \
         LEFT JOIN ( \
           SELECT user_id AS uid, SUM(amount) AS pts \
           FROM points_ledger \
           WHERE created_at BETWEEN to_timestamp({start}) AND to_timestamp({end}) \
           GROUP BY user_id \
         ) pl ON pl.uid = u.id \
         WHERE GREATEST(COALESCE(tv.net_usd, 0), 0) + COALESCE(pl.pts, 0) > 0 \
         ORDER BY points DESC \
         LIMIT 50"
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
