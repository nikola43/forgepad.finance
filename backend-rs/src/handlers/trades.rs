use axum::extract::{Query, State};
use axum::Json;
use bigdecimal::ToPrimitive;
use diesel::prelude::*;
use diesel_async::RunQueryDsl;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::errors::{AppError, AppResult};
use crate::models::*;
use crate::schema::*;
use crate::AppState;

// ---------------------------------------------------------------------------
// Query / body types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetTradesByTokenBody {
    pub token_address: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetTradesByTokenQuery {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentTradesQuery {
    pub latest_trade_id: Option<i32>,
    pub latest_token_id: Option<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChartDataQuery {
    pub token_address: String,
    pub interval: String,
    pub from: i64,
    pub to: i64,
    pub first: Option<i32>,
    pub dex: Option<String>,
    pub count_back: Option<i64>,
}

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentTradesResponse {
    pub trades: Vec<TradeResponse>,
    pub tokens: Vec<TokenResponse>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Candle {
    pub time: i64,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
    pub volume: f64,
}

// ---------------------------------------------------------------------------
// POST /trades
// ---------------------------------------------------------------------------

pub async fn get_trades_by_token(
    State(state): State<Arc<AppState>>,
    Query(params): Query<GetTradesByTokenQuery>,
    Json(body): Json<GetTradesByTokenBody>,
) -> AppResult<Json<Vec<TradeResponse>>> {
    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;

    let limit = params.limit.unwrap_or(50).clamp(1, 200);
    let offset = params.offset.unwrap_or(0).max(0);

    // Find the token
    let token: Token = tokens::table
        .filter(tokens::token_address.eq(&body.token_address))
        .first(&mut conn)
        .await
        .optional()?
        .ok_or_else(|| AppError::NotFound("Token not found".to_string()))?;

    // Get creator for response
    let _creator: User = users::table
        .filter(users::id.eq(token.creator_id))
        .first(&mut conn)
        .await?;

    // Query trades with swapper info
    let trade_rows: Vec<(Trade, User)> = trades::table
        .inner_join(users::table.on(users::id.eq(trades::swapper_id)))
        .filter(trades::token_id.eq(token.id))
        .order(trades::traded_at.desc())
        .offset(offset)
        .limit(limit)
        .load(&mut conn)
        .await?;

    let responses: Vec<TradeResponse> = trade_rows
        .iter()
        .map(|(trade, swapper)| TradeResponse {
            id: trade.id,
            token_name: token.name.clone(),
            token_symbol: token.symbol.clone(),
            token_address: token.token_address.clone(),
            token_image: token.image.clone(),
            swapper_address: swapper.address.clone(),
            type_: match trade.trade_type {
                TradeType::Buy => "buy".to_string(),
                TradeType::Sell => "sell".to_string(),
            },
            eth_amount: trade.eth_amount.to_string(),
            token_amount: trade.token_amount.to_string(),
            network: token.network.clone(),
            date: trade.traded_at,
            tx_hash: trade.tx_hash.clone(),
            token_price: trade.token_price.to_string(),
            eth_price: trade.eth_price.to_string(),
        })
        .collect();

    Ok(Json(responses))
}

// ---------------------------------------------------------------------------
// GET /trades/recent
// ---------------------------------------------------------------------------

pub async fn get_recent_trades(
    State(state): State<Arc<AppState>>,
    Query(params): Query<RecentTradesQuery>,
) -> AppResult<Json<RecentTradesResponse>> {
    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;

    let latest_trade_id = params.latest_trade_id.unwrap_or(0);
    let latest_token_id = params.latest_token_id.unwrap_or(0);

    // Trades newer than latest_trade_id
    let trade_rows: Vec<(Trade, (Token, User))> = trades::table
        .inner_join(
            tokens::table.on(tokens::id.eq(trades::token_id))
                .inner_join(users::table.on(users::id.eq(tokens::creator_id))),
        )
        .filter(trades::id.gt(latest_trade_id))
        .order(trades::id.desc())
        .limit(50)
        .load(&mut conn)
        .await?;

    // For swapper addresses, we need a separate lookup
    let swapper_ids: Vec<i32> = trade_rows.iter().map(|(t, _)| t.swapper_id).collect();
    let swappers: Vec<User> = users::table
        .filter(users::id.eq_any(&swapper_ids))
        .load(&mut conn)
        .await?;

    let swapper_map: std::collections::HashMap<i32, &User> =
        swappers.iter().map(|u| (u.id, u)).collect();

    let trade_responses: Vec<TradeResponse> = trade_rows
        .iter()
        .map(|(trade, (token, _creator))| {
            let swapper_addr = swapper_map
                .get(&trade.swapper_id)
                .map(|u| u.address.clone())
                .unwrap_or_default();

            TradeResponse {
                id: trade.id,
                token_name: token.name.clone(),
                token_symbol: token.symbol.clone(),
                token_address: token.token_address.clone(),
                token_image: token.image.clone(),
                swapper_address: swapper_addr,
                type_: match trade.trade_type {
                    TradeType::Buy => "buy".to_string(),
                    TradeType::Sell => "sell".to_string(),
                },
                eth_amount: trade.eth_amount.to_string(),
                token_amount: trade.token_amount.to_string(),
                network: token.network.clone(),
                date: trade.traded_at,
                tx_hash: trade.tx_hash.clone(),
                token_price: trade.token_price.to_string(),
                eth_price: trade.eth_price.to_string(),
            }
        })
        .collect();

    // Tokens newer than latest_token_id
    let new_token_rows: Vec<(Token, User)> = tokens::table
        .inner_join(users::table.on(users::id.eq(tokens::creator_id)))
        .filter(tokens::id.gt(latest_token_id))
        .order(tokens::id.desc())
        .limit(50)
        .load(&mut conn)
        .await?;

    let token_responses: Vec<TokenResponse> = new_token_rows
        .iter()
        .map(|(token, user)| {
            let chain = state
                .chains
                .iter()
                .find(|c| c.network.eq_ignore_ascii_case(&token.network))
                .cloned()
                .unwrap_or_else(|| state.chains[0].clone());
            TokenResponse::from_token_and_creator(token, &user.address, &chain)
        })
        .collect();

    Ok(Json(RecentTradesResponse {
        trades: trade_responses,
        tokens: token_responses,
    }))
}

// ---------------------------------------------------------------------------
// GET /trades/getChartData
// ---------------------------------------------------------------------------

pub async fn get_chart_data(
    State(state): State<Arc<AppState>>,
    Query(params): Query<ChartDataQuery>,
) -> AppResult<Json<Vec<Candle>>> {
    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;

    // Parse resolution from interval string (e.g. "5m", "1d", "1w")
    let resolution = parse_resolution(&params.interval)?;

    // Find token
    let token: Token = tokens::table
        .filter(tokens::token_address.eq(&params.token_address))
        .first(&mut conn)
        .await
        .optional()?
        .ok_or_else(|| AppError::NotFound("Token not found".to_string()))?;

    // Query all trades for the token in [from, to] range, ordered by traded_at ASC
    let trade_rows: Vec<Trade> = trades::table
        .filter(trades::token_id.eq(token.id))
        .filter(trades::traded_at.ge(params.from))
        .filter(trades::traded_at.le(params.to))
        .order(trades::traded_at.asc())
        .load(&mut conn)
        .await?;

    if trade_rows.is_empty() {
        // Return initial price candle at token creation time
        let initial_price: f64 = token.price.to_string().parse().unwrap_or(0.0);
        if initial_price > 0.0 {
            let created_ts = token.created_at.timestamp();
            let bucket = (created_ts / resolution) * resolution;
            return Ok(Json(vec![Candle {
                time: bucket,
                open: initial_price,
                high: initial_price,
                low: initial_price,
                close: initial_price,
                volume: 0.0,
            }]));
        }
        return Ok(Json(vec![]));
    }

    // Build OHLCV candles by grouping trades into time buckets
    let mut candles: Vec<Candle> = Vec::new();
    let bucket_start = (trade_rows[0].traded_at / resolution) * resolution;
    let mut prev_close: f64 = trade_rows[0]
        .token_price
        .to_f64()
        .unwrap_or(0.0);

    // Walk through every bucket from the first trade to params.to
    let final_bucket = (params.to / resolution) * resolution;
    let mut trade_idx: usize = 0;

    const MAX_CANDLES: usize = 2000;
    let mut current = bucket_start;
    while current <= final_bucket && candles.len() < MAX_CANDLES {
        let bucket_end = current + resolution;

        // Collect trades in this bucket
        let mut bucket_trades: Vec<&Trade> = Vec::new();
        while trade_idx < trade_rows.len() && trade_rows[trade_idx].traded_at < bucket_end {
            if trade_rows[trade_idx].traded_at >= current {
                bucket_trades.push(&trade_rows[trade_idx]);
            }
            trade_idx += 1;
        }

        if bucket_trades.is_empty() {
            // No trades: flat candle at previous close
            candles.push(Candle {
                time: current,
                open: prev_close,
                high: prev_close,
                low: prev_close,
                close: prev_close,
                volume: 0.0,
            });
        } else {
            let open = prev_close;
            let mut high = open;
            let mut low = open;
            let mut close = open;
            let mut volume = 0.0;

            for t in &bucket_trades {
                let price = t.token_price.to_f64().unwrap_or(0.0);
                let eth_p = t.eth_price.to_f64().unwrap_or(0.0);
                let tok_amt = t.token_amount.to_f64().unwrap_or(0.0);

                if price > high {
                    high = price;
                }
                if price < low {
                    low = price;
                }
                close = price;
                volume += tok_amt * price * eth_p;
            }

            // Ensure high/low include open
            if open > high {
                high = open;
            }
            if open < low {
                low = open;
            }

            candles.push(Candle {
                time: current,
                open,
                high,
                low,
                close,
                volume,
            });

            prev_close = close;
        }

        current += resolution;
    }

    Ok(Json(candles))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn parse_resolution(interval: &str) -> Result<i64, AppError> {
    let interval = interval.trim();
    if interval.is_empty() {
        return Err(AppError::BadRequest("Empty interval".to_string()));
    }

    // Handle TradingView-style resolutions: "1", "5", "15", "60", "D", "W", "M"
    // as well as explicit formats: "5m", "1h", "1d", "1w"
    match interval.to_uppercase().as_str() {
        "D" | "1D" => return Ok(86400),
        "W" | "1W" => return Ok(604800),
        "M" | "1M" => return Ok(2592000),
        _ => {}
    }

    // Try parsing as pure number (TradingView minutes)
    if let Ok(minutes) = interval.parse::<i64>() {
        return Ok(minutes * 60);
    }

    // Try parsing as "5m", "1h", "1d", "1w" format
    let (num_str, unit) = interval.split_at(interval.len() - 1);
    let num: i64 = num_str
        .parse()
        .map_err(|_| AppError::BadRequest(format!("Invalid interval: {interval}")))?;

    let multiplier: i64 = match unit.to_lowercase().as_str() {
        "m" => 60,
        "h" => 3600,
        "d" => 86400,
        "w" => 604800,
        _ => return Err(AppError::BadRequest(format!("Unknown interval unit: {unit}"))),
    };

    Ok(num * multiplier)
}
