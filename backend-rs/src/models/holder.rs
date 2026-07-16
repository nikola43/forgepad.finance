use bigdecimal::BigDecimal;
use diesel::prelude::*;
use serde::{Deserialize, Serialize};

use crate::models::token::CreatorInfo;
use crate::schema::holders;

/// Queryable struct -- field order matches `holders` table columns exactly.
#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = holders)]
#[diesel(check_for_backend(diesel::pg::Pg))]
pub struct Holder {
    pub id: i32,
    pub token_id: i32,
    pub user_id: i32,
    pub amount: BigDecimal,
}

/// Insertable struct for upserting holder records.
#[derive(Debug, Clone, Insertable, Deserialize)]
#[diesel(table_name = holders)]
pub struct NewHolder {
    pub token_id: i32,
    pub user_id: i32,
    pub amount: BigDecimal,
}

/// Response DTO sent to the frontend (joined with token + user data).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HolderResponse {
    pub id: i32,
    pub token_address: String,
    pub holder_address: String,
    pub token_amount: String,
    pub token_name: String,
    pub token_symbol: String,
    pub token_image: Option<String>,
    pub marketcap: String,
    pub network: String,
    pub creator_address: String,
    /// The holder's own profile (username + avatar), so holder lists can show
    /// identity instead of falling back to a truncated address.
    pub user: CreatorInfo,
}
