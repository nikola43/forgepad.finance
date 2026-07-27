// Distributor contract support: leaderboard shares for on-chain payout rounds.
//
// The Distributor contract (foundry/src/Distributor.sol) pays 90% of its pot
// pro-rata by leaderboard share and 10% to a VRF-picked winner. Chainlink
// Functions doesn't exist on BSC, so the round-runner (scripts/) fetches the
// packed shares from GET /shares here and posts them on-chain with the poster
// key. After distribute() confirms, it records the round via POST /rounds —
// the newest round's time_end becomes the start of the next leaderboard
// window, which is what "clears" the leaderboard after every payout.

use axum::extract::{Query, State};
use axum::http::HeaderMap;
use axum::Json;
use diesel::prelude::QueryableByName;
use diesel::sql_types::{BigInt, Double, Nullable, Text};
use diesel_async::RunQueryDsl;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::errors::{AppError, AppResult};
use crate::AppState;

/// Start of the current scoring window: the end of the last paid round, or 0
/// if nothing has been distributed yet.
pub async fn epoch_start(state: &AppState) -> AppResult<i64> {
    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;
    #[derive(QueryableByName)]
    struct E {
        #[diesel(sql_type = BigInt)]
        epoch: i64,
    }
    let e: E = diesel::sql_query(
        "SELECT COALESCE(MAX(time_end), 0) AS epoch FROM distributor_rounds",
    )
    .get_result(&mut conn)
    .await?;
    Ok(e.epoch)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharesQuery {
    /// Window start (unix seconds). Defaults to the end of the last paid round.
    pub from: Option<i64>,
    /// Window end (unix seconds). Defaults to now.
    pub to: Option<i64>,
    /// Max holders, top-N by points. Defaults to 100 (the distribution size).
    pub limit: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareEntry {
    pub address: String,
    pub points: f64,
    /// The holder's fraction of 2^32 — the on-chain share unit.
    pub share: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharesResponse {
    pub from: i64,
    pub to: i64,
    pub total_points: f64,
    pub holders: Vec<ShareEntry>,
    /// Calldata for Distributor.postShares: 24-byte entries, 20-byte address
    /// followed by the big-endian uint32 share. 0x-prefixed hex.
    pub packed: String,
}

// GET /distributor/shares
pub async fn get_shares(
    State(state): State<Arc<AppState>>,
    Query(params): Query<SharesQuery>,
) -> AppResult<Json<SharesResponse>> {
    let from = match params.from {
        Some(f) => f,
        None => epoch_start(&state).await?,
    };
    let to = params.to.unwrap_or_else(|| chrono::Utc::now().timestamp());
    if to <= from {
        return Err(AppError::BadRequest("`to` must be after `from`".to_string()));
    }
    // Hard-capped at the contract's MAX_HOLDERS: a bigger payload makes
    // postShares revert TooManyHolders, which through the CRE forwarder is a
    // silent no-round.
    let limit = params.limit.unwrap_or(100).clamp(1, 100);

    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;

    #[derive(QueryableByName)]
    struct Row {
        #[diesel(sql_type = Text)]
        address: String,
        #[diesel(sql_type = Double)]
        points: f64,
    }

    // Same scoring as the season leaderboard: net USD invested in the window
    // (floored at zero) plus bonus points granted in the window.
    let rows: Vec<Row> = diesel::sql_query(
        "SELECT u.address, \
           GREATEST(COALESCE(tv.net_usd, 0), 0) + COALESCE(pl.pts, 0) AS points \
         FROM users u \
         LEFT JOIN ( \
           SELECT swapper_id AS uid, \
             SUM(CASE WHEN trade_type = 'buy' \
                      THEN eth_amount::float8 * eth_price::float8 \
                      ELSE -(eth_amount::float8 * eth_price::float8) END) AS net_usd \
           FROM trades WHERE traded_at BETWEEN $1 AND $2 GROUP BY swapper_id \
         ) tv ON tv.uid = u.id \
         LEFT JOIN ( \
           SELECT user_id AS uid, SUM(amount) AS pts \
           FROM points_ledger \
           WHERE created_at BETWEEN to_timestamp($1) AND to_timestamp($2) \
           GROUP BY user_id \
         ) pl ON pl.uid = u.id \
         WHERE GREATEST(COALESCE(tv.net_usd, 0), 0) + COALESCE(pl.pts, 0) > 0 \
         ORDER BY points DESC, u.address ASC \
         LIMIT $3",
    )
    .bind::<BigInt, _>(from)
    .bind::<BigInt, _>(to)
    .bind::<BigInt, _>(limit)
    .load(&mut conn)
    .await?;

    let total_points: f64 = rows.iter().map(|r| r.points).sum();

    let mut holders = Vec::with_capacity(rows.len());
    let mut packed = Vec::with_capacity(rows.len() * 24);
    for r in &rows {
        let addr = r.address.trim_start_matches("0x");
        let Ok(bytes) = hex::decode(addr) else { continue };
        if bytes.len() != 20 {
            continue;
        }
        // Floor of the fraction of 2^32; the sum over holders can never exceed
        // 2^32, so the contract can never over-distribute.
        let share = ((r.points / total_points) * 4294967296.0).floor() as u64;
        let share = share.min(u32::MAX as u64) as u32;
        packed.extend_from_slice(&bytes);
        packed.extend_from_slice(&share.to_be_bytes());
        holders.push(ShareEntry {
            address: r.address.clone(),
            points: r.points,
            share,
        });
    }

    Ok(Json(SharesResponse {
        from,
        to,
        total_points,
        holders,
        packed: format!("0x{}", hex::encode(packed)),
    }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordRoundBody {
    pub round_id: i64,
    pub time_start: i64,
    pub time_end: i64,
    pub tx_hash: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordRoundResponse {
    pub success: bool,
    pub epoch_start: i64,
}

// POST /distributor/rounds — api-key gated; called by the round-runner after
// distribute() confirms. Recording the round is what resets the leaderboard.
pub async fn record_round(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<RecordRoundBody>,
) -> AppResult<Json<RecordRoundResponse>> {
    let api_key = headers
        .get("api-key")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if api_key != state.api_key {
        return Err(AppError::Unauthorized("Invalid API key".to_string()));
    }
    if body.time_end <= body.time_start || body.round_id <= 0 {
        return Err(AppError::BadRequest("Invalid round".to_string()));
    }

    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;
    diesel::sql_query(
        "INSERT INTO distributor_rounds (round_id, time_start, time_end, tx_hash) \
         VALUES ($1, $2, $3, $4) ON CONFLICT (round_id) DO NOTHING",
    )
    .bind::<BigInt, _>(body.round_id)
    .bind::<BigInt, _>(body.time_start)
    .bind::<BigInt, _>(body.time_end)
    .bind::<Nullable<Text>, _>(body.tx_hash)
    .execute(&mut conn)
    .await?;

    Ok(Json(RecordRoundResponse {
        success: true,
        epoch_start: epoch_start(&state).await?,
    }))
}
