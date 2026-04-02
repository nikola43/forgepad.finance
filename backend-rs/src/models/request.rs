use chrono::{DateTime, Utc};
use diesel::prelude::*;
use serde::{Deserialize, Serialize};

use crate::schema::token_creation_requests;

/// Queryable struct -- field order matches `token_creation_requests` table columns exactly.
#[derive(Debug, Clone, Queryable, Selectable, Serialize, Deserialize)]
#[diesel(table_name = token_creation_requests)]
#[diesel(check_for_backend(diesel::pg::Pg))]
pub struct TokenCreationRequest {
    pub id: i32,
    pub creator_address: String,
    pub body: serde_json::Value,
    pub created_at: DateTime<Utc>,
}

/// Insertable struct for creating new token creation requests.
#[derive(Debug, Clone, Insertable, Deserialize)]
#[diesel(table_name = token_creation_requests)]
pub struct NewTokenCreationRequest {
    pub creator_address: String,
    pub body: serde_json::Value,
}
