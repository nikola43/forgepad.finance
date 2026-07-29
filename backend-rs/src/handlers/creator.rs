use std::sync::Arc;

use axum::extract::{Path, State};
use axum::Json;
use diesel::prelude::*;
use diesel::sql_types::{BigInt, Bool, Double, Nullable, Text};
use diesel_async::RunQueryDsl;
use serde::Serialize;

use crate::errors::{AppError, AppResult};
use crate::AppState;

// ---------------------------------------------------------------------------
// Creator dashboard — per-token analytics for the tokens a user created.
// Everything is derived from existing `tokens`/`trades`/`holders`. `feesUsd` is
// what the CREATOR was paid: TOKEN_OWNER_FEE_BPS of the token's trade volume,
// sent to their wallet on every buy and sell. It is deliberately not the whole
// 1% platform fee — most of that goes to the treasury and the season pot, and
// reporting it here overstated creator earnings five-fold.
// ---------------------------------------------------------------------------

/// The creator's per-trade cut, as a fraction of volume. Mirrors the on-chain
/// TOKEN_OWNER_FEE_BPS (20 = 0.2%). Set CREATOR_FEE_BPS when the on-chain fee
/// changes — e.g. 40 for the 2X creator-fee promotion — so the dashboard keeps
/// reporting what creators were actually paid.
fn creator_fee_rate() -> f64 {
    std::env::var("CREATOR_FEE_BPS")
        .ok()
        .and_then(|v| v.parse::<f64>().ok())
        .filter(|bps| *bps >= 0.0)
        .unwrap_or(20.0)
        / 10_000.0
}

/// Fallback graduation target (USD) for a token whose network is not in the
/// chain config; every configured chain carries its own `target_market_cap`.
const GRADUATION_TARGET_FALLBACK_USD: f64 = 30_000.0;

#[derive(QueryableByName)]
struct TokenRow {
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
    #[diesel(sql_type = Bool)]
    launched: bool,
    #[diesel(sql_type = Double)]
    marketcap: f64,
    #[diesel(sql_type = Double)]
    volume_usd: f64,
    #[diesel(sql_type = BigInt)]
    buys: i64,
    #[diesel(sql_type = BigInt)]
    sells: i64,
    #[diesel(sql_type = BigInt)]
    holders: i64,
    #[diesel(sql_type = BigInt)]
    unique_traders: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatorToken {
    token_address: String,
    name: String,
    symbol: String,
    image: Option<String>,
    network: String,
    launched: bool,
    progress_pct: f64,
    volume_usd: f64,
    fees_usd: f64,
    buys: i64,
    sells: i64,
    holders: i64,
    unique_traders: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatorDashboard {
    address: String,
    token_count: i64,
    graduated_count: i64,
    total_volume_usd: f64,
    total_fees_usd: f64,
    tokens: Vec<CreatorToken>,
}

// GET /creator/:address
pub async fn get_dashboard(
    State(state): State<Arc<AppState>>,
    Path(address): Path<String>,
) -> AppResult<Json<CreatorDashboard>> {
    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;

    #[derive(QueryableByName)]
    struct IdRow {
        #[diesel(sql_type = diesel::sql_types::Integer)]
        id: i32,
    }
    let uid = match diesel::sql_query("SELECT id FROM users WHERE address = $1")
        .bind::<Text, _>(address.to_lowercase())
        .get_result::<IdRow>(&mut conn)
        .await
        .optional()?
    {
        Some(r) => r.id,
        None => {
            return Ok(Json(CreatorDashboard {
                address,
                token_count: 0,
                graduated_count: 0,
                total_volume_usd: 0.0,
                total_fees_usd: 0.0,
                tokens: vec![],
            }))
        }
    };

    let rows: Vec<TokenRow> = diesel::sql_query(format!(
        "SELECT tk.token_address, tk.name, tk.symbol, tk.image, tk.network, \
           (tk.launched_at IS NOT NULL) AS launched, \
           COALESCE(tk.marketcap::float8, 0) AS marketcap, \
           COALESCE(SUM(t.eth_amount::float8 * t.eth_price::float8), 0) AS volume_usd, \
           COALESCE(SUM(CASE WHEN t.trade_type = 'buy' THEN 1 ELSE 0 END), 0)::bigint AS buys, \
           COALESCE(SUM(CASE WHEN t.trade_type = 'sell' THEN 1 ELSE 0 END), 0)::bigint AS sells, \
           (SELECT COUNT(*) FROM holders h WHERE h.token_id = tk.id AND h.amount > 0)::bigint AS holders, \
           COUNT(DISTINCT t.swapper_id)::bigint AS unique_traders \
         FROM tokens tk LEFT JOIN trades t ON t.token_id = tk.id \
         WHERE tk.creator_id = {uid} \
         GROUP BY tk.id \
         ORDER BY volume_usd DESC"
    ))
    .load(&mut conn)
    .await?;

    let fee_rate = creator_fee_rate();
    let mut total_volume_usd = 0.0;
    let mut graduated_count = 0i64;
    let tokens: Vec<CreatorToken> = rows
        .into_iter()
        .map(|r| {
            total_volume_usd += r.volume_usd;
            if r.launched {
                graduated_count += 1;
            }
            // Per-chain target from config, not a constant here: the local copy
            // had drifted to $20k while both chains graduate at $30k, which
            // showed every token 50% further along than it was.
            let target = state
                .chains
                .iter()
                .find(|c| c.network == r.network)
                .map(|c| c.target_market_cap)
                .filter(|t| *t > 0.0)
                .unwrap_or(GRADUATION_TARGET_FALLBACK_USD);
            let progress_pct = if r.launched {
                100.0
            } else {
                (r.marketcap / target * 100.0).clamp(0.0, 100.0)
            };
            CreatorToken {
                token_address: r.token_address,
                name: r.name,
                symbol: r.symbol,
                image: r.image,
                network: r.network,
                launched: r.launched,
                progress_pct,
                volume_usd: r.volume_usd,
                fees_usd: r.volume_usd * fee_rate,
                buys: r.buys,
                sells: r.sells,
                holders: r.holders,
                unique_traders: r.unique_traders,
            }
        })
        .collect();

    Ok(Json(CreatorDashboard {
        address,
        token_count: tokens.len() as i64,
        graduated_count,
        total_volume_usd,
        total_fees_usd: total_volume_usd * fee_rate,
        tokens,
    }))
}
