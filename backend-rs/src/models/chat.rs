use chrono::{DateTime, Utc};
use diesel::prelude::*;
use serde::{Deserialize, Serialize};

use crate::schema::chats;

/// Queryable struct -- field order matches `chats` table columns exactly.
#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = chats)]
#[diesel(check_for_backend(diesel::pg::Pg))]
pub struct Chat {
    pub id: i32,
    pub token_id: i32,
    pub author_id: i32,
    pub parent_id: Option<i32>,
    pub content: String,
    pub code: Option<String>,
    pub network: String,
    pub created_at: DateTime<Utc>,
}

/// Insertable struct for creating new chat messages.
#[derive(Debug, Clone, Insertable, Deserialize)]
#[diesel(table_name = chats)]
pub struct NewChat<'a> {
    pub token_id: i32,
    pub author_id: i32,
    pub parent_id: Option<i32>,
    pub content: String,
    pub code: Option<&'a str>,
    pub network: String,
}

/// Response DTO sent to the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatResponse {
    pub id: i32,
    pub token_address: String,
    pub reply_address: Option<String>,
    pub comment: String,
    pub code: Option<String>,
    pub date: DateTime<Utc>,
    pub network: String,
}
