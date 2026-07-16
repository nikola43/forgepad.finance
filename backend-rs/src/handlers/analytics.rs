use std::sync::Arc;

use axum::extract::{Path, State};
use axum::Json;
use diesel::prelude::*;
use diesel::sql_types::{BigInt, Bool, Double, Integer, Nullable, Text};
use diesel_async::RunQueryDsl;
use serde::Serialize;

use crate::errors::{AppError, AppResult};
use crate::AppState;

// ---------------------------------------------------------------------------
// Token analytics / safety panel + per-token Top Traders (PnL). Derived live
// from tokens/holders/trades. Holder % is against the fixed 1e9 total supply
// (matches Fyuz TOTAL_SUPPLY). Bundle heuristic = distinct buyers in the
// token's first-seen block (min traded_at).
// ---------------------------------------------------------------------------

const TOTAL_SUPPLY: f64 = 1_000_000_000.0;
const GRADUATION_TARGET_USD: f64 = 20_000.0;

#[derive(QueryableByName)]
struct TokenRow {
    #[diesel(sql_type = Integer)]
    id: i32,
    #[diesel(sql_type = Nullable<Integer>)]
    creator_id: Option<i32>,
    #[diesel(sql_type = Bool)]
    launched: bool,
    #[diesel(sql_type = Double)]
    marketcap: f64,
}

async fn resolve_token(
    conn: &mut diesel_async::AsyncPgConnection,
    network: &str,
    address: &str,
) -> AppResult<Option<TokenRow>> {
    Ok(diesel::sql_query(
        "SELECT id, creator_id, (launched_at IS NOT NULL) AS launched, COALESCE(marketcap::float8,0) AS marketcap \
         FROM tokens WHERE token_address = $1 AND network = $2",
    )
    .bind::<Text, _>(address.to_lowercase())
    .bind::<Text, _>(network)
    .get_result::<TokenRow>(conn)
    .await
    .optional()?)
}

#[derive(QueryableByName)]
struct AggRow {
    #[diesel(sql_type = BigInt)]
    holder_count: i64,
    #[diesel(sql_type = Double)]
    top10_amount: f64,
    #[diesel(sql_type = Double)]
    creator_amount: f64,
    #[diesel(sql_type = BigInt)]
    buys: i64,
    #[diesel(sql_type = BigInt)]
    sells: i64,
    #[diesel(sql_type = Double)]
    volume_usd: f64,
    #[diesel(sql_type = BigInt)]
    bundle_buyers: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenAnalytics {
    token_address: String,
    network: String,
    holder_count: i64,
    top10_pct: f64,
    creator_pct: f64,
    buys: i64,
    sells: i64,
    volume_usd: f64,
    graduation_pct: f64,
    launched: bool,
    bundle_buyers: i64,
    bundle_flag: bool,
}

// GET /analytics/token/:network/:address
pub async fn get_token_analytics(
    State(state): State<Arc<AppState>>,
    Path((network, address)): Path<(String, String)>,
) -> AppResult<Json<TokenAnalytics>> {
    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;
    let tk = resolve_token(&mut conn, &network, &address)
        .await?
        .ok_or_else(|| AppError::NotFound("Token not found".to_string()))?;
    let tid = tk.id;
    let creator_id = tk.creator_id.unwrap_or(-1);

    let agg: AggRow = diesel::sql_query(format!(
        "SELECT \
           (SELECT COUNT(*) FROM holders h WHERE h.token_id={tid} AND h.amount>0)::bigint AS holder_count, \
           COALESCE((SELECT SUM(amt) FROM (SELECT h.amount::float8 AS amt FROM holders h WHERE h.token_id={tid} AND h.amount>0 ORDER BY h.amount DESC LIMIT 10) x),0) AS top10_amount, \
           COALESCE((SELECT h.amount::float8 FROM holders h WHERE h.token_id={tid} AND h.user_id={creator_id} LIMIT 1),0) AS creator_amount, \
           COALESCE(SUM(CASE WHEN t.trade_type='buy' THEN 1 ELSE 0 END),0)::bigint AS buys, \
           COALESCE(SUM(CASE WHEN t.trade_type='sell' THEN 1 ELSE 0 END),0)::bigint AS sells, \
           COALESCE(SUM(t.eth_amount::float8*t.eth_price::float8),0) AS volume_usd, \
           COALESCE((SELECT COUNT(DISTINCT swapper_id) FROM trades WHERE token_id={tid} AND trade_type='buy' AND traded_at=(SELECT MIN(traded_at) FROM trades WHERE token_id={tid} AND trade_type='buy')),0)::bigint AS bundle_buyers \
         FROM trades t WHERE t.token_id={tid}"
    ))
    .get_result(&mut conn)
    .await?;

    Ok(Json(TokenAnalytics {
        token_address: address,
        network,
        holder_count: agg.holder_count,
        top10_pct: (agg.top10_amount / TOTAL_SUPPLY * 100.0).clamp(0.0, 100.0),
        creator_pct: (agg.creator_amount / TOTAL_SUPPLY * 100.0).clamp(0.0, 100.0),
        buys: agg.buys,
        sells: agg.sells,
        volume_usd: agg.volume_usd,
        graduation_pct: if tk.launched { 100.0 } else { (tk.marketcap / GRADUATION_TARGET_USD * 100.0).clamp(0.0, 100.0) },
        launched: tk.launched,
        bundle_buyers: agg.bundle_buyers,
        bundle_flag: agg.bundle_buyers >= 3,
    }))
}

// ---- Top traders (per token, by PnL) --------------------------------------

#[derive(QueryableByName)]
struct TraderRow {
    #[diesel(sql_type = Integer)]
    user_id: i32,
    #[diesel(sql_type = Text)]
    address: String,
    #[diesel(sql_type = Nullable<Text>)]
    username: Option<String>,
    #[diesel(sql_type = Nullable<Text>)]
    avatar: Option<String>,
    #[diesel(sql_type = Double)]
    buy_usd: f64,
    #[diesel(sql_type = Double)]
    buy_tokens: f64,
    #[diesel(sql_type = Double)]
    sell_usd: f64,
    #[diesel(sql_type = Double)]
    sell_tokens: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TopTrader {
    address: String,
    username: Option<String>,
    avatar: Option<String>,
    realized_pnl_usd: f64,
    unrealized_pnl_usd: f64,
    total_pnl_usd: f64,
    volume_usd: f64,
    is_creator: bool,
}

// GET /analytics/top-traders/:network/:address
pub async fn get_top_traders(
    State(state): State<Arc<AppState>>,
    Path((network, address)): Path<(String, String)>,
) -> AppResult<Json<Vec<TopTrader>>> {
    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;
    let tk = resolve_token(&mut conn, &network, &address)
        .await?
        .ok_or_else(|| AppError::NotFound("Token not found".to_string()))?;
    let tid = tk.id;
    let creator_id = tk.creator_id.unwrap_or(-1);

    // Current USD price of the token (ETH/token * USD/ETH).
    #[derive(QueryableByName)]
    struct P {
        #[diesel(sql_type = Double)]
        price_usd: f64,
    }
    let price_usd = diesel::sql_query(format!(
        "SELECT COALESCE(price::float8,0)*COALESCE(eth_price::float8,0) AS price_usd FROM tokens WHERE id={tid}"
    ))
    .get_result::<P>(&mut conn)
    .await?
    .price_usd;

    let rows: Vec<TraderRow> = diesel::sql_query(format!(
        "SELECT u.id AS user_id, u.address, u.username, u.avatar, \
           COALESCE(SUM(CASE WHEN t.trade_type='buy' THEN t.eth_amount::float8*t.eth_price::float8 ELSE 0 END),0) AS buy_usd, \
           COALESCE(SUM(CASE WHEN t.trade_type='buy' THEN t.token_amount::float8 ELSE 0 END),0) AS buy_tokens, \
           COALESCE(SUM(CASE WHEN t.trade_type='sell' THEN t.eth_amount::float8*t.eth_price::float8 ELSE 0 END),0) AS sell_usd, \
           COALESCE(SUM(CASE WHEN t.trade_type='sell' THEN t.token_amount::float8 ELSE 0 END),0) AS sell_tokens \
         FROM trades t JOIN users u ON u.id=t.swapper_id \
         WHERE t.token_id={tid} \
         GROUP BY u.id"
    ))
    .load(&mut conn)
    .await?;

    let mut traders: Vec<TopTrader> = rows
        .into_iter()
        .map(|r| {
            let avg = if r.buy_tokens > 0.0 { r.buy_usd / r.buy_tokens } else { 0.0 };
            let realized = r.sell_usd - r.sell_tokens * avg;
            let net = (r.buy_tokens - r.sell_tokens).max(0.0);
            let unrealized = net * (price_usd - avg);
            TopTrader {
                address: r.address,
                username: r.username,
                avatar: r.avatar,
                realized_pnl_usd: realized,
                unrealized_pnl_usd: unrealized,
                total_pnl_usd: realized + unrealized,
                volume_usd: r.buy_usd + r.sell_usd,
                is_creator: r.user_id == creator_id,
            }
        })
        .collect();
    traders.sort_by(|a, b| b.total_pnl_usd.partial_cmp(&a.total_pnl_usd).unwrap_or(std::cmp::Ordering::Equal));
    traders.truncate(25);
    Ok(Json(traders))
}
