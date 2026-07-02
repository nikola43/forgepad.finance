use bigdecimal::BigDecimal;
use chrono::{DateTime, Utc};
use diesel::prelude::*;
use serde::{Deserialize, Serialize};

use crate::config::chains::ChainConfig;
use crate::models::enums::{PoolType, TokenCategory};
use crate::schema::tokens;

/// Queryable struct -- field order matches `tokens` table columns exactly.
#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = tokens)]
#[diesel(check_for_backend(diesel::pg::Pg))]
pub struct Token {
    pub id: i32,
    pub token_address: String,
    pub name: String,
    pub symbol: String,
    pub description: Option<String>,
    pub image: Option<String>,
    pub banner: Option<String>,
    pub creator_id: i32,
    pub network: String,
    pub marketcap: BigDecimal,
    pub price: BigDecimal,
    pub eth_price: BigDecimal,
    pub volume: BigDecimal,
    pub score: BigDecimal,
    pub virtual_eth_amount: BigDecimal,
    pub virtual_token_amount: BigDecimal,
    pub pair_address: Option<String>,
    pub pool_type: PoolType,
    pub category: TokenCategory,
    pub reply_count: i32,
    pub web_link: Option<String>,
    pub telegram_link: Option<String>,
    pub twitter_link: Option<String>,
    pub launched_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Insertable struct for creating new tokens.
#[derive(Debug, Clone, Insertable, Deserialize, AsChangeset)]
#[diesel(table_name = tokens)]
pub struct NewToken {
    pub token_address: String,
    pub name: String,
    pub symbol: String,
    pub description: Option<String>,
    pub image: Option<String>,
    pub banner: Option<String>,
    pub creator_id: i32,
    pub network: String,
    pub marketcap: BigDecimal,
    pub price: BigDecimal,
    pub eth_price: BigDecimal,
    pub volume: BigDecimal,
    pub score: BigDecimal,
    pub virtual_eth_amount: BigDecimal,
    pub virtual_token_amount: BigDecimal,
    pub pair_address: Option<String>,
    pub pool_type: PoolType,
    pub category: TokenCategory,
    pub web_link: Option<String>,
    pub telegram_link: Option<String>,
    pub twitter_link: Option<String>,
}

/// Minimal creator info nested in TokenResponse so the UI can show the creator's
/// username + avatar instead of just the raw address.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatorInfo {
    pub address: String,
    pub username: Option<String>,
    pub avatar: Option<String>,
}

/// Response DTO sent to the frontend, with computed fields.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenResponse {
    pub id: i32,
    pub token_address: String,
    pub token_name: String,
    pub token_symbol: String,
    pub token_description: Option<String>,
    pub token_image: Option<String>,
    pub token_banner: Option<String>,
    pub creator_address: String,
    pub user: CreatorInfo,
    pub network: String,
    pub marketcap: String,
    pub price: String,
    pub eth_price: String,
    pub volume: String,
    pub score: String,
    pub virtual_eth_amount: String,
    pub virtual_token_amount: String,
    pub pair_address: Option<String>,
    pub pool_type: i32,
    pub category: TokenCategory,
    pub replies: i32,
    pub web_link: Option<String>,
    pub telegram_link: Option<String>,
    pub twitter_link: Option<String>,
    pub launched_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub creation_time: DateTime<Utc>,
    pub liquidity: Option<String>,
    pub progress: Option<f64>,
    pub price_change: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub price_15m: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub price_change_15m: Option<f64>,
}

impl TokenResponse {
    /// Build a response from a `Token` row, the creator's address, and the
    /// chain configuration so that we can compute derived fields.
    pub fn from_token_and_creator(
        token: &Token,
        creator: &crate::models::user::User,
        chain: &ChainConfig,
    ) -> Self {
        use bigdecimal::ToPrimitive;

        let virtual_eth_f = token.virtual_eth_amount.to_f64().unwrap_or(0.0);
        let _virtual_token_f = token.virtual_token_amount.to_f64().unwrap_or(0.0);
        let eth_price_f = token.eth_price.to_f64().unwrap_or(0.0);
        let marketcap_f = token.marketcap.to_f64().unwrap_or(0.0);
        let price_f = token.price.to_f64().unwrap_or(0.0);

        // liquidity = virtual_eth_amount * eth_price
        let liquidity = virtual_eth_f * eth_price_f;

        // progress = min(100, (marketcap_usd / target_market_cap_usd) * 100)
        let progress = if chain.target_market_cap > 0.0 {
            (marketcap_f / chain.target_market_cap * 100.0).min(100.0)
        } else {
            0.0
        };

        // initial_price = chain.virtual_eth / chain.virtual_token
        let initial_price = if chain.virtual_token_amount > 0.0 {
            chain.virtual_eth_amount / chain.virtual_token_amount
        } else {
            0.0
        };

        // price_change = ((price - initial_price) / initial_price) * 100
        let price_change = if initial_price > 0.0 {
            ((price_f - initial_price) / initial_price) * 100.0
        } else {
            0.0
        };

        Self {
            id: token.id,
            token_address: token.token_address.clone(),
            token_name: token.name.clone(),
            token_symbol: token.symbol.clone(),
            token_description: token.description.clone(),
            token_image: token.image.clone(),
            token_banner: token.banner.clone(),
            creator_address: creator.address.clone(),
            user: CreatorInfo {
                address: creator.address.clone(),
                username: creator.username.clone(),
                avatar: creator.avatar.clone(),
            },
            network: token.network.clone(),
            marketcap: token.marketcap.to_string(),
            price: token.price.to_string(),
            eth_price: token.eth_price.to_string(),
            volume: token.volume.to_string(),
            score: token.score.to_string(),
            virtual_eth_amount: token.virtual_eth_amount.to_string(),
            virtual_token_amount: token.virtual_token_amount.to_string(),
            pair_address: token.pair_address.clone(),
            pool_type: match token.pool_type {
                PoolType::V2 => 1,
                PoolType::V3 => 2,
                PoolType::V4 => 3,
            },
            category: token.category,
            replies: token.reply_count,
            web_link: token.web_link.clone(),
            telegram_link: token.telegram_link.clone(),
            twitter_link: token.twitter_link.clone(),
            launched_at: token.launched_at,
            created_at: token.created_at,
            updated_at: token.updated_at,
            creation_time: token.created_at,
            liquidity: Some(liquidity.to_string()),
            progress: Some(progress),
            price_change: Some(price_change),
            price_15m: None,
            price_change_15m: None,
        }
    }
}
