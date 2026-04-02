use chrono::{DateTime, Utc};
use diesel::prelude::*;
use serde::{Deserialize, Serialize};

use crate::schema::indexing_state;

/// Queryable struct -- field order matches `indexing_state` table columns exactly.
#[derive(Debug, Clone, Queryable, Selectable, Serialize, Deserialize)]
#[diesel(table_name = indexing_state)]
#[diesel(check_for_backend(diesel::pg::Pg))]
pub struct IndexingState {
    pub id: i32,
    pub network: String,
    pub last_block: i64,
    pub updated_at: DateTime<Utc>,
}

/// Insertable struct for creating initial indexing state.
#[derive(Debug, Clone, Insertable, Deserialize)]
#[diesel(table_name = indexing_state)]
pub struct NewIndexingState {
    pub network: String,
    pub last_block: i64,
}
