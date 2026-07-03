use std::sync::Arc;

use axum::extract::{Path, State};
use axum::Json;
use diesel::prelude::*;
use diesel::sql_types::{Double, Integer, Nullable, Text};
use diesel_async::RunQueryDsl;
use serde::{Deserialize, Serialize};

use crate::errors::{AppError, AppResult};
use crate::AppState;

// ---------------------------------------------------------------------------
// Paper trading / simulator (Tier C). A risk-free practice mode: each address
// gets a virtual ETH balance and trades run the SAME constant-product bonding
// curve the contract uses (mirrors getAmountOut in foundry/src/Arrowpad.sol,
// 1% platform fee) priced off the token's live virtual reserves. No chain tx,
// zero economic value. State lives in paper_accounts / paper_positions.
// ---------------------------------------------------------------------------

const STARTING_BALANCE_ETH: f64 = 10.0;
/// Platform buy/sell fee in bps — matches PLATFORM_BUY_FEE_BPS / SELL in Arrowpad.sol.
const FEE_BPS: f64 = 100.0;

/// Constant-product output with fee, identical to Arrowpad.getAmountOut.
fn get_amount_out(amount_in: f64, reserve_in: f64, reserve_out: f64) -> f64 {
    if amount_in <= 0.0 || reserve_in <= 0.0 || reserve_out <= 0.0 {
        return 0.0;
    }
    let amount_in_with_fee = amount_in * (10_000.0 - FEE_BPS) / 10_000.0;
    let numerator = amount_in_with_fee * reserve_out;
    let denominator = reserve_in + amount_in_with_fee;
    numerator / denominator
}

#[derive(QueryableByName)]
struct PaperTokenRow {
    #[diesel(sql_type = Integer)]
    id: i32,
    #[diesel(sql_type = Text)]
    token_address: String,
    #[diesel(sql_type = Text)]
    network: String,
    #[diesel(sql_type = Text)]
    name: String,
    #[diesel(sql_type = Text)]
    symbol: String,
    #[diesel(sql_type = Nullable<Text>)]
    image: Option<String>,
    #[diesel(sql_type = Double)]
    virtual_eth: f64,
    #[diesel(sql_type = Double)]
    virtual_token: f64,
    #[diesel(sql_type = Double)]
    eth_price: f64,
}

async fn resolve_token(
    conn: &mut diesel_async::AsyncPgConnection,
    address: &str,
) -> AppResult<PaperTokenRow> {
    diesel::sql_query(
        "SELECT id, token_address, network, name, symbol, image, \
           COALESCE(virtual_eth_amount::float8, 0) AS virtual_eth, \
           COALESCE(virtual_token_amount::float8, 0) AS virtual_token, \
           COALESCE(eth_price::float8, 0) AS eth_price \
         FROM tokens WHERE token_address = $1",
    )
    .bind::<Text, _>(address.to_lowercase())
    .get_result::<PaperTokenRow>(conn)
    .await
    .optional()?
    .ok_or_else(|| AppError::NotFound("Token not found".to_string()))
}

/// Ensure the paper account exists (seeded with the starting balance) and return
/// its current ETH balance.
async fn ensure_account(
    conn: &mut diesel_async::AsyncPgConnection,
    address: &str,
) -> AppResult<f64> {
    diesel::sql_query(
        "INSERT INTO paper_accounts (address, eth_balance) VALUES ($1, $2) \
         ON CONFLICT (address) DO NOTHING",
    )
    .bind::<Text, _>(address.to_lowercase())
    .bind::<Double, _>(STARTING_BALANCE_ETH)
    .execute(conn)
    .await?;

    #[derive(QueryableByName)]
    struct Bal {
        #[diesel(sql_type = Double)]
        eth_balance: f64,
    }
    Ok(diesel::sql_query(
        "SELECT eth_balance::float8 AS eth_balance FROM paper_accounts WHERE address = $1",
    )
    .bind::<Text, _>(address.to_lowercase())
    .get_result::<Bal>(conn)
    .await?
    .eth_balance)
}

// ---- portfolio view -------------------------------------------------------

#[derive(QueryableByName)]
struct PositionRow {
    #[diesel(sql_type = Integer)]
    token_id: i32,
    #[diesel(sql_type = Text)]
    token_address: String,
    #[diesel(sql_type = Text)]
    network: String,
    #[diesel(sql_type = Text)]
    name: String,
    #[diesel(sql_type = Text)]
    symbol: String,
    #[diesel(sql_type = Nullable<Text>)]
    image: Option<String>,
    #[diesel(sql_type = Double)]
    token_amount: f64,
    #[diesel(sql_type = Double)]
    invested_eth: f64,
    #[diesel(sql_type = Double)]
    realized_pnl_eth: f64,
    #[diesel(sql_type = Double)]
    virtual_eth: f64,
    #[diesel(sql_type = Double)]
    virtual_token: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperPosition {
    token_address: String,
    network: String,
    name: String,
    symbol: String,
    image: Option<String>,
    token_amount: f64,
    invested_eth: f64,
    current_value_eth: f64,
    unrealized_pnl_eth: f64,
    realized_pnl_eth: f64,
    roi_pct: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperPortfolio {
    address: String,
    eth_balance: f64,
    starting_balance: f64,
    eth_price_usd: f64,
    holdings_value_eth: f64,
    total_value_eth: f64,
    total_pnl_eth: f64,
    total_pnl_pct: f64,
    positions: Vec<PaperPosition>,
}

async fn build_portfolio(
    conn: &mut diesel_async::AsyncPgConnection,
    address: &str,
) -> AppResult<PaperPortfolio> {
    let eth_balance = ensure_account(conn, address).await?;

    let rows: Vec<PositionRow> = diesel::sql_query(
        "SELECT p.token_id, t.token_address, t.network, t.name, t.symbol, t.image, \
           p.token_amount::float8 AS token_amount, p.invested_eth::float8 AS invested_eth, \
           p.realized_pnl_eth::float8 AS realized_pnl_eth, \
           COALESCE(t.virtual_eth_amount::float8, 0) AS virtual_eth, \
           COALESCE(t.virtual_token_amount::float8, 0) AS virtual_token \
         FROM paper_positions p JOIN tokens t ON t.id = p.token_id \
         WHERE p.address = $1",
    )
    .bind::<Text, _>(address.to_lowercase())
    .load(conn)
    .await?;

    // ETH→USD reference for display (latest known price across tokens).
    #[derive(QueryableByName)]
    struct EP {
        #[diesel(sql_type = Double)]
        eth_price: f64,
    }
    let eth_price_usd = diesel::sql_query(
        "SELECT COALESCE(MAX(eth_price::float8), 0) AS eth_price FROM tokens WHERE eth_price > 0",
    )
    .get_result::<EP>(conn)
    .await
    .map(|r| r.eth_price)
    .unwrap_or(0.0);

    let mut holdings_value_eth = 0.0;
    let mut realized_total = 0.0;
    let mut positions = Vec::new();
    for r in rows {
        // Current value = proceeds from selling the whole position now.
        let current_value = get_amount_out(r.token_amount, r.virtual_token, r.virtual_eth);
        let unrealized = current_value - r.invested_eth;
        let roi = if r.invested_eth > 0.0 {
            (unrealized + r.realized_pnl_eth) / r.invested_eth * 100.0
        } else {
            0.0
        };
        holdings_value_eth += current_value;
        realized_total += r.realized_pnl_eth;
        if r.token_amount <= 0.0 && r.realized_pnl_eth == 0.0 {
            continue;
        }
        positions.push(PaperPosition {
            token_address: r.token_address,
            network: r.network,
            name: r.name,
            symbol: r.symbol,
            image: r.image,
            token_amount: r.token_amount,
            invested_eth: r.invested_eth,
            current_value_eth: current_value,
            unrealized_pnl_eth: unrealized,
            realized_pnl_eth: r.realized_pnl_eth,
            roi_pct: roi,
        });
    }
    positions.sort_by(|a, b| b.current_value_eth.partial_cmp(&a.current_value_eth).unwrap_or(std::cmp::Ordering::Equal));

    let _ = realized_total;
    let total_value = eth_balance + holdings_value_eth;
    // Mark-to-market total PnL: everything you hold now vs. what you started with.
    let total_pnl = total_value - STARTING_BALANCE_ETH;
    Ok(PaperPortfolio {
        address: address.to_lowercase(),
        eth_balance,
        starting_balance: STARTING_BALANCE_ETH,
        eth_price_usd,
        holdings_value_eth,
        total_value_eth: total_value,
        total_pnl_eth: total_pnl,
        total_pnl_pct: total_pnl / STARTING_BALANCE_ETH * 100.0,
        positions,
    })
}

// GET /paper/:address
pub async fn get_portfolio(
    State(state): State<Arc<AppState>>,
    Path(address): Path<String>,
) -> AppResult<Json<PaperPortfolio>> {
    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;
    Ok(Json(build_portfolio(&mut conn, &address).await?))
}

// ---- buy / sell -----------------------------------------------------------

#[derive(Deserialize)]
pub struct BuyBody {
    pub address: String,
    #[serde(alias = "tokenAddress")]
    pub token_address: String,
    #[serde(alias = "amountEth")]
    pub amount_eth: f64,
}

// POST /paper/buy
pub async fn buy(
    State(state): State<Arc<AppState>>,
    Json(body): Json<BuyBody>,
) -> AppResult<Json<PaperPortfolio>> {
    if !(body.amount_eth.is_finite() && body.amount_eth > 0.0) {
        return Err(AppError::BadRequest("Invalid amount".to_string()));
    }
    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;
    let tk = resolve_token(&mut conn, &body.token_address).await?;
    let balance = ensure_account(&mut conn, &body.address).await?;
    if body.amount_eth > balance + 1e-12 {
        return Err(AppError::BadRequest("Insufficient paper ETH balance".to_string()));
    }
    let tokens_out = get_amount_out(body.amount_eth, tk.virtual_eth, tk.virtual_token);
    if tokens_out <= 0.0 {
        return Err(AppError::BadRequest("Token has no liquidity to simulate".to_string()));
    }

    diesel::sql_query("UPDATE paper_accounts SET eth_balance = eth_balance - $1, updated_at = NOW() WHERE address = $2")
        .bind::<Double, _>(body.amount_eth)
        .bind::<Text, _>(body.address.to_lowercase())
        .execute(&mut conn)
        .await?;

    diesel::sql_query(
        "INSERT INTO paper_positions (address, token_id, token_amount, invested_eth) \
         VALUES ($1, $2, $3, $4) \
         ON CONFLICT (address, token_id) DO UPDATE SET \
           token_amount = paper_positions.token_amount + $3, \
           invested_eth = paper_positions.invested_eth + $4, \
           updated_at = NOW()",
    )
    .bind::<Text, _>(body.address.to_lowercase())
    .bind::<Integer, _>(tk.id)
    .bind::<Double, _>(tokens_out)
    .bind::<Double, _>(body.amount_eth)
    .execute(&mut conn)
    .await?;

    Ok(Json(build_portfolio(&mut conn, &body.address).await?))
}

#[derive(Deserialize)]
pub struct SellBody {
    pub address: String,
    #[serde(alias = "tokenAddress")]
    pub token_address: String,
    /// Fraction of the position to sell, 0..=1 (e.g. 1.0 = sell all). Defaults to all.
    #[serde(default)]
    pub percent: Option<f64>,
    /// Or an explicit token amount to sell (takes precedence over percent).
    #[serde(default, alias = "amountToken")]
    pub amount_token: Option<f64>,
}

// POST /paper/sell
pub async fn sell(
    State(state): State<Arc<AppState>>,
    Json(body): Json<SellBody>,
) -> AppResult<Json<PaperPortfolio>> {
    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;
    let tk = resolve_token(&mut conn, &body.token_address).await?;
    ensure_account(&mut conn, &body.address).await?;

    #[derive(QueryableByName)]
    struct Pos {
        #[diesel(sql_type = Double)]
        token_amount: f64,
        #[diesel(sql_type = Double)]
        invested_eth: f64,
    }
    let pos = diesel::sql_query(
        "SELECT token_amount::float8 AS token_amount, invested_eth::float8 AS invested_eth \
         FROM paper_positions WHERE address = $1 AND token_id = $2",
    )
    .bind::<Text, _>(body.address.to_lowercase())
    .bind::<Integer, _>(tk.id)
    .get_result::<Pos>(&mut conn)
    .await
    .optional()?
    .ok_or_else(|| AppError::BadRequest("No paper position in this token".to_string()))?;

    if pos.token_amount <= 0.0 {
        return Err(AppError::BadRequest("No paper position in this token".to_string()));
    }

    // Resolve how many tokens to sell.
    let sell_amount = if let Some(amt) = body.amount_token {
        amt.min(pos.token_amount)
    } else {
        let pct = body.percent.unwrap_or(1.0).clamp(0.0, 1.0);
        pos.token_amount * pct
    };
    if !(sell_amount.is_finite() && sell_amount > 0.0) {
        return Err(AppError::BadRequest("Invalid sell amount".to_string()));
    }

    let eth_out = get_amount_out(sell_amount, tk.virtual_token, tk.virtual_eth);
    // Cost basis of the sold fraction.
    let cost_fraction = pos.invested_eth * (sell_amount / pos.token_amount);
    let realized_delta = eth_out - cost_fraction;

    diesel::sql_query(
        "UPDATE paper_positions SET \
           token_amount = token_amount - $1, \
           invested_eth = GREATEST(invested_eth - $2, 0), \
           realized_pnl_eth = realized_pnl_eth + $3, \
           updated_at = NOW() \
         WHERE address = $4 AND token_id = $5",
    )
    .bind::<Double, _>(sell_amount)
    .bind::<Double, _>(cost_fraction)
    .bind::<Double, _>(realized_delta)
    .bind::<Text, _>(body.address.to_lowercase())
    .bind::<Integer, _>(tk.id)
    .execute(&mut conn)
    .await?;

    diesel::sql_query("UPDATE paper_accounts SET eth_balance = eth_balance + $1, updated_at = NOW() WHERE address = $2")
        .bind::<Double, _>(eth_out)
        .bind::<Text, _>(body.address.to_lowercase())
        .execute(&mut conn)
        .await?;

    Ok(Json(build_portfolio(&mut conn, &body.address).await?))
}

#[derive(Deserialize)]
pub struct ResetBody {
    pub address: String,
}

// POST /paper/reset — wipe positions and restore the starting balance.
pub async fn reset(
    State(state): State<Arc<AppState>>,
    Json(body): Json<ResetBody>,
) -> AppResult<Json<PaperPortfolio>> {
    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;
    let addr = body.address.to_lowercase();
    diesel::sql_query("DELETE FROM paper_positions WHERE address = $1")
        .bind::<Text, _>(&addr)
        .execute(&mut conn)
        .await?;
    diesel::sql_query(
        "INSERT INTO paper_accounts (address, eth_balance, updated_at) VALUES ($1, $2, NOW()) \
         ON CONFLICT (address) DO UPDATE SET eth_balance = $2, updated_at = NOW()",
    )
    .bind::<Text, _>(&addr)
    .bind::<Double, _>(STARTING_BALANCE_ETH)
    .execute(&mut conn)
    .await?;
    Ok(Json(build_portfolio(&mut conn, &body.address).await?))
}
