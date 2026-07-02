use bigdecimal::BigDecimal;
use chrono::{DateTime, Utc};
use diesel::prelude::*;
use serde::{Deserialize, Serialize};

use crate::models::enums::TradeType;
use crate::schema::trades;

/// Queryable struct -- field order matches `trades` table columns exactly.
#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = trades)]
#[diesel(check_for_backend(diesel::pg::Pg))]
pub struct Trade {
    pub id: i32,
    pub token_id: i32,
    pub swapper_id: i32,
    pub trade_type: TradeType,
    pub eth_amount: BigDecimal,
    pub token_amount: BigDecimal,
    pub token_price: BigDecimal,
    pub eth_price: BigDecimal,
    pub tx_hash: String,
    pub traded_at: i64,
    pub created_at: DateTime<Utc>,
}

/// Insertable struct for recording new trades.
#[derive(Debug, Clone, Insertable, Deserialize)]
#[diesel(table_name = trades)]
pub struct NewTrade {
    pub token_id: i32,
    pub swapper_id: i32,
    pub trade_type: TradeType,
    pub eth_amount: BigDecimal,
    pub token_amount: BigDecimal,
    pub token_price: BigDecimal,
    pub eth_price: BigDecimal,
    pub tx_hash: String,
    pub traded_at: i64,
}

/// Response DTO sent to the frontend (joined with token + user data).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TradeResponse {
    pub id: i32,
    pub token_name: String,
    pub token_symbol: String,
    pub token_address: String,
    pub token_image: Option<String>,
    pub swapper_address: String,
    pub swapper_username: Option<String>,
    pub swapper_avatar: Option<String>,
    #[serde(rename = "type")]
    pub type_: String,
    pub eth_amount: String,
    pub token_amount: String,
    pub network: String,
    pub date: i64,
    pub tx_hash: String,
    pub token_price: String,
    pub eth_price: String,
}
