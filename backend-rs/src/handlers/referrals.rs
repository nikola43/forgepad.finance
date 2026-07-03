use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::Json;
use diesel::prelude::*;
use diesel::sql_types::{BigInt, Double, Integer, Nullable, Text};
use diesel_async::RunQueryDsl;
use serde::{Deserialize, Serialize};

use crate::errors::{AppError, AppResult};
use crate::AppState;

// ---------------------------------------------------------------------------
// Referral dashboard + referral leaderboard.
//
// The `referrals` (referrer_id, referee_id) and `referral_info` (referral_code)
// tables are already populated by `create_user` when a new user signs up with a
// `?ref=` code. These endpoints surface that data: a personal summary (code,
// referees and their volume) and a competitive leaderboard of top referrers.
// ---------------------------------------------------------------------------

#[derive(QueryableByName)]
struct IdRow {
    #[diesel(sql_type = Integer)]
    id: i32,
}

#[derive(QueryableByName)]
struct CodeRow {
    #[diesel(sql_type = Text)]
    referral_code: String,
}

#[derive(QueryableByName)]
struct RefereeRow {
    #[diesel(sql_type = Text)]
    address: String,
    #[diesel(sql_type = Nullable<Text>)]
    username: Option<String>,
    #[diesel(sql_type = Nullable<Text>)]
    avatar: Option<String>,
    #[diesel(sql_type = Double)]
    volume_usd: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Referee {
    address: String,
    username: Option<String>,
    avatar: Option<String>,
    volume_usd: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferralSummary {
    address: String,
    referral_code: Option<String>,
    referral_count: i64,
    referee_volume_usd: f64,
    points_from_referrals: f64,
    referees: Vec<Referee>,
}

// GET /referrals/:address
pub async fn get_summary(
    State(state): State<Arc<AppState>>,
    Path(address): Path<String>,
) -> AppResult<Json<ReferralSummary>> {
    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;

    let id_row: Option<IdRow> = diesel::sql_query("SELECT id FROM users WHERE address = $1")
        .bind::<Text, _>(address.to_lowercase())
        .get_result(&mut conn)
        .await
        .optional()?;
    let uid = match id_row {
        Some(r) => r.id,
        None => {
            return Ok(Json(ReferralSummary {
                address,
                referral_code: None,
                referral_count: 0,
                referee_volume_usd: 0.0,
                points_from_referrals: 0.0,
                referees: vec![],
            }))
        }
    };

    let code: Option<String> = diesel::sql_query(format!(
        "SELECT referral_code FROM referral_info WHERE user_id = {uid}"
    ))
    .get_result::<CodeRow>(&mut conn)
    .await
    .optional()?
    .map(|c| c.referral_code);

    let referees: Vec<RefereeRow> = diesel::sql_query(format!(
        "SELECT u.address, u.username, u.avatar, \
           COALESCE((SELECT SUM(t.eth_amount::float8 * t.eth_price::float8) FROM trades t WHERE t.swapper_id = u.id), 0) AS volume_usd \
         FROM referrals r JOIN users u ON u.id = r.referee_id \
         WHERE r.referrer_id = {uid} \
         ORDER BY volume_usd DESC"
    ))
    .load(&mut conn)
    .await?;

    #[derive(QueryableByName)]
    struct Pts {
        #[diesel(sql_type = Double)]
        total: f64,
    }
    let points_from_referrals: f64 = diesel::sql_query(format!(
        "SELECT COALESCE(SUM(amount), 0) AS total FROM points_ledger \
         WHERE user_id = {uid} AND (source = 'referral' OR ref LIKE 'quest:refer_trader%')"
    ))
    .get_result::<Pts>(&mut conn)
    .await?
    .total;

    let referee_volume_usd = referees.iter().map(|r| r.volume_usd).sum();
    let referral_count = referees.len() as i64;

    Ok(Json(ReferralSummary {
        address,
        referral_code: code,
        referral_count,
        referee_volume_usd,
        points_from_referrals,
        referees: referees
            .into_iter()
            .map(|r| Referee {
                address: r.address,
                username: r.username,
                avatar: r.avatar,
                volume_usd: r.volume_usd,
            })
            .collect(),
    }))
}

#[derive(Debug, Deserialize)]
pub struct LeaderboardQuery {
    pub limit: Option<i64>,
}

#[derive(QueryableByName)]
struct LeaderRow {
    #[diesel(sql_type = Text)]
    address: String,
    #[diesel(sql_type = Nullable<Text>)]
    username: Option<String>,
    #[diesel(sql_type = Nullable<Text>)]
    avatar: Option<String>,
    #[diesel(sql_type = BigInt)]
    referral_count: i64,
    #[diesel(sql_type = Double)]
    referee_volume_usd: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefLeaderEntry {
    rank: i32,
    address: String,
    username: Option<String>,
    avatar: Option<String>,
    referral_count: i64,
    referee_volume_usd: f64,
}

// GET /referrals-leaderboard
pub async fn get_leaderboard(
    State(state): State<Arc<AppState>>,
    Query(params): Query<LeaderboardQuery>,
) -> AppResult<Json<Vec<RefLeaderEntry>>> {
    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;
    let limit = params.limit.unwrap_or(100).clamp(1, 500);

    let rows: Vec<LeaderRow> = diesel::sql_query(format!(
        "SELECT u.address, u.username, u.avatar, \
           COUNT(r.id)::bigint AS referral_count, \
           COALESCE(SUM((SELECT SUM(t.eth_amount::float8 * t.eth_price::float8) FROM trades t WHERE t.swapper_id = r.referee_id)), 0) AS referee_volume_usd \
         FROM referrals r JOIN users u ON u.id = r.referrer_id \
         GROUP BY u.id, u.address, u.username, u.avatar \
         ORDER BY referral_count DESC, referee_volume_usd DESC \
         LIMIT {limit}"
    ))
    .load(&mut conn)
    .await?;

    Ok(Json(
        rows.into_iter()
            .enumerate()
            .map(|(i, r)| RefLeaderEntry {
                rank: (i as i32) + 1,
                address: r.address,
                username: r.username,
                avatar: r.avatar,
                referral_count: r.referral_count,
                referee_volume_usd: r.referee_volume_usd,
            })
            .collect(),
    ))
}
