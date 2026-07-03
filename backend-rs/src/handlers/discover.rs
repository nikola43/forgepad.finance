use std::sync::Arc;

use axum::extract::{Query, State};
use axum::Json;
use diesel::prelude::*;
use diesel::sql_types::{BigInt, Bool, Double, Nullable, Text};
use diesel_async::RunQueryDsl;
use serde::{Deserialize, Serialize};

use crate::errors::{AppError, AppResult};
use crate::AppState;

// ---------------------------------------------------------------------------
// Discover / trending screener. A dedicated read endpoint (leaves the
// Home-page `list_tokens` untouched) that ranks ArrowPad tokens with a 24h
// window computed live from `trades`/`holders`. Tabs pick the ORDER BY;
// numeric filters are parsed to f64/i64 and inlined (injection-safe), and the
// only string input (network) is sanitized to [a-z0-9-].
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverQuery {
    pub tab: Option<String>,      // trending | new | gainers | graduating
    pub network: Option<String>,
    pub min_marketcap: Option<f64>,
    pub min_volume: Option<f64>,
    pub min_holders: Option<i64>,
    pub max_age_secs: Option<i64>,
    pub status: Option<String>,   // bonding | graduated
    pub limit: Option<i64>,
}

#[derive(QueryableByName)]
struct Row {
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
    #[diesel(sql_type = Nullable<Text>)]
    creator_address: Option<String>,
    #[diesel(sql_type = Double)]
    marketcap: f64,
    #[diesel(sql_type = Double)]
    price_usd: f64,
    #[diesel(sql_type = BigInt)]
    created_at: i64,
    #[diesel(sql_type = Bool)]
    launched: bool,
    #[diesel(sql_type = Double)]
    volume24h: f64,
    #[diesel(sql_type = BigInt)]
    buys24h: i64,
    #[diesel(sql_type = BigInt)]
    sells24h: i64,
    #[diesel(sql_type = BigInt)]
    holders: i64,
    #[diesel(sql_type = Double)]
    price_change24h: f64,
    #[diesel(sql_type = Double)]
    graduation_pct: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverToken {
    token_address: String,
    name: String,
    symbol: String,
    image: Option<String>,
    network: String,
    creator_address: Option<String>,
    marketcap: f64,
    price_usd: f64,
    created_at: i64,
    launched: bool,
    volume24h: f64,
    buys24h: i64,
    sells24h: i64,
    holders: i64,
    price_change24h: f64,
    graduation_pct: f64,
}

// Graduation target market cap (USD) — matches chains.rs target_market_cap.
const GRADUATION_TARGET_USD: f64 = 20_000.0;

// GET /discover
pub async fn discover(
    State(state): State<Arc<AppState>>,
    Query(p): Query<DiscoverQuery>,
) -> AppResult<Json<Vec<DiscoverToken>>> {
    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;
    let limit = p.limit.unwrap_or(50).clamp(1, 200);

    // WHERE clauses (all values parsed/sanitized → safe to inline).
    let mut wheres: Vec<String> = vec!["tk.category = 'normal'".to_string()];
    if let Some(n) = p.network.as_deref() {
        if n != "all" {
            let san: String = n.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').collect();
            if !san.is_empty() {
                wheres.push(format!("tk.network = '{san}'"));
            }
        }
    }
    if let Some(mc) = p.min_marketcap {
        wheres.push(format!("COALESCE(tk.marketcap::float8,0) >= {}", mc.max(0.0)));
    }
    if let Some(age) = p.max_age_secs {
        wheres.push(format!("EXTRACT(EPOCH FROM tk.created_at)::bigint >= (EXTRACT(EPOCH FROM NOW())::bigint - {})", age.max(0)));
    }
    match p.status.as_deref() {
        Some("graduated") => wheres.push("tk.launched_at IS NOT NULL".to_string()),
        Some("bonding") => wheres.push("tk.launched_at IS NULL".to_string()),
        _ => {}
    }
    let where_sql = wheres.join(" AND ");

    // HAVING clauses reference the computed aggregates.
    let mut havings: Vec<String> = vec![];
    if let Some(v) = p.min_volume {
        havings.push(format!("COALESCE(SUM(CASE WHEN t.traded_at >= cutoff.c THEN t.eth_amount::float8*t.eth_price::float8 ELSE 0 END),0) >= {}", v.max(0.0)));
    }
    if let Some(h) = p.min_holders {
        havings.push(format!("(SELECT COUNT(*) FROM holders h WHERE h.token_id = tk.id AND h.amount > 0) >= {}", h.max(0)));
    }
    let having_sql = if havings.is_empty() { String::new() } else { format!("HAVING {}", havings.join(" AND ")) };

    let order_sql = match p.tab.as_deref().unwrap_or("trending") {
        "new" => "created_at DESC",
        "gainers" => "price_change24h DESC, volume24h DESC",
        "graduating" => "graduation_pct DESC, volume24h DESC",
        "volume" => "volume24h DESC",
        "marketcap" => "marketcap DESC",
        "holders" => "holders DESC",
        _ => "COALESCE(tk.score::float8, 0) DESC, volume24h DESC", // trending
    };

    let sql = format!(
        "SELECT tk.token_address, tk.name, tk.symbol, tk.image, tk.network, \
           u.address AS creator_address, \
           COALESCE(tk.marketcap::float8,0) AS marketcap, \
           COALESCE(tk.price::float8,0)*COALESCE(tk.eth_price::float8,0) AS price_usd, \
           EXTRACT(EPOCH FROM tk.created_at)::bigint AS created_at, \
           (tk.launched_at IS NOT NULL) AS launched, \
           COALESCE(SUM(CASE WHEN t.traded_at >= cutoff.c THEN t.eth_amount::float8*t.eth_price::float8 ELSE 0 END),0) AS volume24h, \
           COALESCE(SUM(CASE WHEN t.traded_at >= cutoff.c AND t.trade_type='buy' THEN 1 ELSE 0 END),0)::bigint AS buys24h, \
           COALESCE(SUM(CASE WHEN t.traded_at >= cutoff.c AND t.trade_type='sell' THEN 1 ELSE 0 END),0)::bigint AS sells24h, \
           (SELECT COUNT(*) FROM holders h WHERE h.token_id = tk.id AND h.amount > 0)::bigint AS holders, \
           CASE WHEN (SELECT tr.token_price::float8 FROM trades tr WHERE tr.token_id=tk.id AND tr.traded_at >= cutoff.c ORDER BY tr.traded_at ASC LIMIT 1) > 0 \
                THEN (COALESCE(tk.price::float8,0) - (SELECT tr.token_price::float8 FROM trades tr WHERE tr.token_id=tk.id AND tr.traded_at >= cutoff.c ORDER BY tr.traded_at ASC LIMIT 1)) \
                     / (SELECT tr.token_price::float8 FROM trades tr WHERE tr.token_id=tk.id AND tr.traded_at >= cutoff.c ORDER BY tr.traded_at ASC LIMIT 1) * 100 \
                ELSE 0 END AS price_change24h, \
           LEAST(100, COALESCE(tk.marketcap::float8,0) / {target} * 100) AS graduation_pct \
         FROM tokens tk \
         CROSS JOIN (SELECT (EXTRACT(EPOCH FROM NOW())::bigint - 86400) AS c) cutoff \
         LEFT JOIN trades t ON t.token_id = tk.id \
         LEFT JOIN users u ON u.id = tk.creator_id \
         WHERE {where_sql} \
         GROUP BY tk.id, u.address, cutoff.c \
         {having_sql} \
         ORDER BY {order_sql} \
         LIMIT {limit}",
        target = GRADUATION_TARGET_USD,
    );

    let rows: Vec<Row> = diesel::sql_query(sql).load(&mut conn).await?;
    Ok(Json(
        rows.into_iter()
            .map(|r| DiscoverToken {
                token_address: r.token_address,
                name: r.name,
                symbol: r.symbol,
                image: r.image,
                network: r.network,
                creator_address: r.creator_address,
                marketcap: r.marketcap,
                price_usd: r.price_usd,
                created_at: r.created_at,
                launched: r.launched,
                volume24h: r.volume24h,
                buys24h: r.buys24h,
                sells24h: r.sells24h,
                holders: r.holders,
                price_change24h: r.price_change24h,
                graduation_pct: r.graduation_pct,
            })
            .collect(),
    ))
}
