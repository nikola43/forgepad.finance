use std::sync::Arc;

use axum::extract::{Path, State};
use axum::Json;
use diesel::prelude::*;
use diesel::sql_types::{BigInt, Double, Text};
use diesel_async::RunQueryDsl;
use serde::Serialize;

use crate::errors::{AppError, AppResult};
use crate::AppState;

// ---------------------------------------------------------------------------
// Airdrop allocation preview.
//
// Frames a user's accrued points as their indicative weight in a hypothetical
// future token distribution. Points are computed exactly the same way as the
// leaderboard: net USD invested (max(0, buy - sell)) plus any bonus points
// recorded in `points_ledger` (quests, streaks, achievements, referrals).
//
// `sharePct` is `yourPoints / totalPoints * 100`, where `totalPoints` is the
// sum over every user with a positive score. Allocation is purely indicative —
// nothing is promised or reserved on-chain.
// ---------------------------------------------------------------------------

// Canonical scoring — see handlers/points.rs. Identical to the leaderboard and
// to the Distributor shares so ranks stay consistent across all three.
//
// The airdrop scores the WHOLE history (window = [0, now]) rather than the
// current round window: it is a lifetime-contribution view, not a per-round
// payout. Allocation remains purely indicative — nothing is promised or
// reserved on-chain.

#[derive(QueryableByName)]
struct IdRow {
    #[diesel(sql_type = diesel::sql_types::Integer)]
    id: i32,
}

#[derive(QueryableByName)]
struct StatsRow {
    #[diesel(sql_type = Double)]
    your_points: f64,
    #[diesel(sql_type = Double)]
    total_points: f64,
    #[diesel(sql_type = BigInt)]
    total_users: i64,
    #[diesel(sql_type = BigInt)]
    rank: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AirdropResponse {
    address: String,
    your_points: f64,
    total_points: f64,
    rank: i64,
    total_users: i64,
    share_pct: f64,
}

// GET /airdrop/:address
pub async fn get_airdrop(
    State(state): State<Arc<AppState>>,
    Path(address): Path<String>,
) -> AppResult<Json<AirdropResponse>> {
    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;

    let id_row: Option<IdRow> = diesel::sql_query("SELECT id FROM users WHERE address = $1")
        .bind::<Text, _>(address.to_lowercase())
        .get_result(&mut conn)
        .await
        .optional()?;
    let uid = match id_row {
        Some(r) => r.id,
        None => {
            return Ok(Json(AirdropResponse {
                address,
                your_points: 0.0,
                total_points: 0.0,
                rank: 0,
                total_users: 0,
                share_pct: 0.0,
            }))
        }
    };

    // per_user: every user with a positive score. uid is an i32 from the DB, so
    // inlining it is injection-safe.
    let now = chrono::Utc::now().timestamp();
    // Lifetime window: anchored at the first trade, not 1970.
    let lifetime_from = crate::handlers::points::clamp_window_start(&state, 0).await?;
    let points = crate::handlers::points::points_expr();
    let stats: StatsRow = diesel::sql_query(format!(
        "{with}, per_user AS ( \
           SELECT u.id AS uid, {points} AS points \
           FROM users u {joins} \
           WHERE {points} > 0 \
         ) \
         SELECT \
           COALESCE((SELECT points FROM per_user WHERE uid = {uid}), 0) AS your_points, \
           COALESCE(SUM(points), 0) AS total_points, \
           COUNT(*)::bigint AS total_users, \
           (1 + COUNT(*) FILTER (WHERE points > COALESCE((SELECT points FROM per_user WHERE uid = {uid}), 0)))::bigint AS rank \
         FROM per_user",
        with = crate::handlers::points::points_with(lifetime_from, now),
        joins = crate::handlers::points::POINTS_JOINS,
    ))
    .get_result(&mut conn)
    .await?;

    let share_pct = if stats.total_points > 0.0 {
        stats.your_points / stats.total_points * 100.0
    } else {
        0.0
    };

    Ok(Json(AirdropResponse {
        address,
        your_points: stats.your_points,
        total_points: stats.total_points,
        rank: stats.rank,
        total_users: stats.total_users,
        share_pct,
    }))
}
