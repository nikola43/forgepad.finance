use std::sync::Arc;

use axum::extract::State;
use axum::Json;
use diesel::prelude::*;
use diesel::sql_types::{BigInt, Nullable, Text};
use diesel_async::RunQueryDsl;
use serde::Serialize;

use crate::errors::{AppError, AppResult};
use crate::AppState;

// ---------------------------------------------------------------------------
// Hall of Kings — history of King-of-the-Hill reigns.
//
// The `kings` table records each reign as a (token, started_at, ended_at) row.
// We join to `tokens` to surface the token identity and compute the reign
// duration in seconds (ongoing reigns count up to NOW()).
// ---------------------------------------------------------------------------

#[derive(QueryableByName)]
struct ReignRow {
    #[diesel(sql_type = Text)]
    token_address: String,
    #[diesel(sql_type = Text)]
    name: String,
    #[diesel(sql_type = Text)]
    symbol: String,
    #[diesel(sql_type = Nullable<Text>)]
    image: Option<String>,
    #[diesel(sql_type = Text)]
    network: String,
    #[diesel(sql_type = BigInt)]
    started_at: i64,
    #[diesel(sql_type = Nullable<BigInt>)]
    ended_at: Option<i64>,
    #[diesel(sql_type = BigInt)]
    duration_secs: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reign {
    token_address: String,
    name: String,
    symbol: String,
    image: Option<String>,
    network: String,
    started_at: i64,
    ended_at: Option<i64>,
    duration_secs: i64,
}

// GET /kings/history
pub async fn get_history(
    State(state): State<Arc<AppState>>,
) -> AppResult<Json<Vec<Reign>>> {
    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;

    let rows: Vec<ReignRow> = diesel::sql_query(
        "SELECT tk.token_address, tk.name, tk.symbol, tk.image, tk.network, \
           EXTRACT(EPOCH FROM k.started_at)::bigint AS started_at, \
           EXTRACT(EPOCH FROM k.ended_at)::bigint AS ended_at, \
           EXTRACT(EPOCH FROM (COALESCE(k.ended_at, NOW()) - k.started_at))::bigint AS duration_secs \
         FROM kings k JOIN tokens tk ON tk.id = k.token_id \
         ORDER BY k.started_at DESC \
         LIMIT 100",
    )
    .load(&mut conn)
    .await?;

    let reigns: Vec<Reign> = rows
        .into_iter()
        .map(|r| Reign {
            token_address: r.token_address,
            name: r.name,
            symbol: r.symbol,
            image: r.image,
            network: r.network,
            started_at: r.started_at,
            ended_at: r.ended_at,
            duration_secs: r.duration_secs,
        })
        .collect();

    Ok(Json(reigns))
}
