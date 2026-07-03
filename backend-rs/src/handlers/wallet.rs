use std::sync::Arc;

use axum::extract::{Path, State};
use axum::Json;
use diesel::prelude::*;
use diesel::sql_types::{BigInt, Double, Integer, Nullable, Text};
use diesel_async::RunQueryDsl;
use serde::Serialize;

use crate::errors::{AppError, AppResult};
use crate::AppState;

// ---------------------------------------------------------------------------
// Wallet tracker — any address's trading performance (GMGN-style). Rolls up the
// average-cost per-token PnL across every token the wallet has traded, plus a
// win rate (share of traded tokens that are net profitable), total volume, and
// trade count.
// ---------------------------------------------------------------------------

#[derive(QueryableByName)]
struct Row {
    #[diesel(sql_type = Double)]
    price: f64,
    #[diesel(sql_type = Double)]
    eth_price: f64,
    #[diesel(sql_type = Double)]
    buy_usd: f64,
    #[diesel(sql_type = Double)]
    buy_tokens: f64,
    #[diesel(sql_type = Double)]
    sell_usd: f64,
    #[diesel(sql_type = Double)]
    sell_tokens: f64,
    #[diesel(sql_type = BigInt)]
    trades: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WalletStats {
    address: String,
    username: Option<String>,
    avatar: Option<String>,
    volume_usd: f64,
    realized_pnl_usd: f64,
    unrealized_pnl_usd: f64,
    total_pnl_usd: f64,
    roi_pct: f64,
    win_rate: f64,
    tokens_traded: i64,
    trade_count: i64,
    holding_value_usd: f64,
}

// GET /wallet/:address
pub async fn get_wallet(
    State(state): State<Arc<AppState>>,
    Path(address): Path<String>,
) -> AppResult<Json<WalletStats>> {
    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;

    #[derive(QueryableByName)]
    struct U {
        #[diesel(sql_type = Integer)]
        id: i32,
        #[diesel(sql_type = Nullable<Text>)]
        username: Option<String>,
        #[diesel(sql_type = Nullable<Text>)]
        avatar: Option<String>,
    }
    let user = diesel::sql_query("SELECT id, username, avatar FROM users WHERE address = $1")
        .bind::<Text, _>(address.to_lowercase())
        .get_result::<U>(&mut conn)
        .await
        .optional()?;
    let (uid, username, avatar) = match user {
        Some(u) => (u.id, u.username, u.avatar),
        None => {
            return Ok(Json(WalletStats {
                address,
                username: None,
                avatar: None,
                volume_usd: 0.0,
                realized_pnl_usd: 0.0,
                unrealized_pnl_usd: 0.0,
                total_pnl_usd: 0.0,
                roi_pct: 0.0,
                win_rate: 0.0,
                tokens_traded: 0,
                trade_count: 0,
                holding_value_usd: 0.0,
            }))
        }
    };

    let rows: Vec<Row> = diesel::sql_query(format!(
        "SELECT COALESCE(tk.price::float8,0) AS price, COALESCE(tk.eth_price::float8,0) AS eth_price, \
           COALESCE(SUM(CASE WHEN t.trade_type='buy' THEN t.eth_amount::float8*t.eth_price::float8 ELSE 0 END),0) AS buy_usd, \
           COALESCE(SUM(CASE WHEN t.trade_type='buy' THEN t.token_amount::float8 ELSE 0 END),0) AS buy_tokens, \
           COALESCE(SUM(CASE WHEN t.trade_type='sell' THEN t.eth_amount::float8*t.eth_price::float8 ELSE 0 END),0) AS sell_usd, \
           COALESCE(SUM(CASE WHEN t.trade_type='sell' THEN t.token_amount::float8 ELSE 0 END),0) AS sell_tokens, \
           COUNT(t.id)::bigint AS trades \
         FROM trades t JOIN tokens tk ON tk.id=t.token_id \
         WHERE t.swapper_id={uid} \
         GROUP BY tk.id"
    ))
    .load(&mut conn)
    .await?;

    let tokens_traded = rows.len() as i64;
    let mut volume = 0.0;
    let mut realized = 0.0;
    let mut unrealized = 0.0;
    let mut cost = 0.0;
    let mut holding_value = 0.0;
    let mut wins = 0i64;
    let mut trade_count = 0i64;

    for r in &rows {
        trade_count += r.trades;
        volume += r.buy_usd + r.sell_usd;
        let avg = if r.buy_tokens > 0.0 { r.buy_usd / r.buy_tokens } else { 0.0 };
        let rl = r.sell_usd - r.sell_tokens * avg;
        let net = (r.buy_tokens - r.sell_tokens).max(0.0);
        let price_usd = r.price * r.eth_price;
        let value = net * price_usd;
        let ur = value - net * avg;
        realized += rl;
        unrealized += ur;
        cost += net * avg;
        holding_value += value;
        if rl + ur > 0.0 {
            wins += 1;
        }
    }

    let total_pnl = realized + unrealized;
    Ok(Json(WalletStats {
        address,
        username,
        avatar,
        volume_usd: volume,
        realized_pnl_usd: realized,
        unrealized_pnl_usd: unrealized,
        total_pnl_usd: total_pnl,
        roi_pct: if cost > 0.0 { total_pnl / cost * 100.0 } else { 0.0 },
        win_rate: if tokens_traded > 0 { wins as f64 / tokens_traded as f64 * 100.0 } else { 0.0 },
        tokens_traded,
        trade_count,
        holding_value_usd: holding_value,
    }))
}
