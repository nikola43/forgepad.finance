use std::sync::Arc;

use axum::extract::{Path, State};
use axum::Json;
use diesel::prelude::*;
use diesel::sql_types::{Double, Integer, Nullable, Text};
use diesel_async::RunQueryDsl;
use serde::Serialize;

use crate::errors::{AppError, AppResult};
use crate::AppState;

// ---------------------------------------------------------------------------
// Portfolio / PnL tracker. Average-cost method computed live from `trades`:
//   avgCost/token = Σ(buy usd) / Σ(buy tokens)
//   realized PnL  = Σ(sell usd) − Σ(sell tokens) · avgCost
//   net tokens    = Σ(buy tokens) − Σ(sell tokens)     (current holding)
//   current value = net tokens · price(ETH/token) · ethPrice(USD/ETH)
//   unrealized    = current value − net tokens · avgCost
// USD volume of a trade = eth_amount·eth_price; token price/eth_price come from
// the token row (kept current by the indexer).
// ---------------------------------------------------------------------------

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
    #[diesel(sql_type = Double)]
    price: f64, // ETH per token
    #[diesel(sql_type = Double)]
    eth_price: f64, // USD per ETH
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
pub struct Position {
    token_address: String,
    name: String,
    symbol: String,
    image: Option<String>,
    network: String,
    balance: f64,
    current_price_usd: f64,
    value_usd: f64,
    cost_usd: f64,
    avg_buy_price_usd: f64,
    unrealized_pnl_usd: f64,
    unrealized_pnl_pct: f64,
    realized_pnl_usd: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Portfolio {
    address: String,
    total_value_usd: f64,
    total_cost_usd: f64,
    unrealized_pnl_usd: f64,
    realized_pnl_usd: f64,
    total_pnl_usd: f64,
    roi_pct: f64,
    positions: Vec<Position>,
}

// GET /portfolio/:address
pub async fn get_portfolio(
    State(state): State<Arc<AppState>>,
    Path(address): Path<String>,
) -> AppResult<Json<Portfolio>> {
    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;

    #[derive(QueryableByName)]
    struct IdRow {
        #[diesel(sql_type = Integer)]
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
            return Ok(Json(Portfolio {
                address,
                total_value_usd: 0.0,
                total_cost_usd: 0.0,
                unrealized_pnl_usd: 0.0,
                realized_pnl_usd: 0.0,
                total_pnl_usd: 0.0,
                roi_pct: 0.0,
                positions: vec![],
            }))
        }
    };

    let rows: Vec<Row> = diesel::sql_query(format!(
        "SELECT tk.token_address, tk.name, tk.symbol, tk.image, tk.network, \
           COALESCE(tk.price::float8, 0) AS price, COALESCE(tk.eth_price::float8, 0) AS eth_price, \
           COALESCE(SUM(CASE WHEN t.trade_type = 'buy' THEN t.eth_amount::float8 * t.eth_price::float8 ELSE 0 END), 0) AS buy_usd, \
           COALESCE(SUM(CASE WHEN t.trade_type = 'buy' THEN t.token_amount::float8 ELSE 0 END), 0) AS buy_tokens, \
           COALESCE(SUM(CASE WHEN t.trade_type = 'sell' THEN t.eth_amount::float8 * t.eth_price::float8 ELSE 0 END), 0) AS sell_usd, \
           COALESCE(SUM(CASE WHEN t.trade_type = 'sell' THEN t.token_amount::float8 ELSE 0 END), 0) AS sell_tokens \
         FROM trades t JOIN tokens tk ON tk.id = t.token_id \
         WHERE t.swapper_id = {uid} \
         GROUP BY tk.id"
    ))
    .load(&mut conn)
    .await?;

    let mut positions = Vec::new();
    let mut total_value = 0.0;
    let mut total_cost = 0.0;
    let mut total_unreal = 0.0;
    let mut total_real = 0.0;

    for r in rows {
        let avg_cost = if r.buy_tokens > 0.0 { r.buy_usd / r.buy_tokens } else { 0.0 };
        let realized = r.sell_usd - r.sell_tokens * avg_cost;
        total_real += realized;

        let net_tokens = (r.buy_tokens - r.sell_tokens).max(0.0);
        let price_usd = r.price * r.eth_price;
        let value = net_tokens * price_usd;
        let cost = net_tokens * avg_cost;
        let unreal = value - cost;

        // A "position" is a token still held (dust filtered out).
        if net_tokens > 1e-6 {
            total_value += value;
            total_cost += cost;
            total_unreal += unreal;
            positions.push(Position {
                token_address: r.token_address,
                name: r.name,
                symbol: r.symbol,
                image: r.image,
                network: r.network,
                balance: net_tokens,
                current_price_usd: price_usd,
                value_usd: value,
                cost_usd: cost,
                avg_buy_price_usd: avg_cost,
                unrealized_pnl_usd: unreal,
                unrealized_pnl_pct: if cost > 0.0 { unreal / cost * 100.0 } else { 0.0 },
                realized_pnl_usd: realized,
            });
        }
    }

    // Highest value first.
    positions.sort_by(|a, b| b.value_usd.partial_cmp(&a.value_usd).unwrap_or(std::cmp::Ordering::Equal));

    let total_pnl = total_unreal + total_real;
    Ok(Json(Portfolio {
        address,
        total_value_usd: total_value,
        total_cost_usd: total_cost,
        unrealized_pnl_usd: total_unreal,
        realized_pnl_usd: total_real,
        total_pnl_usd: total_pnl,
        roi_pct: if total_cost > 0.0 { total_pnl / total_cost * 100.0 } else { 0.0 },
        positions,
    }))
}
